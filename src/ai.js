const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require("@google/genai");

// In-memory flow state per user per contact
// key: `${userId}:${jid}` → { flowId, stepIndex }
const flowState = {};

// In-memory conversation history per user per contact (AI mode only)
// key: `${userId}:${jid}` → [ { role: 'user'|'bot', text: string } ]
const conversationHistory = {};
const MAX_HISTORY = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────

const addToHistory = (key, role, text) => {
    if (!conversationHistory[key]) conversationHistory[key] = [];
    conversationHistory[key].push({ role, text });
    if (conversationHistory[key].length > MAX_HISTORY)
        conversationHistory[key] = conversationHistory[key].slice(-MAX_HISTORY);
};

const getOrdersPath = (userId) =>
    path.join(__dirname, `../data/orders/${userId}.json`);

const saveOrder = (userId, order) => {
    const dir = path.join(__dirname, '../data/orders');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = getOrdersPath(userId);
    let orders = [];
    if (fs.existsSync(filePath)) {
        try { orders = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) {}
    }
    orders.push(order);
    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));
};

const orderAlreadySaved = (userId, jid, conversationSnapshot) => {
    const filePath = getOrdersPath(userId);
    if (!fs.existsSync(filePath)) return false;
    try {
        const orders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Avoid duplicate: check if last order from this jid matches the current conversation length
        const last = [...orders].reverse().find(o => o.jid === jid);
        if (!last) return false;
        return last._historyLength === conversationSnapshot;
    } catch (_) { return false; }
};

// ── Order Detection via Gemini ────────────────────────────────────────────────
const detectAndSaveOrder = async (userId, jid, phone, history, aiConfig) => {
    if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) return;
    if (history.length < 4) return; // need a minimum conversation

    const historyText = history
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.text}`)
        .join('\n');

    const detectionPrompt = `Analiza esta conversación de WhatsApp entre un cliente y un bot de ventas.

Conversación:
${historyText}

Tu tarea: Determina si en esta conversación el cliente ha CONFIRMADO un pedido/compra (no solo preguntó precios). Si se confirmó un pedido, extrae los datos en formato JSON. Si NO hay pedido confirmado, responde exactamente con la palabra: null

Si hay pedido, responde SOLO con JSON válido con esta estructura exacta (omite campos que no se mencionaron, déjalos como null):
{
  "customerName": "nombre del cliente o null",
  "address": "dirección de entrega o null",
  "items": [{"name": "producto", "quantity": "cantidad", "price": "precio"}],
  "paymentMethod": "método de pago o null",
  "total": "total del pedido o null",
  "notes": "notas adicionales o null"
}

