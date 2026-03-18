const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getQR, getDevices, initSession, startBaileysWithPairingCode } = require('./whatsapp');

const dataDir = path.join(__dirname, '../data');
const usersFile = path.join(dataDir, 'users.json');
const userDataDir = path.join(dataDir, 'user_data');

const ensureDataFiles = () => {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify([]));
};
ensureDataFiles();

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Faltan credenciales' });
    }

    let users = JSON.parse(fs.readFileSync(usersFile));
    let user = users.find(u => u.username === username);

    if (user) {
        if (user.password === password) return res.json({ success: true, userId: user.id });
        return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    const newUserId = Date.now().toString();
    users.push({ id: newUserId, username, password });
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    const userDataPath = path.join(userDataDir, `${newUserId}.json`);
    fs.writeFileSync(userDataPath, JSON.stringify({
        botMode: 'ai',
        manualRules: [],
        aiConfig: { apiKey: '', prompt: 'Eres un vendedor virtual.', context: '' },
        products: []
    }, null, 2));

    res.json({ success: true, userId: newUserId, message: 'Usuario creado y logueado' });
});

router.get('/data/:userId', (req, res) => {
    const userDataPath = path.join(userDataDir, `${req.params.userId}.json`);
    if (fs.existsSync(userDataPath)) {
        res.json(JSON.parse(fs.readFileSync(userDataPath)));
    } else {
        res.status(404).json({ error: 'Datos no encontrados' });
    }
});

router.post('/data/:userId', (req, res) => {
    const userDataPath = path.join(userDataDir, `${req.params.userId}.json`);
    try {
        fs.writeFileSync(userDataPath, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch {
        res.status(500).json({ success: false, message: 'Error al guardar' });
    }
});

router.get('/qr/:userId', getQR);
router.get('/devices/:userId', getDevices);
router.post('/init-bot', initSession);

router.post('/request-pairing-code', async (req, res) => {
    const { userId, phoneNumber } = req.body;
    if (!userId || !phoneNumber) {
        return res.status(400).json({ success: false, message: 'Faltan userId o phoneNumber' });
    }
    try {
        const code = await startBaileysWithPairingCode(userId, phoneNumber);
        res.json({ success: true, code });
    } catch (err) {
        console.error('[wibc.ai] Error código emparejamiento:', err);
        res.status(500).json({ success: false, message: 'No se pudo generar el código. Verifica el número.' });
    }
});

module.exports = router;
