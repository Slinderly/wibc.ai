const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino   = require('pino');
const path   = require('path');
const fs     = require('fs');
const { generateAIResponse } = require('./ai');

// ── Estado global — clave = `${userId}:${sessionId}` ──────────────────────
const sockets       = {};  // clave → socket
const statuses      = {};  // clave → 'connecting'|'connected'|'disconnected'|'timeout'
const qrMap         = {};  // clave → string QR
const deviceMap     = {};  // clave → { phone, name, connectedAt }
const everConn      = {};  // clave → bool (alguna vez conectado)
const userSets      = {};  // userId → Set<sessionId>
const activePairing = {};  // userId → { sessionId, cancel }

const makeKey = (u, s) => `${u}:${s}`;
const authDir = (u, s) => path.join(__dirname, `../data/auth_${u}_${s}`);

// ── Versión WA — se obtiene UNA sola vez y se cachea ──────────────────────
let cachedVersion = null;
const getVersion = async () => {
    if (cachedVersion) return cachedVersion;
    try {
        const { version } = await fetchLatestBaileysVersion();
        cachedVersion = version;
        console.log('[wibc.ai] Versión WA cacheada:', version.join('.'));
    } catch (e) {
        cachedVersion = [2, 3000, 1015901307];
        console.warn('[wibc.ai] Versión fallback:', e.message);
    }
    return cachedVersion;
};

// ── Matar socket limpiamente ───────────────────────────────────────────────
const killSocket = (kk, preventReconnect = false) => {
    if (preventReconnect) everConn[kk] = false;
    try { if (sockets[kk]) sockets[kk].end(); } catch (_) {}
    delete sockets[kk];
    delete qrMap[kk];
};

