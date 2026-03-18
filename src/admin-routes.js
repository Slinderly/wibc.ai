const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ortizuwu20';

// In-memory tokens
const validTokens = new Set();

const generateToken = () => crypto.randomBytes(24).toString('hex');

// Middleware to check token
const requireAuth = (req, res, next) => {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!validTokens.has(token)) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
};

// Sanitize path: must stay inside ROOT
const safePath = (reqPath) => {
    const resolved = path.resolve(ROOT, reqPath.replace(/^\/+/, ''));
    if (!resolved.startsWith(ROOT)) throw new Error('Ruta inválida');
    return resolved;
};

// ── Auth ──
router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    const token = generateToken();
    validTokens.add(token);
    res.json({ token });
});

router.post('/logout', requireAuth, (req, res) => {
    const token = req.headers['authorization'].replace('Bearer ', '').trim();
    validTokens.delete(token);
    res.json({ ok: true });
});

// ── File System ──

// List directory
router.get('/ls', requireAuth, (req, res) => {
    try {
        const dir = safePath(req.query.path || '/');
        const stat = fs.statSync(dir);
        if (!stat.isDirectory()) return res.status(400).json({ error: 'No es un directorio' });

        const items = fs.readdirSync(dir).map(name => {
            const full = path.join(dir, name);
            let isDir = false, size = 0;
            try {
                const s = fs.statSync(full);
                isDir = s.isDirectory();
                size = s.size;
            } catch (_) {}
            return { name, isDir, size, path: path.relative(ROOT, full) };
        }).sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        const relPath = path.relative(ROOT, dir) || '.';
        res.json({ path: relPath, items });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Read file
router.get('/read', requireAuth, (req, res) => {
    try {
        const file = safePath(req.query.path || '');
        const stat = fs.statSync(file);
        if (stat.isDirectory()) return res.status(400).json({ error: 'Es un directorio' });
        if (stat.size > 2 * 1024 * 1024) return res.status(400).json({ error: 'Archivo muy grande (>2MB)' });
        const content = fs.readFileSync(file, 'utf8');
        res.json({ content, path: path.relative(ROOT, file) });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Write / create file
router.post('/write', requireAuth, (req, res) => {
    try {
        const { path: reqPath, content = '' } = req.body;
        const file = safePath(reqPath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Delete file or directory
router.delete('/delete', requireAuth, (req, res) => {
    try {
        const file = safePath(req.query.path || '');
        const stat = fs.statSync(file);
        if (stat.isDirectory()) {
            fs.rmSync(file, { recursive: true, force: true });
        } else {
            fs.unlinkSync(file);
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Create directory
router.post('/mkdir', requireAuth, (req, res) => {
    try {
        const dir = safePath(req.body.path || '');
        fs.mkdirSync(dir, { recursive: true });
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Rename / move
router.post('/rename', requireAuth, (req, res) => {
    try {
        const from = safePath(req.body.from || '');
        const to   = safePath(req.body.to   || '');
        fs.renameSync(from, to);
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ── Logs SSE stream ──
// Token passed as query param because EventSource doesn't support custom headers
router.get('/logs/stream', (req, res) => {
    const token = (req.query.token || '').trim();
    if (!validTokens.has(token)) {
        res.status(401).end(); return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const logDir = '/tmp/logs';
    let lastFile = null;
    let lastPos  = 0;

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    const tick = () => {
        try {
            if (!fs.existsSync(logDir)) return;
            const files = fs.readdirSync(logDir)
                .filter(f => f.endsWith('.log'))
                .sort()
                .reverse();
            if (!files.length) return;

            const latestPath = path.join(logDir, files[0]);

            // New log file started — reset cursor, notify frontend
            if (latestPath !== lastFile) {
                lastFile = latestPath;
                lastPos  = 0;
                send({ type: 'clear', file: files[0] });
            }

            const size = fs.statSync(latestPath).size;
            if (size <= lastPos) return;

            const fd  = fs.openSync(latestPath, 'r');
            const buf = Buffer.alloc(size - lastPos);
            fs.readSync(fd, buf, 0, buf.length, lastPos);
            fs.closeSync(fd);
            lastPos = size;

            const lines = buf.toString('utf8');
            if (lines.trim()) send({ type: 'lines', content: lines });
        } catch (_) {}
    };

    // Send last 100 lines of current log immediately
    try {
        if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort().reverse();
            if (files.length) {
                lastFile = path.join(logDir, files[0]);
                const content = fs.readFileSync(lastFile, 'utf8');
                const tail = content.split('\n').slice(-100).join('\n');
                lastPos = fs.statSync(lastFile).size;
                send({ type: 'clear', file: files[0] });
                if (tail.trim()) send({ type: 'lines', content: tail + '\n' });
            }
        }
    } catch (_) {}

    const interval = setInterval(tick, 1500);

    // Keep-alive ping every 20s to prevent proxy timeout
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
        clearInterval(interval);
        clearInterval(ping);
    });
});

module.exports = router;
