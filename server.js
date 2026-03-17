const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Añadido para leer las carpetas de sesiones
const routes = require('./src/routes');
const { startBaileys } = require('./src/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// API Rutas
app.use('/api', routes);

// Rutas de las vistas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`[wibc.ai] 🚀 Servidor corriendo en http://localhost:${PORT}`);

    // --- LÓGICA DE AUTO-RECONEXIÓN ---
    // Buscar todas las sesiones guardadas en la carpeta 'data' y reconectarlas
    const dataPath = path.join(__dirname, 'data');
    
    if (fs.existsSync(dataPath)) {
        const folders = fs.readdirSync(dataPath);
        
        folders.forEach(folder => {
            if (folder.startsWith('auth_')) {
                const userId = folder.replace('auth_', '');
                console.log(`[wibc.ai] 🔄 Levantando sesión guardada para el usuario: ${userId}`);
                startBaileys(userId); // Reconecta el socket automáticamente
            }
        });
    } else {
        console.log(`[wibc.ai] No hay sesiones previas guardadas.`);
    }
});