Responde SOLO con el JSON o la palabra null. Sin explicaciones.`;

    try {
        const model = (aiConfig.model && aiConfig.model.trim()) ? aiConfig.model.trim() : 'gemini-2.5-flash';
        const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
        const result = await ai.models.generateContent({ model, contents: detectionPrompt });
        const raw = (result.text || '').trim();

        if (raw === 'null' || raw === '') return;

        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const extracted = JSON.parse(jsonMatch[0]);

        // Avoid saving duplicate for same conversation length
        if (orderAlreadySaved(userId, jid, history.length)) return;

        const cleanPhone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');

        const order = {
            id: 'order_' + Date.now(),
            jid,
            phone: phone || ('+' + cleanPhone),
            customerName: extracted.customerName || null,
            items: extracted.items || [],
            address: extracted.address || null,
            paymentMethod: extracted.paymentMethod || null,
            total: extracted.total || null,
            notes: extracted.notes || null,
            status: 'pending',
            timestamp: new Date().toISOString(),
            _historyLength: history.length
        };

        saveOrder(userId, order);
        console.log(`[wibc.ai] 🛒 Pedido guardado para ${userId} desde ${cleanPhone}`);
    } catch (e) {
        // Silent: don't break the bot if order detection fails
        console.error('[wibc.ai] Error detección pedido:', e.message);
    }
};

// ── Main Response Generator ───────────────────────────────────────────────────
const generateAIResponse = async (userId, incomingMessage, jid = '') => {
    return new Promise(async (resolve) => {
        const userDataPath = path.join(__dirname, `../data/user_data/${userId}.json`);

        if (!fs.existsSync(userDataPath)) {
            resolve("🤖 *Aviso del Sistema*\n\nLo siento, la tienda no está configurada aún.\n\n🔧 *¿Qué puedes hacer?*\n1. Configura tu bot en el panel.\n\n💬 *¿Necesitas ayuda?*\nEscríbeme al: +591 64770568");
            return;
        }

        const userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
        const { botMode, manualRules, aiConfig, products, conversationFlows } = userData;

        const mode = botMode || 'ai';

        // ── Modo Manual: Flujos + Palabras Clave ────────────────────────────
        if (mode === 'manual') {
            const flows = conversationFlows || [];
            const rules = manualRules || [];
            const msgLower = incomingMessage.toLowerCase().trim();
            const stateKey = `${userId}:${jid}`;

            // 1. Si hay un flujo activo para este contacto → continuar flujo
            const activeState = flowState[stateKey];
            if (activeState) {
                const flow = flows.find(f => f.id === activeState.flowId);
                if (flow) {
                    const step = flow.steps[activeState.stepIndex];
                    if (step) {
                        let nextIdx = step.defaultNext ?? -1;
                        for (const branch of (step.branches || [])) {
                            const kws = (branch.keywords || '').split(',')
                                .map(k => k.trim().toLowerCase())
                                .filter(Boolean);
                            if (kws.some(k => msgLower.includes(k))) {
                                nextIdx = branch.nextStep ?? -1;
                                break;
                            }
                        }

                        if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                            flowState[stateKey] = { flowId: flow.id, stepIndex: nextIdx };
                            resolve(flow.steps[nextIdx].message);
                        } else {
                            delete flowState[stateKey];
                            resolve(null);
                        }
                        return;
                    }
                }
                delete flowState[stateKey];
            }

            // 2. Buscar si el mensaje activa un nuevo flujo
            const triggeredFlow = flows.find(f =>
                f.trigger && msgLower.includes(f.trigger.toLowerCase()) && f.steps.length > 0
            );
            if (triggeredFlow) {
                flowState[stateKey] = { flowId: triggeredFlow.id, stepIndex: 0 };
                resolve(triggeredFlow.steps[0].message);
                return;
            }

            // 3. Palabras clave simples
            const matchedRule = rules.find(r => r.keyword && msgLower.includes(r.keyword.toLowerCase()));
            if (matchedRule) {
                resolve(matchedRule.reply);
                return;
            }

            resolve(null);
            return;
        }

        // ── Modo IA: Google Gemini ───────────────────────────────────────────
        if (aiConfig.apiKey && aiConfig.apiKey.trim() !== '') {
            try {
                const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
                const model = (aiConfig.model && aiConfig.model.trim()) ? aiConfig.model.trim() : 'gemini-2.5-flash';
                const histKey = `${userId}:${jid}`;

                // Add incoming message to history
                addToHistory(histKey, 'user', incomingMessage);

                // Build conversation history string
                const historyText = (conversationHistory[histKey] || [])
                    .slice(0, -1) // exclude current message (already in contents)
                    .map(h => `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.text}`)
                    .join('\n');

                let systemInstruction = `Eres un asistente virtual de ventas para WhatsApp.\n`;
                systemInstruction += `Personalidad / Prompt principal: ${aiConfig.prompt}\n`;
                systemInstruction += `Instrucciones estrictas / Contexto: ${aiConfig.context || 'Ninguno'}\n\n`;
                systemInstruction += `Catálogo de Productos Disponibles:\n`;

                if (products && products.length > 0) {
                    products.forEach(p => {
                        systemInstruction += `- ${p.name}: $${p.price} (${p.description})\n`;
                    });
                } else {
                    systemInstruction += `- No hay productos en inventario por ahora.\n`;
                }

                if (historyText) {
                    systemInstruction += `\nHistorial reciente de conversación:\n${historyText}\n`;
                }

                systemInstruction += `\nEl usuario acaba de decir: "${incomingMessage}"`;

                const response = await ai.models.generateContent({
                    model,
                    contents: systemInstruction,
                });

                const reply = response.text;

                // Add bot response to history
                addToHistory(histKey, 'bot', reply);

                // Async order detection (don't await so we don't slow down the reply)
                const currentHistory = [...(conversationHistory[histKey] || [])];
                const cleanPhone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
                detectAndSaveOrder(userId, jid, '+' + cleanPhone, currentHistory, aiConfig)
                    .catch(e => console.error('[wibc.ai] detectOrder error:', e.message));

                resolve(reply);
                return;
            } catch (error) {
                console.error("[wibc.ai] 🔴 Error IA:", error.message);
                resolve("🤖 [Wibc.ai] Lo siento, hubo un problema con el proveedor de IA. Revisa tu API Key o el modelo configurado.");
                return;
            }
        }

        // ── Sin API Key configurada ──────────────────────────────────────────
        let response = "⚠️ *Configuración Pendiente*\n\n";
        response += "Wibc.ai necesita una **API Key** para funcionar con Inteligencia Artificial.\n\n";
        response += "🔧 Configura el bot desde tu panel.\n\n";
        response += "💬 *¿Necesitas ayuda?*\nEscríbeme al: +591 64770568";
        setTimeout(() => resolve(response), 800);
    });
};

module.exports = { generateAIResponse };
