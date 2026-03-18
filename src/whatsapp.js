const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const sessions = {};
const qrCodes = {};
const connectionStatus = {};
const deviceInfo = {};   // { phone, connectedAt, name }
const wasConnected = {}; // whether this session ever reached 'open'

const { generateAIResponse } = require('./ai');

// Terminate a session cleanly
const terminateSession = (userId) => {
    try {
        if (sessions[userId]) {
            sessions[userId].end();
        }
    } catch (_) {}
    delete sessions[userId];
    delete qrCodes[userId];
    connectionStatus[userId] = 'disconnected';
};

const createSocket = async (userId) => {
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);

    if (fs.existsSync(authFolder) && !fs.existsSync(path.join(authFolder, 'creds.json'))) {
        fs.rmSync(authFolder, { recursive: true, force: true });
    }
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    connectionStatus[userId] = 'connecting';
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
    });

    sessions[userId] = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;

        const messageText = msg.message.conversation ||
                            msg.message.extendedTextMessage?.text || '';
        if (messageText) {
            const reply = await generateAIResponse(userId, messageText);
            if (reply) {
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        }
    });

    return { sock, state };
};

const startBaileys = async (userId) => {
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);
    const isNewSession = !fs.existsSync(path.join(authFolder, 'creds.json'));
    let qrTimeout = null;

    const { sock } = await createSocket(userId);

    // For brand-new sessions (no saved creds), stop after 30s if not connected
    if (isNewSession) {
        qrTimeout = setTimeout(() => {
            if (connectionStatus[userId] !== 'connected') {
                console.log(`[wibc.ai] Timeout de 30s para ${userId}. Terminando sesión sin conexión.`);
                connectionStatus[userId] = 'timeout';
                delete qrCodes[userId];
                terminateSession(userId);
            }
        }, 30000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[wibc.ai] QR generado para ${userId}`);
            qrCodes[userId] = qr;
        }

        if (connection === 'close') {
            clearTimeout(qrTimeout);
            const statusCode = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : lastDisconnect.error?.statusCode;

            connectionStatus[userId] = 'disconnected';
            delete qrCodes[userId];

            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[wibc.ai] Sesión cerrada (loggedOut). Borrando auth_${userId}...`);
                wasConnected[userId] = false;
                delete deviceInfo[userId];
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            } else if (wasConnected[userId]) {
                // Solo reintentar si alguna vez estuvo conectado (sesión guardada)
                console.log(`[wibc.ai] Reconectando ${userId} en 5s...`);
                setTimeout(() => startBaileys(userId), 5000);
            } else {
                console.log(`[wibc.ai] Sesión ${userId} cerrada sin haber conectado. No se reintenta.`);
            }
        } else if (connection === 'open') {
            clearTimeout(qrTimeout);
            wasConnected[userId] = true;
            connectionStatus[userId] = 'connected';
            delete qrCodes[userId];

            // Guardar info del dispositivo conectado
            const me = sock.authState?.creds?.me;
            const rawPhone = me?.id ? me.id.split(':')[0].split('@')[0] : null;
            deviceInfo[userId] = {
                phone: rawPhone || 'Desconocido',
                name: me?.name || null,
                connectedAt: new Date().toISOString(),
            };
            console.log(`[wibc.ai] Conectado para ${userId} (${deviceInfo[userId].phone})`);
        }
    });
};

const startBaileysWithPairingCode = async (userId, phoneNumber) => {
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);

    if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
    }

    const { sock } = await createSocket(userId);

    // 30s timeout for pairing code flow too
    const qrTimeout = setTimeout(() => {
        if (connectionStatus[userId] !== 'connected') {
            console.log(`[wibc.ai] Timeout de 30s (pairing) para ${userId}.`);
            connectionStatus[userId] = 'timeout';
            terminateSession(userId);
        }
    }, 30000);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            clearTimeout(qrTimeout);
            connectionStatus[userId] = 'disconnected';

            if (wasConnected[userId]) {
                setTimeout(() => startBaileys(userId), 5000);
            } else {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : lastDisconnect.error?.statusCode;
                if (statusCode === DisconnectReason.loggedOut && fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            }
        } else if (connection === 'open') {
            clearTimeout(qrTimeout);
            wasConnected[userId] = true;
            connectionStatus[userId] = 'connected';

            const me = sock.authState?.creds?.me;
            const rawPhone = me?.id ? me.id.split(':')[0].split('@')[0] : null;
            deviceInfo[userId] = {
                phone: rawPhone || phoneNumber,
                name: me?.name || null,
                connectedAt: new Date().toISOString(),
            };
            console.log(`[wibc.ai] Conectado por código para ${userId} (${deviceInfo[userId].phone})`);
        }
    });

    return new Promise((resolve, reject) => {
        const codeTimeout = setTimeout(() => {
            reject(new Error('Timeout solicitando código'));
        }, 15000);

        setTimeout(async () => {
            try {
                const cleanPhone = phoneNumber.replace(/\D/g, '');
                console.log(`[wibc.ai] Solicitando código para ${cleanPhone}`);
                const code = await sock.requestPairingCode(cleanPhone);
                clearTimeout(codeTimeout);
                console.log(`[wibc.ai] Código generado: ${code}`);
                resolve(code);
            } catch (err) {
                clearTimeout(codeTimeout);
                reject(err);
            }
        }, 3000);
    });
};

const getQR = (req, res) => {
    const { userId } = req.params;
    const status = connectionStatus[userId];

    if (status === 'connected') {
        return res.json({ qr: null, connected: true, status: 'connected' });
    }
    if (status === 'timeout') {
        return res.json({ qr: null, connected: false, status: 'timeout' });
    }
    if (qrCodes[userId]) {
        return res.json({ qr: qrCodes[userId], connected: false, status: 'qr_ready' });
    }
    res.json({ qr: null, connected: false, status: status || 'idle' });
};

const getDevices = (req, res) => {
    const { userId } = req.params;
    const status = connectionStatus[userId] || 'disconnected';
    const info = deviceInfo[userId] || null;

    res.json({
        status,
        device: info
    });
};

const initSession = (req, res) => {
    const { userId } = req.body;
    if (!sessions[userId] || connectionStatus[userId] === 'disconnected' || connectionStatus[userId] === 'timeout') {
        startBaileys(userId);
    }
    res.json({ success: true });
};

module.exports = { startBaileys, startBaileysWithPairingCode, getQR, getDevices, initSession };
