const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const { generateAIResponse } = require('./ai');

// State maps – keyed by sessionKey = `${userId}:${sessionId}`
const sessions       = {};
const qrCodes        = {};
const connStatus     = {};  // 'connecting' | 'connected' | 'disconnected' | 'timeout'
const deviceInfo     = {};  // { phone, name, connectedAt }
const wasConnected   = {};
const userSessions   = {};  // userId -> Set of sessionIds

const makeKey = (userId, sessionId) => `${userId}:${sessionId}`;

const authFolder = (userId, sessionId) =>
    path.join(__dirname, `../data/auth_${userId}_${sessionId}`);

// Terminate socket cleanly
const terminateSession = (key) => {
    try { if (sessions[key]) sessions[key].end(); } catch (_) {}
    delete sessions[key];
    delete qrCodes[key];
};

const createSocket = async (userId, sessionId) => {
    const folder = authFolder(userId, sessionId);

    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, 'creds.json'))) {
        fs.rmSync(folder, { recursive: true, force: true });
    }
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(folder);

    let version;
    try {
        const result = await fetchLatestBaileysVersion();
        version = result.version;
    } catch (_) {
        version = [2, 3000, 1015901307];
    }

    const key = makeKey(userId, sessionId);

    connStatus[key] = 'connecting';

    const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WhatsApp', 'Chrome', '126.0.6478.127'],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        qrTimeout: 60000,
    });

    sessions[key] = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (text) {
            const reply = await generateAIResponse(userId, text);
            if (reply) await sock.sendMessage(msg.key.remoteJid, { text: reply });
        }
    });

    return sock;
};

const startBaileys = async (userId, sessionId) => {
    const key = makeKey(userId, sessionId);
    const folder = authFolder(userId, sessionId);
    const isNew = !fs.existsSync(path.join(folder, 'creds.json'));
    let qrTimeout = null;

    // Track session for this user
    if (!userSessions[userId]) userSessions[userId] = new Set();
    userSessions[userId].add(sessionId);

    const sock = await createSocket(userId, sessionId);

    if (isNew) {
        qrTimeout = setTimeout(() => {
            if (connStatus[key] !== 'connected') {
                console.log(`[wibc.ai] Timeout QR ${key}`);
                connStatus[key] = 'timeout';
                delete qrCodes[key];
                terminateSession(key);
            }
        }, 60000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodes[key] = qr;
        }

        if (connection === 'close') {
            clearTimeout(qrTimeout);
            const code = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : lastDisconnect.error?.statusCode;

            delete qrCodes[key];

            if (code === DisconnectReason.loggedOut) {
                console.log(`[wibc.ai] LoggedOut ${key}`);
                connStatus[key] = 'disconnected';
                wasConnected[key] = false;
                delete deviceInfo[key];
                if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
                userSessions[userId]?.delete(sessionId);
            } else if (wasConnected[key]) {
                connStatus[key] = 'disconnected';
                console.log(`[wibc.ai] Reconectando ${key} en 5s...`);
                setTimeout(() => startBaileys(userId, sessionId), 5000);
            } else {
                connStatus[key] = 'disconnected';
                console.log(`[wibc.ai] ${key} cerrado sin conectar. No se reintenta.`);
            }

        } else if (connection === 'open') {
            clearTimeout(qrTimeout);
            wasConnected[key] = true;
            connStatus[key] = 'connected';
            delete qrCodes[key];

            const me = sock.authState?.creds?.me;
            const rawPhone = me?.id ? me.id.split(':')[0].split('@')[0] : null;
            deviceInfo[key] = {
                phone: rawPhone || 'Desconocido',
                name: me?.name || null,
                connectedAt: new Date().toISOString(),
            };
            console.log(`[wibc.ai] Conectado ${key} (${deviceInfo[key].phone})`);
        }
    });
};

