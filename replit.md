# wibc.ai - WhatsApp AI Bot Platform

## Overview
A Node.js/Express web platform that lets users connect their WhatsApp accounts and configure an AI-powered sales bot. Users log in, link WhatsApp (via QR code or phone number pairing code), then configure their bot with products, AI prompts, and response rules.

## Architecture
- **Runtime**: Node.js (CommonJS)
- **Framework**: Express.js (v5)
- **Frontend**: Static HTML/CSS/JS served from `public/`
- **Backend**: Express API in `src/`
- **WhatsApp**: `@whiskeysockets/baileys` library for WhatsApp Web protocol
- **AI**: Google Gemini (`@google/genai`) for AI responses

## Project Structure
```
server.js          - Main Express server (port 5000, 0.0.0.0)
public/            - Static frontend files
  index.html       - Login page
  dashboard.html   - Main dashboard (mobile-first design)
  css/style.css    - Styles with responsive bottom nav for mobile
  js/auth.js       - Login logic
  js/dashboard.js  - Dashboard logic (products, AI config, WhatsApp)
src/
  routes.js        - API route handlers (/api/*)
  whatsapp.js      - WhatsApp session management via Baileys (QR + pairing code)
  ai.js            - AI response generation (Google Gemini)
data/              - Runtime data (created automatically)
  users.json       - User accounts
  user_data/       - Per-user bot configuration
  auth_<userId>/   - WhatsApp session credentials per user
```

## Key Features
- Multi-user WhatsApp session management with auto-reconnect
- WhatsApp linking via QR code OR phone number pairing code
- AI mode (Google Gemini) or manual keyword-matching rules
- Product catalog management
- Mobile-first responsive design with bottom navigation bar
- Toast notifications, smooth animations

## API Routes
- `POST /api/login` - Login / auto-register
- `GET /api/data/:userId` - Get user config
- `POST /api/data/:userId` - Save user config
- `GET /api/qr/:userId` - Poll QR code / connection status
- `POST /api/init-bot` - Start WhatsApp session (QR method)
- `POST /api/request-pairing-code` - Get pairing code (phone number method)

## Development
- Start: `node server.js`
- Port: 5000
- Host: 0.0.0.0

## Deployment
- Target: VM (always-running, maintains in-memory WhatsApp sessions)
- Run: `node server.js`
