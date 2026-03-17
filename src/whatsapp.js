const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const sessions = {};
const qrCodes = {};
const connectionStatus = {};

const { generateAIResponse } = require('./ai');

// Helper: Guardar el QR para el frontend
const storeQR = (userId, qr) => {
    qrCodes[userId] = qr;
};

const startBaileys = async (userId) => {
    const authFolder = path.join(__dirname, `../data/auth_${userId}`);

    if (fs.existsSync(authFolder) && !fs.existsSync(path.join(authFolder, 'creds.json'))) {
        console.log(`[wibc.ai] Carpeta auth_${userId} incompleta. Limpiando para generar nuevo QR...`);
        fs.rmSync(authFolder, { recursive: true, force: true });
    }

    // --- ASEGURAR EXISTENCIA DE LA CARPETA ---
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    connectionStatus[userId] = 'connecting';
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }), // Silent es clave para evitar el error 405 por lag
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        connectTimeoutMs: 60000, // Aumentamos el tiempo de espera
        defaultQueryTimeoutMs: 0,
    });

    sessions[userId] = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[wibc.ai] 🟢 QR Generado para ${userId}. Escanea ahora.`);
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
                console.log(`[wibc.ai] Sesión cerrada o inválida. Borrando rastro de auth_${userId}...`);
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
            } else {
                console.log(`[wibc.ai] Error temporal, reintentando en 3s...`);
                setTimeout(() => startBaileys(userId), 3000);
            }
        } else if (connection === 'open') {
            console.log(`[wibc.ai] ✅ Conectado correctamente para ${userId}`);
            connectionStatus[userId] = 'connected';
            storeQR(userId, null);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.message || msg.key.fromMe) return;

        console.log(`[wibc.ai] Mensaje recibido de ${msg.key.remoteJid}: `, msg.message);
        
        const messageText = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '';

        if (messageText) {
            const reply = await generateAIResponse(userId, messageText);
            
            if (reply) {
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        }
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
    
    // Evitar levantar un socket nuevo si ya existe en memoria y no está desconectado
    if (!sessions[userId] || connectionStatus[userId] === 'disconnected') {
        startBaileys(userId);
    }
    res.json({ success: true, message: `Iniciando sesión de WhatsApp para ${userId}` });
}

module.exports = { startBaileys, getQR, initSession };