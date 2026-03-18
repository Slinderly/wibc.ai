const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { generateAIResponse } = require('./ai');

// ── State ──────────────────────────────────────────────────────────────────
const sockets    = {};  // key → socket instance
const statuses   = {};  // key → 'connecting' | 'connected' | 'disconnected' | 'timeout'
const qrMap      = {};  // key → raw QR string
const deviceMap  = {};  // key → { phone, name, connectedAt }
const everConn   = {};  // key → boolean (was ever connected in this run)
const userSets   = {};  // userId → Set<sessionId>

const makeKey  = (userId, sessionId) => `${userId}:${sessionId}`;
const authDir  = (userId, sessionId) => path.join(__dirname, `../data/auth_${userId}_${sessionId}`);

// ── Get WA version (with fallback) ────────────────────────────────────────
const getVersion = async () => {
    try {
        const { version } = await fetchLatestBaileysVersion();
        console.log('[wibc.ai] Versión WA:', version.join('.'));
        return version;
    } catch (e) {
        console.warn('[wibc.ai] fetchLatestBaileysVersion falló, usando fallback:', e.message);
        return [2, 3000, 1015901307];
    }
};

// ── Kill socket cleanly ────────────────────────────────────────────────────
const killSocket = (k) => {
    try { if (sockets[k]) sockets[k].end(); } catch (_) {}
    delete sockets[k];
    delete qrMap[k];
};

// ── Build a new socket (shared between QR and pairing flows) ───────────────
const buildSocket = async (userId, sessionId) => {
    const folder = authDir(userId, sessionId);

    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, 'creds.json'))) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(folder);
    const version = await getVersion();
    const k = makeKey(userId, sessionId);

    statuses[k] = 'connecting';
    console.log(`[wibc.ai] Creando socket ${k}`);

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

    sockets[k] = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
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

