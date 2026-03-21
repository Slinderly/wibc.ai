const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
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
    ensureDataFiles();
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Faltan credenciales' });

    let users = JSON.parse(fs.readFileSync(usersFile));
    let user  = users.find(u => u.username === username);

    if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    if (user.password !== password) return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });

    return res.json({ success: true, userId: user.id });
});

router.post('/register', (req, res) => {
    ensureDataFiles();
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

// ── Prompt Builder Chat ──
router.post('/prompt-chat/:userId', async (req, res) => {
    const f = path.join(userDataDir, `${req.params.userId}.json`);
    if (!fs.existsSync(f)) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const userData = JSON.parse(fs.readFileSync(f));
    const apiKey   = userData.aiConfig?.apiKey;
    if (!apiKey || !apiKey.trim()) return res.status(400).json({ success: false, message: 'Configura tu API Key primero.' });

    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ success: false });

    const model = (userData.aiConfig?.model?.trim()) || 'gemini-2.5-flash';

    const systemPrompt = `Eres un experto en crear prompts para bots de ventas en WhatsApp. Tu única tarea es ayudar al usuario a crear el prompt perfecto para su bot.

Cuando el usuario describa su negocio o necesidades, genera un prompt de personalidad completo y listo para usar. El prompt debe:
- Describir la personalidad y tono del bot
- Incluir instrucciones para recolectar datos del pedido (nombre, dirección, pago)
- Ser directo y estar en primera persona ("Eres un vendedor de...")
- Estar escrito en el mismo idioma que el usuario

Si el usuario pide ajustes, modifica el prompt anterior y entrega la versión corregida.
Responde SOLO con el prompt generado, sin explicaciones adicionales, sin comillas, sin markdown.`;

    const histText = history.map(h => `${h.role === 'user' ? 'Usuario' : 'Asistente'}: ${h.text}`).join('\n');
    const contents = `${systemPrompt}\n\n${histText ? histText + '\n' : ''}Usuario: ${message}`;

    try {
        const ai = new GoogleGenAI({ apiKey });
        const result = await ai.models.generateContent({ model, contents });
        res.json({ success: true, reply: result.text });
    } catch (e) {
        console.error('[wibc.ai] prompt-chat error:', e.message);
        res.status(500).json({ success: false, message: 'Error al conectar con la IA. Verifica tu API Key.' });
    }
});

// ── Orders ──
const ordersDir = path.join(dataDir, 'orders');

router.get('/orders/:userId', (req, res) => {
    const f = path.join(ordersDir, `${req.params.userId}.json`);
    if (!fs.existsSync(f)) return res.json({ orders: [] });
    try {
        const orders = JSON.parse(fs.readFileSync(f));
        // Remove internal field before sending
        const clean = orders.map(({ _historyLength, ...o }) => o);
        res.json({ orders: clean.reverse() });
    } catch { res.json({ orders: [] }); }
});

router.patch('/orders/:userId/:orderId', (req, res) => {
    const f = path.join(ordersDir, `${req.params.userId}.json`);
    if (!fs.existsSync(f)) return res.status(404).json({ success: false });
    try {
        let orders = JSON.parse(fs.readFileSync(f));
        const idx = orders.findIndex(o => o.id === req.params.orderId);
        if (idx === -1) return res.status(404).json({ success: false });
        orders[idx] = { ...orders[idx], ...req.body };
        fs.writeFileSync(f, JSON.stringify(orders, null, 2));
        res.json({ success: true });
    } catch { res.status(500).json({ success: false }); }
});

router.delete('/orders/:userId/:orderId', (req, res) => {
    const f = path.join(ordersDir, `${req.params.userId}.json`);
    if (!fs.existsSync(f)) return res.status(404).json({ success: false });
    try {
        let orders = JSON.parse(fs.readFileSync(f));
        orders = orders.filter(o => o.id !== req.params.orderId);
        fs.writeFileSync(f, JSON.stringify(orders, null, 2));
        res.json({ success: true });
    } catch { res.status(500).json({ success: false }); }
});

// ── Profile ──
router.get('/profile/:userId', (req, res) => {
    ensureDataFiles();
    const users = JSON.parse(fs.readFileSync(usersFile));
    const user = users.find(u => u.id === req.params.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ username: user.username, id: user.id });
});

router.post('/profile/:userId', (req, res) => {
    ensureDataFiles();
    const { currentPassword, newUsername, newPassword } = req.body;
    let users = JSON.parse(fs.readFileSync(usersFile));
    const idx = users.findIndex(u => u.id === req.params.userId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    if (users[idx].password !== currentPassword)
        return res.status(401).json({ success: false, message: 'Contraseña actual incorrecta' });

    if (newUsername && newUsername.trim()) {
        const taken = users.find((u, i) => u.username === newUsername.trim() && i !== idx);
        if (taken) return res.status(409).json({ success: false, message: 'Ese nombre ya está en uso' });
        users[idx].username = newUsername.trim();
    }
    if (newPassword && newPassword.trim()) {
        users[idx].password = newPassword.trim();
    }
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    res.json({ success: true, username: users[idx].username });
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