const startBaileysWithPairingCode = async (userId, sessionId, phoneNumber) => {
    const key = makeKey(userId, sessionId);
    const folder = authFolder(userId, sessionId);

    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });

    if (!userSessions[userId]) userSessions[userId] = new Set();
    userSessions[userId].add(sessionId);

    const sock = await createSocket(userId, sessionId);

    const qrTimeout = setTimeout(() => {
        if (connStatus[key] !== 'connected') {
            connStatus[key] = 'timeout';
            delete qrCodes[key];
            terminateSession(key);
        }
    }, 60000);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            clearTimeout(qrTimeout);
            const code = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : lastDisconnect.error?.statusCode;

            delete qrCodes[key];

            if (wasConnected[key]) {
                connStatus[key] = 'disconnected';
                setTimeout(() => startBaileys(userId, sessionId), 5000);
            } else {
                connStatus[key] = 'disconnected';
                if (code === DisconnectReason.loggedOut && fs.existsSync(folder)) {
                    fs.rmSync(folder, { recursive: true, force: true });
                }
                userSessions[userId]?.delete(sessionId);
            }
        } else if (connection === 'open') {
            clearTimeout(qrTimeout);
            wasConnected[key] = true;
            connStatus[key] = 'connected';
            delete qrCodes[key];

            const me = sock.authState?.creds?.me;
            const rawPhone = me?.id ? me.id.split(':')[0].split('@')[0] : null;
            deviceInfo[key] = {
                phone: rawPhone || phoneNumber,
                name: me?.name || null,
                connectedAt: new Date().toISOString(),
            };
            console.log(`[wibc.ai] Conectado por código ${key} (${deviceInfo[key].phone})`);
        }
    });

    return new Promise((resolve, reject) => {
        const codeTimeout = setTimeout(() => reject(new Error('Timeout código')), 15000);
        setTimeout(async () => {
            try {
                const clean = phoneNumber.replace(/\D/g, '');
                const code = await sock.requestPairingCode(clean);
                clearTimeout(codeTimeout);
                resolve(code);
            } catch (err) {
                clearTimeout(codeTimeout);
                reject(err);
            }
        }, 3000);
    });
};

const disconnectSession = (userId, sessionId) => {
    const key = makeKey(userId, sessionId);
    const folder = authFolder(userId, sessionId);
    terminateSession(key);
    connStatus[key] = 'disconnected';
    wasConnected[key] = false;
    delete deviceInfo[key];
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    userSessions[userId]?.delete(sessionId);
};

// HTTP handlers
const getQRHandler = (req, res) => {
    const { userId, sessionId } = req.params;
    const key = makeKey(userId, sessionId);
    const status = connStatus[key];

    if (status === 'connected')  return res.json({ qr: null, connected: true,  status: 'connected' });
    if (status === 'timeout')    return res.json({ qr: null, connected: false, status: 'timeout' });
    if (qrCodes[key])            return res.json({ qr: qrCodes[key], connected: false, status: 'qr_ready' });
    res.json({ qr: null, connected: false, status: status || 'idle' });
};

const getDevicesHandler = (req, res) => {
    const { userId } = req.params;
    const ids = [...(userSessions[userId] || [])];
    const list = ids.map(sessionId => {
        const key = makeKey(userId, sessionId);
        return {
            sessionId,
            status: connStatus[key] || 'disconnected',
            device: deviceInfo[key] || null,
        };
    });
    res.json({ sessions: list });
};

const initSessionHandler = (req, res) => {
    const { userId, sessionId: reqSessionId } = req.body;
    const sessionId = reqSessionId || Date.now().toString(36);
    const key = makeKey(userId, sessionId);

    if (!sessions[key] || connStatus[key] === 'disconnected' || connStatus[key] === 'timeout') {
        startBaileys(userId, sessionId);
    }
    res.json({ success: true, sessionId });
};

module.exports = {
    startBaileys,
    startBaileysWithPairingCode,
    disconnectSession,
    getQRHandler,
    getDevicesHandler,
    initSessionHandler,
    userSessions,
};
