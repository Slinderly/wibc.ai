# wibc.ai - WhatsApp AI Bot Platform

## Overview
A Node.js/Express web platform that lets users connect their WhatsApp accounts and configure an AI-powered sales bot. Users log in, scan a QR code to link WhatsApp, then configure their bot with products, AI prompts, and response rules.

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
public/            - Static frontend files (HTML, CSS, JS)
src/
  routes.js        - API route handlers (/api/*)
  whatsapp.js      - WhatsApp session management via Baileys
  ai.js            - AI response generation (Google Gemini)
data/              - Runtime data (created automatically)
  users.json       - User accounts
  user_data/       - Per-user bot configuration
  auth_<userId>/   - WhatsApp session credentials per user
```

## Key Features
- Multi-user WhatsApp session management with auto-reconnect
- AI mode (Google Gemini) or manual keyword-matching rules
- Product catalog management
- QR-code-based WhatsApp linking via polling

## Development
- Start: `node server.js`
- Port: 5000
- Host: 0.0.0.0

## Deployment
- Target: VM (always-running, maintains in-memory WhatsApp sessions)
- Run: `node server.js`
