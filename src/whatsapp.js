const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const sessions = {};
const qrCodes = {};
const connectionStatus = {};
const pairingCodes = {};

const { generateAIResponse } = require('./ai');

const storeQR = (userId, qr) => {
    qrCodes[userId] = qr;
};

const createSocket = async (userId) => {
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);

    if (fs.existsSync(authFolder) && !fs.existsSync(path.join(authFolder, 'creds.json'))) {
        console.log(`[wibc.ai] Carpeta auth_${userId} incompleta. Limpiando...`);
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
    const { sock } = await createSocket(userId);
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[wibc.ai] 🟢 QR generado para ${userId}`);
            qrCodes[userId] = qr;
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : lastDisconnect.error?.statusCode;

            console.error(`[wibc.ai] 🔴 Conexión cerrada (${statusCode})`);
            connectionStatus[userId] = 'disconnected';
            storeQR(userId, null);

            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[wibc.ai] Sesión cerrada. Borrando auth_${userId}...`);
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            } else {
                console.log(`[wibc.ai] Error temporal, reintentando en 3s...`);
                setTimeout(() => startBaileys(userId), 3000);
            }
        } else if (connection === 'open') {
            console.log(`[wibc.ai] ✅ Conectado para ${userId}`);
            connectionStatus[userId] = 'connected';
            storeQR(userId, null);
        }
    });
};

const startBaileysWithPairingCode = async (userId, phoneNumber) => {
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);

    // Limpiar sesión anterior para forzar nuevo emparejamiento
    if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
    }

    const { sock, state } = await createSocket(userId);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout esperando código de emparejamiento'));
        }, 15000);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : lastDisconnect.error?.statusCode;

                connectionStatus[userId] = 'disconnected';
                storeQR(userId, null);

                if (statusCode !== DisconnectReason.loggedOut) {
                    setTimeout(() => startBaileys(userId), 3000);
                } else {
                    if (fs.existsSync(authFolder)) {
                        fs.rmSync(authFolder, { recursive: true, force: true });
                    }
                }
            } else if (connection === 'open') {
                console.log(`[wibc.ai] ✅ Conectado por código para ${userId}`);
                connectionStatus[userId] = 'connected';
                storeQR(userId, null);
            }
        });

        // Solicitar código de emparejamiento tras un breve delay para que el socket se inicialice
        setTimeout(async () => {
            try {
                // Normalizar número: solo dígitos, sin + ni espacios
                const cleanPhone = phoneNumber.replace(/\D/g, '');
                console.log(`[wibc.ai] 📲 Solicitando código para ${cleanPhone}`);
                const code = await sock.requestPairingCode(cleanPhone);
                clearTimeout(timeout);
                pairingCodes[userId] = code;
                console.log(`[wibc.ai] 🔑 Código generado: ${code}`);
                resolve(code);
            } catch (err) {
                clearTimeout(timeout);
                reject(err);
            }
        }, 3000);
    });
};

const getQR = (req, res) => {
    const { userId } = req.params;
    if (qrCodes[userId]) {
        res.json({ qr: qrCodes[userId], connected: false });
    } else {
        res.json({ qr: null, connected: connectionStatus[userId] === 'connected' });
    }
};

const initSession = (req, res) => {
    const { userId } = req.body;

    if (!sessions[userId] || connectionStatus[userId] === 'disconnected') {
        startBaileys(userId);
    }
    res.json({ success: true, message: `Iniciando sesión para ${userId}` });
};

module.exports = { startBaileys, startBaileysWithPairingCode, getQR, initSession };
