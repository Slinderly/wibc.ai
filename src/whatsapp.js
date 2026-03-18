const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { generateAIResponse } = require('./ai');

// ── State — cada clave es `${userId}:${sessionId}` ─────────────────────────
const sockets       = {};  // clave → instancia del socket
const statuses      = {};  // clave → 'connecting'|'connected'|'disconnected'|'timeout'
const qrMap         = {};  // clave → string QR
const deviceMap     = {};  // clave → { phone, name, connectedAt }
const everConn      = {};  // clave → bool (estuvo conectado alguna vez)
const userSets      = {};  // userId → Set<sessionId>

// Pairing en curso por usuario (máximo 1 a la vez)
const activePairing = {};  // userId → { sessionId, cancel: fn }

const makeKey = (userId, sessionId) => `${userId}:${sessionId}`;
const authDir = (userId, sessionId) =>
    path.join(__dirname, `../data/auth_${userId}_${sessionId}`);

// ── Versión WA ─────────────────────────────────────────────────────────────
const getVersion = async () => {
    try {
        const { version } = await fetchLatestBaileysVersion();
        console.log('[wibc.ai] Versión WA:', version.join('.'));
        return version;
    } catch (e) {
        console.warn('[wibc.ai] Versión fallback:', e.message);
        return [2, 3000, 1015901307];
    }
};

// ── Matar socket (solo el de esa clave) ────────────────────────────────────
// preventReconnect=true evita que el handler de 'close' intente reconectar
const killSocket = (kk, preventReconnect = false) => {
    if (preventReconnect) everConn[kk] = false;
    try { if (sockets[kk]) sockets[kk].end(); } catch (_) {}
    delete sockets[kk];
    delete qrMap[kk];
};

