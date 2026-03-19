# wibc.ai

Plataforma SaaS para crear bots de ventas en WhatsApp con Inteligencia Artificial. Cada usuario tiene su propia cuenta, configura su bot y puede conectar múltiples números de WhatsApp (personal y Business).

---

## ¿Qué hace?

- Conecta tu WhatsApp y responde mensajes automáticamente con IA (Google Gemini)
- Soporta múltiples números de WhatsApp por cuenta
- Modo IA: responde usando Google Gemini con tu catálogo de productos y personalidad personalizada
- Modo Manual: responde por palabras clave o ejecuta flujos de conversación ramificados
- Panel de administración con editor de archivos en vivo

---

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express 5 |
| WhatsApp | @whiskeysockets/baileys |
| Inteligencia Artificial | Google Gemini (via @google/genai) |
| Frontend | HTML + CSS + JS puro (sin frameworks) |
| Almacenamiento | Archivos JSON locales |
| Iconos | Lucide |

---

## Estructura del proyecto

```
wibc.ai/
├── server.js               # Punto de entrada, inicia Express y reconecta sesiones guardadas
├── package.json
├── src/
│   ├── routes.js           # API principal: auth, datos de usuario, WhatsApp
│   ├── whatsapp.js         # Motor de WhatsApp (Baileys): QR, pairing code, reconexión
│   ├── ai.js               # Motor de IA: Gemini, flujos de conversación, palabras clave
│   └── admin-routes.js     # API del panel admin: sistema de archivos, autenticación
├── public/
│   ├── index.html          # Login y registro
│   ├── dashboard.html      # Panel de usuario
│   ├── admin.html          # Panel de administración
│   ├── css/
│   │   ├── style.css       # Estilos del dashboard y login
│   │   └── admin.css       # Estilos del panel admin
│   └── js/
│       ├── auth.js         # Lógica de login/registro
│       ├── dashboard.js    # Lógica del dashboard
│       └── admin.js        # Lógica del panel admin
└── data/
    ├── users.json          # Registro de usuarios
    ├── user_data/
    │   └── {userId}.json   # Configuración del bot de cada usuario
    └── auth_{userId}_{sessionId}/  # Credenciales de sesión WhatsApp (Baileys)
```

---

## Instalación y configuración

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno (opcionales)

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `5000` |
| `ADMIN_PASSWORD` | Contraseña del panel admin | `ortizuwu20` |

### 3. Arrancar

```bash
node server.js
```

El servidor arranca en `http://0.0.0.0:5000` y reconecta automáticamente cualquier sesión de WhatsApp guardada.

---

## Cómo funciona el bot

### Flujo de un mensaje entrante

```
WhatsApp (mensaje) 
  → Baileys (websocket)
    → whatsapp.js (messages.upsert)
      → ai.js (generateAIResponse)
        ├── Modo Manual:
        │     1. ¿Hay un flujo de conversación activo para este contacto? → continúa el flujo
        │     2. ¿El mensaje activa un nuevo flujo? → inicia el flujo
        │     3. ¿Coincide con una palabra clave? → responde
        │     4. Sin coincidencia → no responde
        └── Modo IA:
              → Google Gemini con prompt + catálogo de productos
```

### Reconexión automática

Al reiniciar el servidor, todas las sesiones guardadas en `data/auth_*/` se reconectan automáticamente sin necesidad de escanear el QR de nuevo.

---

## API endpoints

### Autenticación de usuarios
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/login` | Inicia sesión |
| POST | `/api/register` | Crea una cuenta nueva |

### Datos del bot
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/data/:userId` | Obtiene configuración del bot |
| POST | `/api/data/:userId` | Guarda configuración del bot |

### WhatsApp
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/init-bot` | Inicia sesión por QR |
| GET | `/api/qr/:userId/:sessionId` | Obtiene estado del QR |
| POST | `/api/request-pairing-code` | Genera código de emparejamiento por número |
| GET | `/api/devices/:userId` | Lista dispositivos conectados |
| DELETE | `/api/devices/:userId/:sessionId` | Desconecta un dispositivo |

### Admin (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/admin-api/login` | Login del admin |
| GET | `/admin-api/ls` | Lista un directorio |
| GET | `/admin-api/read` | Lee un archivo |
| POST | `/admin-api/write` | Escribe/crea un archivo |
| DELETE | `/admin-api/delete` | Elimina archivo o carpeta |
| POST | `/admin-api/mkdir` | Crea un directorio |
| POST | `/admin-api/rename` | Renombra/mueve un archivo |

---

## Panel de usuario — secciones

### Productos
Agrega el catálogo de productos que el bot de IA conocerá y podrá ofrecer a los clientes.

### Inteligencia Artificial
- **Modo del bot**: IA (Gemini) o Solo reglas manuales
- **Modelo de IA**: escribe el nombre del modelo de Gemini (por defecto: `gemini-2.5-flash`)
- **API Key**: clave de Google AI Studio
- **Personalidad**: prompt base que define el carácter del bot
- **Contexto extra**: instrucciones adicionales (ej: no dar descuentos mayores al 10%)

### Automatización

#### Palabras Clave
Respuestas simples disparadas por una palabra clave. Útil para FAQs básicas.

#### Flujos de Conversación
Sistema de conversación ramificada. Cada flujo tiene:
- **Trigger**: palabra que lo activa
- **Pasos**: secuencia de mensajes
- **Ramas**: según lo que responda el usuario, el flujo toma distintos caminos
- **Default**: si ninguna rama coincide, avanza a un paso específico o termina

Ejemplo de flujo:
```
Trigger: "hola"

Paso 0: "¡Hola! ¿En qué te ayudo?
         1. Ver productos
         2. Precios
         3. Soporte"

  → Si dice "1" o "productos" → Paso 1
  → Si dice "2" o "precios"   → Paso 2
  → Si dice "3" o "soporte"   → Paso 3
  → Si no coincide nada       → repetir Paso 0

Paso 1: "Nuestros productos son..."
Paso 2: "Los precios van desde..."
Paso 3: "Para soporte escríbenos a..."
```

### WhatsApp
Conecta y administra múltiples números de WhatsApp (normal y Business).
- Vinculación por QR con temporizador visual
- Vinculación por número de teléfono (código de 8 dígitos)
- Lista de dispositivos con estado en tiempo real

---

## Panel de administración

Accesible en `/admin`. Requiere la contraseña configurada en `ADMIN_PASSWORD`.

- Explorador de archivos completo (crear, editar, renombrar, eliminar archivos y carpetas)
- Totalmente responsivo (móvil y escritorio)
- Editor de código con soporte Ctrl+S

---

## Notas de seguridad

- Las contraseñas se guardan en texto plano — se recomienda implementar hashing con bcrypt en producción
- Las API Keys de Gemini se almacenan en archivos JSON del servidor — considerar encriptación en producción
- El almacenamiento en JSON es adecuado para pocos usuarios; para escalar se recomienda una base de datos
- Implementar rate limiting en los endpoints de login/registro para producción

---

## Soporte

Contacto: +591 64770568
