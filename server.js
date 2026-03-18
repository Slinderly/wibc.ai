const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const routes = require('./src/routes');
const adminRoutes = require('./src/admin-routes');
const { startBaileys } = require('./src/whatsapp');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', routes);
app.use('/admin-api', adminRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

app.listen(PORT, HOST, () => {
    console.log(`[wibc.ai] Servidor en http://${HOST}:${PORT}`);

    // Auto-reconnect saved sessions (format: auth_${userId}_${sessionId})
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) return;

    fs.readdirSync(dataPath).forEach(folder => {
        if (!folder.startsWith('auth_')) return;
        const inner = folder.slice(5); // remove 'auth_'
        const sep = inner.indexOf('_');
        if (sep === -1) return; // skip old format
        const userId    = inner.slice(0, sep);
        const sessionId = inner.slice(sep + 1);
        console.log(`[wibc.ai] Reconectando sesion ${userId}:${sessionId}`);
        startBaileys(userId, sessionId);
    });
});