// ── Crear socket nuevo (mata el anterior de la misma clave si existe) ───────
const buildSocket = async (userId, sessionId) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);

    // Matar socket anterior de ESTA misma clave antes de crear uno nuevo
    if (sockets[kk]) {
        console.log(`[wibc.ai] Limpiando socket anterior ${kk}`);
        killSocket(kk, true);
    }

    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, 'creds.json'))) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(folder);
    const version = await getVersion();

    statuses[kk] = 'connecting';
    console.log(`[wibc.ai] Creando socket ${kk}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '22.04'],
        syncFullHistory: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 0,
    });

    sockets[kk] = sock;
    sock.ev.on('creds.update', saveCreds);

    // Responder mensajes entrantes vía IA
    sock.ev.on('messages.upsert', async ({ messages }) => {
        // Ignorar si este socket ya no es el activo para esta clave
        if (sockets[kk] !== sock) return;
        const msg = messages[0];
        if (!msg?.message || msg.key.fromMe) return;
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text || '';
        if (!text) return;
        try {
            const reply = await generateAIResponse(userId, text);
            if (reply) await sock.sendMessage(msg.key.remoteJid, { text: reply });
        } catch (e) {
            console.error('[wibc.ai] AI error:', e.message);
        }
    });

    return sock;
};

// ── Flujo QR ───────────────────────────────────────────────────────────────
const connectQR = async (userId, sessionId) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);
    const isNew  = !fs.existsSync(path.join(folder, 'creds.json'));

    if (!userSets[userId]) userSets[userId] = new Set();
    userSets[userId].add(sessionId);

    let sock;
    try {
        sock = await buildSocket(userId, sessionId);
    } catch (err) {
        console.error(`[wibc.ai] Error buildSocket QR ${kk}:`, err.message);
        statuses[kk] = 'disconnected';
        return;
    }

    let qrTimer = null;
    if (isNew) {
        qrTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                console.log(`[wibc.ai] QR timeout ${kk}`);
                statuses[kk] = 'timeout';
                delete qrMap[kk];
                killSocket(kk, true);
            }
        }, 60_000);
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        // Ignorar eventos de sockets que ya no son el activo para esta clave
        if (sockets[kk] !== sock) return;

        if (qr) {
            qrMap[kk] = qr;
            console.log(`[wibc.ai] QR listo ${kk}`);
        }

        if (connection === 'close') {
            clearTimeout(qrTimer);
            delete qrMap[kk];
            const code = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.statusCode;
            console.log(`[wibc.ai] QR cierre ${kk} | código: ${code}`);

            if (code === DisconnectReason.loggedOut) {
                statuses[kk] = 'disconnected';
                everConn[kk] = false;
                delete deviceMap[kk];
                if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
                userSets[userId]?.delete(sessionId);
            } else if (everConn[kk]) {
                statuses[kk] = 'disconnected';
                console.log(`[wibc.ai] Reconectando ${kk} en 5s...`);
                setTimeout(() => connectQR(userId, sessionId), 5_000);
            } else {
                statuses[kk] = 'disconnected';
            }

        } else if (connection === 'open') {
            clearTimeout(qrTimer);
            delete qrMap[kk];
            everConn[kk] = true;
            statuses[kk] = 'connected';
            const me    = sock.authState?.creds?.me;
            const phone = me?.id?.split(':')[0]?.split('@')[0] ?? 'Desconocido';
            deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
            console.log(`[wibc.ai] ✅ Conectado QR ${kk} (${phone})`);
        }
    });
};

// ── Flujo Código de Emparejamiento ─────────────────────────────────────────
const connectPairing = (userId, sessionId, phoneNumber) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);

    // ── Cancelar pairing anterior de ESTE usuario (solo 1 activo por usuario) ──
    if (activePairing[userId]) {
        const prev = activePairing[userId];
        console.log(`[wibc.ai] Cancelando pairing anterior ${prev.sessionId} de usuario ${userId}`);
        prev.cancel();
    }

    // Carpeta siempre limpia para pairing
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });

    if (!userSets[userId]) userSets[userId] = new Set();

    // Limpiar sesiones viejas que ya no están conectadas de este usuario
    for (const sid of [...(userSets[userId])]) {
        const k = makeKey(userId, sid);
        if (statuses[k] !== 'connected') {
            userSets[userId].delete(sid);
        }
    }
    userSets[userId].add(sessionId);

    return new Promise(async (resolve, reject) => {
        let codeObtained = false;
        let cancelled    = false;
        let aliveTimer, noQRTimer, sock;

        // Limpiar todo y liberar recursos de esta sesión
        const cleanup = (reason) => {
            console.log(`[wibc.ai] Cleanup pairing ${kk}: ${reason}`);
            clearTimeout(aliveTimer);
            clearTimeout(noQRTimer);
            // Solo matar si este socket sigue siendo el activo para esta clave
            if (sock && sockets[kk] === sock) {
                killSocket(kk, true);
            }
            statuses[kk] = 'disconnected';
            userSets[userId]?.delete(sessionId);
            if (activePairing[userId]?.sessionId === sessionId) {
                delete activePairing[userId];
            }
        };

        // Máximo 5 minutos para que el usuario ingrese el código en WhatsApp
        aliveTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                cleanup('timeout 5 min');
                statuses[kk] = 'timeout';
                reject(new Error('Tiempo agotado. Solicita un nuevo código.'));
            }
        }, 300_000);

        // Si WhatsApp no responde en 30s, hay un problema de red
        noQRTimer = setTimeout(() => {
            if (!codeObtained) {
                cleanup('sin QR en 30s');
                reject(new Error('Sin respuesta de WhatsApp. Intenta de nuevo.'));
            }
        }, 30_000);

        // Registrar este pairing como el activo del usuario
        activePairing[userId] = {
            sessionId,
            cancel: () => {
                if (cancelled) return;
                cancelled = true;
                cleanup('cancelado por nueva solicitud del mismo usuario');
                reject(new Error('Se inició una nueva solicitud de vinculación.'));
            },
        };

        // Crear socket
        try {
            sock = await buildSocket(userId, sessionId);
        } catch (err) {
            cleanup(`error buildSocket: ${err.message}`);
            return reject(err);
        }

        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (cancelled) return;
            // Ignorar si este socket ya no es el activo
            if (sockets[kk] !== sock) return;

            // ── Momento exacto para pedir el código: cuando WA emite el QR ──
            if (qr && !codeObtained) {
                codeObtained = true;
                clearTimeout(noQRTimer);
                const clean = phoneNumber.replace(/\D/g, '');
                console.log(`[wibc.ai] QR recibido → pidiendo código para ${clean}`);
                try {
                    const code = await sock.requestPairingCode(clean);
                    console.log(`[wibc.ai] ✅ Código obtenido ${kk}: ${code}`);
                    resolve(code);
                    // No hacemos cleanup aquí — el socket debe seguir vivo
                    // para recibir la confirmación cuando el usuario ingrese el código
                } catch (err) {
                    console.error(`[wibc.ai] ❌ requestPairingCode falló ${kk}:`, err.message);
                    cleanup(`error requestPairingCode: ${err.message}`);
                    reject(err);
                }
            }

            if (connection === 'close') {
                clearTimeout(aliveTimer);
                clearTimeout(noQRTimer);
                delete qrMap[kk];
                const code = lastDisconnect?.error instanceof Boom
                    ? lastDisconnect.error.output.statusCode
                    : lastDisconnect?.error?.statusCode;
                console.log(`[wibc.ai] Pairing cierre ${kk} | código: ${code}`);

                if (everConn[kk]) {
                    // Ya estuvo conectado → reconectar normalmente
                    statuses[kk] = 'disconnected';
                    if (activePairing[userId]?.sessionId === sessionId) delete activePairing[userId];
                    setTimeout(() => connectQR(userId, sessionId), 5_000);
                } else {
                    // Nunca se conectó → limpiar
                    cleanup(`cierre antes de conectar (código WA: ${code})`);
                    if (!codeObtained) reject(new Error('Conexión cerrada antes de obtener código.'));
                }

            } else if (connection === 'open') {
                clearTimeout(aliveTimer);
                clearTimeout(noQRTimer);
                everConn[kk] = true;
                statuses[kk] = 'connected';
                delete qrMap[kk];
                if (activePairing[userId]?.sessionId === sessionId) delete activePairing[userId];
                const me    = sock.authState?.creds?.me;
                const phone = me?.id?.split(':')[0]?.split('@')[0] ?? phoneNumber;
                deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
                console.log(`[wibc.ai] ✅ Conectado pairing ${kk} (${phone})`);
            }
        });
    });
};

// ── Desconectar (solo esta sesión, sin afectar otras) ─────────────────────
const disconnectSession = (userId, sessionId) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);
    console.log(`[wibc.ai] Desconectando ${kk}`);
    // Poner everConn=false ANTES de matar el socket para evitar reconexión
    everConn[kk] = false;
    killSocket(kk);
    statuses[kk] = 'disconnected';
    delete deviceMap[kk];
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    userSets[userId]?.delete(sessionId);
    console.log(`[wibc.ai] ✅ Desconectado ${kk}`);
};

// ── HTTP Handlers ──────────────────────────────────────────────────────────
const getQRHandler = (req, res) => {
    const kk = makeKey(req.params.userId, req.params.sessionId);
    if (statuses[kk] === 'connected') return res.json({ connected: true,  status: 'connected', qr: null });
    if (statuses[kk] === 'timeout')   return res.json({ connected: false, status: 'timeout',   qr: null });
    if (qrMap[kk])                    return res.json({ connected: false, status: 'qr_ready',  qr: qrMap[kk] });
    res.json({ connected: false, status: statuses[kk] || 'idle', qr: null });
};

const getDevicesHandler = (req, res) => {
    const { userId } = req.params;
    const list = [...(userSets[userId] || [])].map(sessionId => {
        const kk = makeKey(userId, sessionId);
        return {
            sessionId,
            status: statuses[kk] || 'disconnected',
            device: deviceMap[kk] || null,
        };
    });
    res.json({ sessions: list });
};

const initSessionHandler = (req, res) => {
    const { userId, sessionId: sid } = req.body;
    const sessionId = sid || Date.now().toString(36);
    const kk = makeKey(userId, sessionId);
    if (!sockets[kk] || statuses[kk] === 'disconnected' || statuses[kk] === 'timeout') {
        connectQR(userId, sessionId);
    }
    res.json({ success: true, sessionId });
};

module.exports = {
    startBaileys:                connectQR,
    startBaileysWithPairingCode: connectPairing,
    disconnectSession,
    getQRHandler,
    getDevicesHandler,
    initSessionHandler,
    userSessions: userSets,
};
