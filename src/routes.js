const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getQR, initSession } = require('./whatsapp');

// Configuración de rutas de archivos
const dataDir = path.join(__dirname, '../data');
const usersFile = path.join(dataDir, 'users.json');
const userDataDir = path.join(dataDir, 'user_data');

// Middleware para asegurar que todas las carpetas y archivos existan
const ensureDataFiles = () => {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }
    if (!fs.existsSync(usersFile)) {
        fs.writeFileSync(usersFile, JSON.stringify([]));
    }
};

// Ejecutar validación de archivos al cargar las rutas
ensureDataFiles();

// Autenticación - Login con auto-registro para prototipo
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Faltan credenciales' });
    }

    let users = JSON.parse(fs.readFileSync(usersFile));
    let user = users.find(u => u.username === username);

    if (user) {
        if (user.password === password) {
            return res.json({ success: true, userId: user.id });
        } else {
            return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
        }
    }

    // Auto-registro (Si el usuario no existe)
    const newUserId = Date.now().toString();
    const newUser = { id: newUserId, username, password };
    users.push(newUser);
    
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    // Crear archivo de configuración inicial del bot para el nuevo usuario
    const userDataPath = path.join(userDataDir, `${newUserId}.json`);
    const initialConfig = {
        botMode: 'ai',
        manualRules: [],
        aiConfig: { 
            apiKey: '', 
            prompt: 'Eres un vendedor virtual, usa los productos.', 
            context: '' 
        },
        products: []
    };
    
    fs.writeFileSync(userDataPath, JSON.stringify(initialConfig, null, 2));
    
    res.json({ success: true, userId: newUserId, message: 'Usuario creado y logueado' });
});

// Obtener configuración del bot y productos
router.get('/data/:userId', (req, res) => {
    const { userId } = req.params;
    const userDataPath = path.join(userDataDir, `${userId}.json`);
    
    if (fs.existsSync(userDataPath)) {
        const data = JSON.parse(fs.readFileSync(userDataPath));
        res.json(data);
    } else {
        res.status(404).json({ error: 'Datos no encontrados' });
    }
});

// Guardar configuración del bot y productos
router.post('/data/:userId', (req, res) => {
    const { userId } = req.params;
    const userDataPath = path.join(userDataDir, `${userId}.json`);
    
    try {
        fs.writeFileSync(userDataPath, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar datos' });
    }
});

// --- RUTAS DE WHATSAPP ---

// Obtener el QR (Polling desde el frontend)
router.get('/qr/:userId', getQR);

// Inicializar el Bot (Cuando el usuario da click en "Conectar")
router.post('/init-bot', initSession);

module.exports = router;