// ── Crear socket (mata el anterior de la misma clave si existe) ────────────
const buildSocket = async (userId, sessionId) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);

    if (sockets[kk]) {
        console.log(`[wibc.ai] Reemplazando socket anterior ${kk}`);
        killSocket(kk, true);
    }

    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, 'creds.json')))
        fs.rmSync(folder, { recursive: true, force: true });
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(folder);
    const version = await getVersion();   // rápido: usa caché

    statuses[kk] = 'connecting';
    console.log(`[wibc.ai] Creando socket ${kk}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),   // compatible con WA y WA Business
        syncFullHistory: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 0,
    });

    sockets[kk] = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (sockets[kk] !== sock) return;   // socket obsoleto
        const msg = messages[0];
        if (!msg?.message || msg.key.fromMe) return;
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text || '';
        if (!text) return;
        try {
            const reply = await generateAIResponse(userId, text);
            if (reply) await sock.sendMessage(msg.key.remoteJid, { text: reply });
        } catch (e) { console.error('[wibc.ai] AI error:', e.message); }
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
    try { sock = await buildSocket(userId, sessionId); }
    catch (err) {
        console.error(`[wibc.ai] Error QR buildSocket ${kk}:`, err.message);
        statuses[kk] = 'disconnected'; return;
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
        if (sockets[kk] !== sock) return;

        if (qr) { qrMap[kk] = qr; console.log(`[wibc.ai] QR listo ${kk}`); }

        if (connection === 'close') {
            clearTimeout(qrTimer);
            delete qrMap[kk];
            const code = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.statusCode;
            console.log(`[wibc.ai] QR cierre ${kk} | código: ${code}`);

            if (code === DisconnectReason.loggedOut) {
                statuses[kk] = 'disconnected'; everConn[kk] = false;
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
            everConn[kk] = true; statuses[kk] = 'connected';
            const me    = sock.authState?.creds?.me;
            const phone = me?.id?.split(':')[0]?.split('@')[0] ?? 'Desconocido';
            deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
            console.log(`[wibc.ai] ✅ Conectado QR ${kk} (${phone})`);
        }
    });
};

// ── Flujo Código de Emparejamiento ─────────────────────────────────────────
// Compatible con WhatsApp normal y WhatsApp Business.
// WA Business envía código 515 (restartRequired) como parte normal del
// handshake al vincular: detectamos esto y reconectamos sin limpiar estado.
const connectPairing = (userId, sessionId, phoneNumber) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);

    // Cancelar pairing anterior de este usuario (máximo 1 activo)
    if (activePairing[userId]) {
        const prev = activePairing[userId];
        console.log(`[wibc.ai] Cancelando pairing anterior ${prev.sessionId} → ${userId}`);
        prev.cancel();
    }

    // Carpeta siempre limpia al iniciar pairing
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });

    if (!userSets[userId]) userSets[userId] = new Set();
    // Eliminar sesiones viejas no conectadas
    for (const sid of [...(userSets[userId])]) {
        if (statuses[makeKey(userId, sid)] !== 'connected') userSets[userId].delete(sid);
    }
    userSets[userId].add(sessionId);

    return new Promise(async (resolve, reject) => {
        let codeObtained = false;
        let cancelled    = false;
        let aliveTimer, noQRTimer;
        let currentSock  = null;

        // Limpieza completa
        const cleanup = (reason) => {
            console.log(`[wibc.ai] Cleanup pairing ${kk}: ${reason}`);
            clearTimeout(aliveTimer);
            clearTimeout(noQRTimer);
            if (currentSock && sockets[kk] === currentSock) killSocket(kk, true);
            statuses[kk] = 'disconnected';
            userSets[userId]?.delete(sessionId);
            if (activePairing[userId]?.sessionId === sessionId) delete activePairing[userId];
        };

        // 5 minutos para que el usuario ingrese el código en WhatsApp
        aliveTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                cleanup('timeout 5min'); statuses[kk] = 'timeout';
                reject(new Error('Tiempo agotado. Solicita un nuevo código.'));
            }
        }, 300_000);

        // 30s para que WhatsApp responda con QR
        noQRTimer = setTimeout(() => {
            if (!codeObtained) {
                cleanup('sin QR en 30s');
                reject(new Error('Sin respuesta de WhatsApp. Intenta de nuevo.'));
            }
        }, 30_000);

        activePairing[userId] = {
            sessionId,
            cancel: () => {
                if (cancelled) return;
                cancelled = true;
                cleanup('cancelado por nueva solicitud');
                reject(new Error('Se inició una nueva solicitud de vinculación.'));
            },
        };

        // Función que adjunta el handler de conexión a un socket.
        // Se usa también al reconectar después de 515.
        const attachHandler = (sock) => {
            sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                if (cancelled) return;
                if (sockets[kk] !== sock) return;   // socket obsoleto

                // ── Único momento correcto para pedir el código ────────────
                if (qr && !codeObtained) {
                    codeObtained = true;
                    clearTimeout(noQRTimer);
                    const clean = phoneNumber.replace(/\D/g, '');
                    console.log(`[wibc.ai] QR → pidiendo código para ${clean}`);
                    try {
                        const code = await sock.requestPairingCode(clean);
                        console.log(`[wibc.ai] ✅ Código obtenido ${kk}: ${code}`);
                        resolve(code);
                        // El socket sigue vivo esperando que el usuario ingrese el código
                    } catch (err) {
                        console.error(`[wibc.ai] ❌ requestPairingCode ${kk}:`, err.message);
                        cleanup(`error requestPairingCode: ${err.message}`);
                        reject(err);
                    }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error instanceof Boom
                        ? lastDisconnect.error.output.statusCode
                        : lastDisconnect?.error?.statusCode;
                    console.log(`[wibc.ai] Pairing cierre ${kk} | código: ${code}`);

                    // ── 515 = restartRequired ──────────────────────────────
                    // WA Business envía esto como parte NORMAL del handshake
                    // cuando el usuario ingresa el código. Hay que reconectar.
                    if (code === DisconnectReason.restartRequired && codeObtained && !cancelled) {
                        console.log(`[wibc.ai] WA requiere reinicio (515) ${kk} — reconectando...`);
                        statuses[kk] = 'connecting';
                        try {
                            const newSock = await buildSocket(userId, sessionId);
                            currentSock = newSock;
                            attachHandler(newSock);
                        } catch (err) {
                            cleanup(`error al reconectar tras 515: ${err.message}`);
                            reject(err);
                        }
                        return;
                    }

                    clearTimeout(aliveTimer);
                    clearTimeout(noQRTimer);
                    delete qrMap[kk];

                    if (everConn[kk]) {
                        statuses[kk] = 'disconnected';
                        if (activePairing[userId]?.sessionId === sessionId) delete activePairing[userId];
                        setTimeout(() => connectQR(userId, sessionId), 5_000);
                    } else {
                        cleanup(`cierre sin conexión (código: ${code})`);
                        if (!codeObtained) reject(new Error('Conexión cerrada antes de obtener código.'));
                    }

                } else if (connection === 'open') {
                    clearTimeout(aliveTimer);
                    clearTimeout(noQRTimer);
                    everConn[kk] = true; statuses[kk] = 'connected';
                    delete qrMap[kk];
                    if (activePairing[userId]?.sessionId === sessionId) delete activePairing[userId];
                    const me    = sock.authState?.creds?.me;
                    const phone = me?.id?.split(':')[0]?.split('@')[0] ?? phoneNumber;
                    deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
                    console.log(`[wibc.ai] ✅ Conectado pairing ${kk} (${phone})`);
                }
            });
        };

        // Crear socket inicial
        try {
            currentSock = await buildSocket(userId, sessionId);
            attachHandler(currentSock);
        } catch (err) {
            cleanup(`error buildSocket inicial: ${err.message}`);
            return reject(err);
        }
    });
};

// ── Desconectar ────────────────────────────────────────────────────────────
const disconnectSession = (userId, sessionId) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);
    console.log(`[wibc.ai] Desconectando ${kk}`);
    everConn[kk] = false;   // antes de killSocket para evitar auto-reconexión
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
        return { sessionId, status: statuses[kk] || 'disconnected', device: deviceMap[kk] || null };
    });
    res.json({ sessions: list });
};

const initSessionHandler = (req, res) => {
    const { userId, sessionId: sid } = req.body;
    const sessionId = sid || Date.now().toString(36);
    const kk = makeKey(userId, sessionId);
    if (!sockets[kk] || statuses[kk] === 'disconnected' || statuses[kk] === 'timeout')
        connectQR(userId, sessionId);
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
