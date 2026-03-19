# wibc.ai - WhatsApp AI Bot Platform

## Overview
A Node.js/Express web platform that lets users connect multiple WhatsApp accounts and configure an AI-powered sales bot. Users log in, link WhatsApp devices (QR or pairing code), configure bot with products, AI prompts, keyword rules, and conversation flow algorithms. Hidden admin panel at `/admin`.

## Architecture
- **Runtime**: Node.js (CommonJS)
- **Framework**: Express.js (v5)
- **Frontend**: Static HTML/CSS/JS served from `public/` (Lucide icons via CDN)
- **Backend**: Express API in `src/`
- **Admin panel**: `/admin` — password `ortizuwu20` (env: `ADMIN_PASSWORD`) — file manager
- **WhatsApp**: `@whiskeysockets/baileys` library for WhatsApp Web protocol
- **AI**: Google Gemini (`@google/genai`) — model configurable per user (default: `gemini-2.5-flash`)

## Project Structure
```
server.js          - Main Express server (port 5000, 0.0.0.0)
public/            - Static frontend files
  index.html       - Login/Register page (tabbed)
  dashboard.html   - Main dashboard (mobile-first design)
  admin.html       - Admin file manager
  css/style.css    - Styles (responsive, includes flow builder styles)
  css/admin.css    - Admin panel styles
  js/auth.js       - Login/Register logic
  js/dashboard.js  - Dashboard logic (products, AI config, WhatsApp, flows)
  js/admin.js      - Admin file manager logic
src/
  routes.js        - API route handlers (/api/*)
  whatsapp.js      - WhatsApp session management via Baileys (QR + pairing code)
  ai.js            - AI response generation (Gemini) + flow state machine + keyword rules
  admin-routes.js  - Admin API (file system CRUD)
data/              - Runtime data (created automatically)
  users.json       - User accounts (plaintext passwords - hash in production)
  user_data/       - Per-user bot configuration JSON files
  auth_<uid>_<sid>/ - WhatsApp session credentials per user/session
README.md          - Full project documentation in Spanish
```

## Key Features
- Multi-user WhatsApp session management with auto-reconnect on server restart
- WhatsApp linking via QR code OR phone number pairing code (WA + WA Business)
- AI mode (Google Gemini) with configurable model name per user
- Manual mode: keyword rules AND conversation flow algorithms (state machine per contact JID)
- Conversation flows: multi-step, branching conversations triggered by keywords
- Product catalog management
- Mobile-first responsive design with bottom navigation bar
- Toast notifications, smooth animations

## userData Structure (per user JSON)
```json
{
  "botMode": "ai | manual",
  "products": [{ "id", "name", "price", "description" }],
  "manualRules": [{ "id", "keyword", "reply" }],
  "conversationFlows": [{
    "id": "flow_...",
    "name": "Flow name",
    "trigger": "keyword that starts the flow",
    "steps": [{
      "message": "Bot message",
      "branches": [{ "keywords": "kw1,kw2", "nextStep": 1 }],
      "defaultNext": -1
    }]
  }],
  "aiConfig": { "apiKey", "model", "prompt", "context" }
}
```

## Flow State Machine (ai.js)
- `flowState` map in memory: key `${userId}:${jid}` → `{ flowId, stepIndex }`
- On each message: check active flow → match branches → advance or end
- Triggers: keyword match starts a flow at step 0
- Falls back to keyword rules, then null (no reply) if no match

## API Routes
- `POST /api/login` / `POST /api/register`
- `GET /api/data/:userId` - Get user config
- `POST /api/data/:userId` - Save user config
- `GET /api/qr/:userId/:sessionId` - Poll connection status
- `GET /api/devices/:userId` - List all sessions
- `DELETE /api/devices/:userId/:sessionId` - Disconnect session
- `POST /api/init-bot` - Start WhatsApp session (QR)
- `POST /api/request-pairing-code` - Get pairing code

## Development
- Start: `node server.js`
- Port: 5000, Host: 0.0.0.0

## Deployment
- Target: VM (always-running, maintains in-memory WhatsApp sessions + flow state)
- Run: `node server.js`