// ── QR flow ────────────────────────────────────────────────────────────────
const connectQR = async (userId, sessionId) => {
    const folder = authDir(userId, sessionId);
    const isNew  = !fs.existsSync(path.join(folder, 'creds.json'));

    if (!userSets[userId]) userSets[userId] = new Set();
    userSets[userId].add(sessionId);

    let sock;
    try {
        sock = await buildSocket(userId, sessionId);
    } catch (err) {
        console.error('[wibc.ai] buildSocket error:', err.message);
        statuses[makeKey(userId, sessionId)] = 'disconnected';
        return;
    }

    const kk = makeKey(userId, sessionId);
    let qrTimer = null;

    if (isNew) {
        qrTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                console.log(`[wibc.ai] QR timeout ${kk}`);
                statuses[kk] = 'timeout';
                delete qrMap[kk];
                killSocket(kk);
            }
        }, 60_000);
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrMap[kk] = qr;
            console.log(`[wibc.ai] QR generado ${kk}`);
        }

        if (connection === 'close') {
            clearTimeout(qrTimer);
            delete qrMap[kk];
            const code = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.statusCode;

            console.log(`[wibc.ai] Conexión cerrada ${kk} | código: ${code}`);

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

// ── Pairing Code flow ──────────────────────────────────────────────────────
const connectPairing = async (userId, sessionId, phoneNumber) => {
    const folder = authDir(userId, sessionId);
    const kk     = makeKey(userId, sessionId);

    // Always fresh for pairing
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });

    if (!userSets[userId]) userSets[userId] = new Set();
    userSets[userId].add(sessionId);

    return new Promise(async (resolve, reject) => {
        let codeObtained = false;

        // Keep socket alive 5 min (user needs time to enter code)
        const aliveTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                console.log(`[wibc.ai] Pairing timeout global ${kk}`);
                statuses[kk] = 'timeout';
                killSocket(kk);
                userSets[userId]?.delete(sessionId);
            }
        }, 300_000);

        // If QR never fires within 30s, something is wrong with the network
        const noQRTimer = setTimeout(() => {
            if (!codeObtained) {
                clearTimeout(aliveTimer);
                killSocket(kk);
                statuses[kk] = 'disconnected';
                userSets[userId]?.delete(sessionId);
                reject(new Error('Sin respuesta de WhatsApp. Intenta de nuevo.'));
            }
        }, 30_000);

        let sock;
        try {
            sock = await buildSocket(userId, sessionId);
        } catch (err) {
            clearTimeout(aliveTimer);
            clearTimeout(noQRTimer);
            return reject(err);
        }

        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            // This is the ONLY correct moment to call requestPairingCode
            if (qr && !codeObtained) {
                codeObtained = true;
                clearTimeout(noQRTimer);
                const clean = phoneNumber.replace(/\D/g, '');
                console.log(`[wibc.ai] QR recibido, pidiendo código para ${clean}`);
                try {
                    const code = await sock.requestPairingCode(clean);
                    console.log(`[wibc.ai] ✅ Código obtenido ${kk}: ${code}`);
                    resolve(code);
                } catch (err) {
                    console.error(`[wibc.ai] ❌ requestPairingCode falló ${kk}:`, err.message);
                    clearTimeout(aliveTimer);
                    statuses[kk] = 'disconnected';
                    killSocket(kk);
                    userSets[userId]?.delete(sessionId);
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

                console.log(`[wibc.ai] Pairing conexión cerrada ${kk} | código: ${code}`);

                if (everConn[kk]) {
                    statuses[kk] = 'disconnected';
                    setTimeout(() => connectQR(userId, sessionId), 5_000);
                } else {
                    statuses[kk] = 'disconnected';
                    if (code === DisconnectReason.loggedOut && fs.existsSync(folder)) {
                        fs.rmSync(folder, { recursive: true, force: true });
                    }
                    userSets[userId]?.delete(sessionId);
                    if (!codeObtained) reject(new Error('Conexión cerrada antes de obtener código'));
                }

            } else if (connection === 'open') {
                clearTimeout(aliveTimer);
                clearTimeout(noQRTimer);
                everConn[kk] = true;
                statuses[kk] = 'connected';
                delete qrMap[kk];
                const me    = sock.authState?.creds?.me;
                const phone = me?.id?.split(':')[0]?.split('@')[0] ?? phoneNumber;
                deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
                console.log(`[wibc.ai] ✅ Conectado pairing ${kk} (${phone})`);
            }
        });
    });
};

// ── Disconnect ─────────────────────────────────────────────────────────────
const disconnectSession = (userId, sessionId) => {
    const kk     = makeKey(userId, sessionId);
    const folder = authDir(userId, sessionId);
    killSocket(kk);
    statuses[kk] = 'disconnected';
    everConn[kk] = false;
    delete deviceMap[kk];
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    userSets[userId]?.delete(sessionId);
    console.log(`[wibc.ai] Desconectado ${kk}`);
};

// ── HTTP Handlers ──────────────────────────────────────────────────────────
const getQRHandler = (req, res) => {
    const kk = makeKey(req.params.userId, req.params.sessionId);
    if (statuses[kk] === 'connected') return res.json({ connected: true,  status: 'connected',  qr: null });
    if (statuses[kk] === 'timeout')   return res.json({ connected: false, status: 'timeout',    qr: null });
    if (qrMap[kk])                    return res.json({ connected: false, status: 'qr_ready',   qr: qrMap[kk] });
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
    if (!sockets[kk] || statuses[kk] === 'disconnected' || statuses[kk] === 'timeout') {
        connectQR(userId, sessionId);
    }
    res.json({ success: true, sessionId });
};

module.exports = {
    startBaileys:              connectQR,
    startBaileysWithPairingCode: connectPairing,
    disconnectSession,
    getQRHandler,
    getDevicesHandler,
    initSessionHandler,
    userSessions: userSets,
};
