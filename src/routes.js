const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const {
    getQRHandler, getDevicesHandler, initSessionHandler,
    startBaileysWithPairingCode, disconnectSession
} = require('./whatsapp');

const dataDir    = path.join(__dirname, '../data');
const usersFile  = path.join(dataDir, 'users.json');
const userDataDir = path.join(dataDir, 'user_data');

const ensureDataFiles = () => {
    if (!fs.existsSync(dataDir))     fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    if (!fs.existsSync(usersFile))   fs.writeFileSync(usersFile, JSON.stringify([]));
};
ensureDataFiles();

// ── Auth ──
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Faltan credenciales' });

    let users = JSON.parse(fs.readFileSync(usersFile));
    let user  = users.find(u => u.username === username);

    if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    if (user.password !== password) return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });

    return res.json({ success: true, userId: user.id });
});

router.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Faltan credenciales' });

    let users = JSON.parse(fs.readFileSync(usersFile));
    if (users.find(u => u.username === username)) {
        return res.status(409).json({ success: false, message: 'Ese nombre de usuario ya está en uso' });
    }

    const newUserId = Date.now().toString();
    users.push({ id: newUserId, username, password });
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    fs.writeFileSync(path.join(userDataDir, `${newUserId}.json`), JSON.stringify({
        botMode: 'ai', manualRules: [],
        aiConfig: { apiKey: '', prompt: 'Eres un vendedor virtual.', context: '' },
        products: []
    }, null, 2));

    res.json({ success: true, userId: newUserId });
});

// ── User Data ──
router.get('/data/:userId', (req, res) => {
    const f = path.join(userDataDir, `${req.params.userId}.json`);
    if (fs.existsSync(f)) res.json(JSON.parse(fs.readFileSync(f)));
    else res.status(404).json({ error: 'Datos no encontrados' });
});

router.post('/data/:userId', (req, res) => {
    try {
        fs.writeFileSync(path.join(userDataDir, `${req.params.userId}.json`), JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch { res.status(500).json({ success: false }); }
});

// ── WhatsApp ──
router.get('/qr/:userId/:sessionId', getQRHandler);
router.get('/devices/:userId', getDevicesHandler);
router.post('/init-bot', initSessionHandler);

router.delete('/devices/:userId/:sessionId', (req, res) => {
    const { userId, sessionId } = req.params;
    disconnectSession(userId, sessionId);
    res.json({ success: true });
});

router.post('/request-pairing-code', async (req, res) => {
    const { userId, sessionId: reqSessionId, phoneNumber } = req.body;
    if (!userId || !phoneNumber) return res.status(400).json({ success: false, message: 'Faltan datos' });

    const sessionId = reqSessionId || Date.now().toString(36);
    try {
        const code = await startBaileysWithPairingCode(userId, sessionId, phoneNumber);
        res.json({ success: true, code, sessionId });
    } catch (err) {
        console.error('[wibc.ai] Error código:', err);
        res.status(500).json({ success: false, message: 'No se pudo generar el código.' });
    }
});

module.exports = router;
