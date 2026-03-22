const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require("@google/genai");

// ── Flow state per conversation ───────────────────────────────────────────────
// key: `${userId}:${jid}` → { flowId, stepIndex, waitingForData, waitingField,
//                              waitingForOptions, collectedData, defaultNext }
const flowState = {};

// Track seen contacts per user (for "any_first_message" trigger)
// key: `${userId}:${jid}`
const seenContacts = new Set();

// ── AI mode: conversation history ────────────────────────────────────────────
const conversationHistory = {};
const MAX_HISTORY = 20;

// ── Chat persistence ──────────────────────────────────────────────────────────
const chatsDir = path.join(__dirname, '../data/chats');

const sanitizeJid = (jid) => jid.replace(/[^a-z0-9]/gi, '_');

const saveChatMessage = (userId, jid, role, text) => {
    try {
        const userChatsDir = path.join(chatsDir, userId);
        if (!fs.existsSync(userChatsDir)) fs.mkdirSync(userChatsDir, { recursive: true });
        const file = path.join(userChatsDir, `${sanitizeJid(jid)}.json`);
        let msgs = [];
        if (fs.existsSync(file)) {
            try { msgs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
        }
        msgs.push({ role, text, ts: new Date().toISOString(), jid });
        if (msgs.length > 500) msgs = msgs.slice(-500);
        fs.writeFileSync(file, JSON.stringify(msgs, null, 2));
    } catch (e) {
        console.error('[wibc.ai] saveChatMessage error:', e.message);
    }
};

const getChatHistory = (userId, jid) => {
    try {
        const file = path.join(chatsDir, userId, `${sanitizeJid(jid)}.json`);
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { return []; }
};

const listChatContacts = (userId) => {
    try {
        const userChatsDir = path.join(chatsDir, userId);
        if (!fs.existsSync(userChatsDir)) return [];
        const files = fs.readdirSync(userChatsDir).filter(f => f.endsWith('.json'));
        const contacts = [];
        for (const file of files) {
            try {
                const msgs = JSON.parse(fs.readFileSync(path.join(userChatsDir, file), 'utf8'));
                if (!msgs.length) continue;
                const last = msgs[msgs.length - 1];
                const jid = last.jid || file.replace('.json', '').replace(/_/g, '');
                contacts.push({
                    jid,
                    phone: '+' + jid.split('@')[0],
                    lastMessage: last.text,
                    lastRole: last.role,
                    lastTs: last.ts,
                    count: msgs.length,
                });
            } catch (_) {}
        }
        contacts.sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));
        return contacts;
    } catch (_) { return []; }
};

const PRODUCT_KEYWORDS = [
    'precio', 'precios', 'producto', 'productos', 'catálogo', 'catalogo',
    'cuánto', 'cuanto', 'vale', 'cuesta', 'costo', 'costos',
    'vendes', 'tienes', 'disponible', 'disponibles', 'oferta', 'ofertas',
    'comprar', 'pedir', 'pedido', 'lista', 'qué hay', 'que hay',
    'menú', 'menu', 'opciones', 'stock', 'artículo', 'articulo',
    'información', 'informacion', 'info', 'detalle', 'detalles',
    'qué vendes', 'que vendes', 'qué tienen', 'que tienen', 'show me',
];

const messageNeedsProducts = (text) => {
    const lower = text.toLowerCase();
    return PRODUCT_KEYWORDS.some(kw => lower.includes(kw));
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const cancelOrderByJid = (userId, jid) => {
    const filePath = getOrdersPath(userId);
    if (!fs.existsSync(filePath)) return false;
    try {
        let orders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let changed = false;
        for (let i = orders.length - 1; i >= 0; i--) {
            if (orders[i].jid === jid && orders[i].status !== 'cancelled') {
                orders[i].status = 'cancelled';
                changed = true;
                break;
            }
        }
        if (changed) fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));
        return changed;
    } catch (_) { return false; }
};

const orderAlreadySaved = (userId, jid, conversationSnapshot) => {
    const filePath = getOrdersPath(userId);
    if (!fs.existsSync(filePath)) return false;
    try {
        const orders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const last = [...orders].reverse().find(o => o.jid === jid);
        if (!last) return false;
        // Allow up to 8 new history entries before considering it a new order
        return conversationSnapshot - last._historyLength <= 8;
    } catch (_) { return false; }
};

// ── AI order detection ────────────────────────────────────────────────────────
const detectAndSaveOrder = async (userId, jid, phone, history, aiConfig) => {
    if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) return;
    if (history.length < 4) return;

    const historyText = history
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.text}`)
        .join('\n');

    const detectionPrompt = `Chat de ventas WhatsApp:
${historyText}

¿El cliente CONFIRMÓ un pedido (no solo consultó)? Sí→JSON, No→null

JSON si hay pedido:
{"customerName":null,"address":null,"items":[{"name":"","quantity":"","price":""}],"paymentMethod":null,"total":null,"notes":null}

Solo JSON o null. Sin texto extra.`;

    try {
        const model = (aiConfig.model && aiConfig.model.trim()) ? aiConfig.model.trim() : 'gemini-2.5-flash';
        const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
        const result = await ai.models.generateContent({ model, contents: detectionPrompt });
        const raw = (result.text || '').trim();
        if (raw === 'null' || raw === '') return;
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;
        const extracted = JSON.parse(jsonMatch[0]);
        if (orderAlreadySaved(userId, jid, history.length)) return;
        const cleanPhone = jid.split('@')[0];
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
        console.log(`[wibc.ai] 🛒 Pedido IA guardado para ${userId} desde ${cleanPhone}`);
    } catch (e) {
        console.error('[wibc.ai] Error detección pedido:', e.message);
    }
};

// ── AI cancellation detection ─────────────────────────────────────────────────
const detectAndCancelOrder = async (userId, jid, history, aiConfig) => {
    if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) return;
    if (history.length < 2) return;

    const filePath = getOrdersPath(userId);
    if (!fs.existsSync(filePath)) return;
    try {
        const orders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const hasActive = orders.some(o => o.jid === jid && o.status !== 'cancelled');
        if (!hasActive) return;
    } catch (_) { return; }

    const historyText = history.slice(-10)
        .map(h => `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.text}`)
        .join('\n');

    const cancelPrompt = `Mensajes:
${historyText}

¿El cliente cancela su pedido? SI o NO.`;

    try {
        const model = (aiConfig.model && aiConfig.model.trim()) ? aiConfig.model.trim() : 'gemini-2.5-flash';
        const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
        const result = await ai.models.generateContent({ model, contents: cancelPrompt });
        const raw = (result.text || '').trim().toUpperCase();
        if (raw.startsWith('SI') || raw.startsWith('SÍ')) {
            const cancelled = cancelOrderByJid(userId, jid);
            if (cancelled) {
                console.log(`[wibc.ai] ❌ Pedido cancelado por cliente: ${userId} / ${jid}`);
            }
        }
    } catch (e) {
        console.error('[wibc.ai] Error detección cancelación:', e.message);
    }
};

// ── Flow engine ───────────────────────────────────────────────────────────────

const buildProductList = (products, introMsg) => {
    let msg = introMsg ? introMsg + '\n\n' : '';
    if (!products || !products.length) {
        msg += '_(Sin productos registrados aún)_';
    } else {
        products.forEach((p, i) => {
            msg += `*${i + 1}. ${p.name}*`;
            if (p.price) msg += ` — ${p.price}`;
            if (p.description && p.description.trim()) msg += `\n_${p.description}_`;
            msg += '\n';
        });
    }
    return msg.trim();
};

// Execute the step at state.stepIndex, chain auto-advance steps, return response string.
const executeFlowStep = (userId, jid, flow, state, userData) => {
    const stateKey = `${userId}:${jid}`;
    const products = userData.products || [];
    const messages = [];
    const visited = new Set();

    while (true) {
        const si = state.stepIndex;
        const step = flow.steps[si];

        if (!step || visited.has(si)) {
            delete flowState[stateKey];
            break;
        }
        visited.add(si);

        const type = step.type || 'message';

        if (type === 'message') {
            if (step.message) messages.push(step.message);
            if (step.branches && step.branches.length > 0) {
                // Stay on this step, wait for branch input
                break;
            }
            const nextIdx = typeof step.defaultNext === 'number' ? step.defaultNext : -1;
            if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                state.stepIndex = nextIdx;
            } else {
                delete flowState[stateKey];
                break;
            }

        } else if (type === 'show_products') {
            messages.push(buildProductList(products, step.message));
            const nextIdx = typeof step.defaultNext === 'number' ? step.defaultNext : -1;
            if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                state.stepIndex = nextIdx;
            } else {
                delete flowState[stateKey];
                break;
            }

        } else if (type === 'collect_data') {
            if (step.message) messages.push(step.message);
            state.waitingForData = true;
            state.waitingField = step.field || 'data';
            state.defaultNext = typeof step.defaultNext === 'number' ? step.defaultNext : -1;
            break;

        } else if (type === 'options') {
            let msg = step.message ? step.message + '\n\n' : '';
            (step.options || []).forEach((opt, i) => {
                msg += `*${i + 1}.* ${opt.label}\n`;
            });
            messages.push(msg.trim());
            state.waitingForOptions = true;
            break;

        } else if (type === 'save_order') {
            const cd = state.collectedData || {};
            const cleanPhone = jid.split('@')[0];
            const order = {
                id: 'order_' + Date.now(),
                jid,
                phone: cd.phone || ('+' + cleanPhone),
                customerName: cd.name || null,
                address: cd.address || null,
                paymentMethod: cd.payment || null,
                total: cd.total || null,
                notes: cd.notes || null,
                items: cd.items ? [{ name: cd.items, quantity: '', price: '' }] : [],
                status: 'pending',
                timestamp: new Date().toISOString(),
                _historyLength: 0
            };
            saveOrder(userId, order);
            console.log(`[wibc.ai] 🛒 Pedido manual guardado para ${userId} desde ${cleanPhone}`);
            if (step.message) messages.push(step.message);
            // Clear collected data after saving
            state.collectedData = {};
            const nextIdx = typeof step.defaultNext === 'number' ? step.defaultNext : -1;
            if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                state.stepIndex = nextIdx;
            } else {
                delete flowState[stateKey];
                break;
            }

        } else {
            // Unknown type, skip
            const nextIdx = typeof step.defaultNext === 'number' ? step.defaultNext : -1;
            if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                state.stepIndex = nextIdx;
            } else {
                delete flowState[stateKey];
                break;
            }
        }
    }

    return messages.length ? messages.join('\n\n') : null;
};

// ── Main response generator ───────────────────────────────────────────────────
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

        // ── Manual mode ──────────────────────────────────────────────────────
        if (mode === 'manual') {
            const flows = conversationFlows || [];
            const rules = manualRules || [];
            const msgLower = incomingMessage.toLowerCase().trim();
            const stateKey = `${userId}:${jid}`;

            const isFirstMsg = !seenContacts.has(stateKey);
            seenContacts.add(stateKey);

            // ── Active flow ──────────────────────────────────────────────────
            const activeState = flowState[stateKey];
            if (activeState) {
                const flow = flows.find(f => f.id === activeState.flowId);

                if (flow) {
                    // Waiting for data (collect_data step)
                    if (activeState.waitingForData) {
                        if (!activeState.collectedData) activeState.collectedData = {};
                        activeState.collectedData[activeState.waitingField] = incomingMessage;
                        activeState.waitingForData = false;
                        activeState.waitingField = null;
                        const nextIdx = typeof activeState.defaultNext === 'number' ? activeState.defaultNext : -1;
                        if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                            activeState.stepIndex = nextIdx;
                            resolve(executeFlowStep(userId, jid, flow, activeState, userData));
                        } else {
                            delete flowState[stateKey];
                            resolve(null);
                        }
                        return;
                    }

                    // Waiting for option selection
                    if (activeState.waitingForOptions) {
                        const currentStep = flow.steps[activeState.stepIndex];
                        if (currentStep) {
                            const opts = currentStep.options || [];
                            const numMatch = parseInt(msgLower.trim());
                            let nextIdx = typeof currentStep.defaultNext === 'number' ? currentStep.defaultNext : -1;

                            if (!isNaN(numMatch) && numMatch >= 1 && numMatch <= opts.length) {
                                const opt = opts[numMatch - 1];
                                nextIdx = typeof opt.nextStep === 'number' ? opt.nextStep : -1;
                            } else {
                                for (let i = 0; i < opts.length; i++) {
                                    if (msgLower.includes(opts[i].label.toLowerCase())) {
                                        nextIdx = typeof opts[i].nextStep === 'number' ? opts[i].nextStep : -1;
                                        break;
                                    }
                                }
                            }

                            activeState.waitingForOptions = false;
                            if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                                activeState.stepIndex = nextIdx;
                                resolve(executeFlowStep(userId, jid, flow, activeState, userData));
                            } else {
                                delete flowState[stateKey];
                                resolve(null);
                            }
                            return;
                        }
                    }

                    // Waiting for branch input (message step with branches)
                    const currentStep = flow.steps[activeState.stepIndex];
                    if (currentStep && currentStep.branches && currentStep.branches.length > 0) {
                        let nextIdx = typeof currentStep.defaultNext === 'number' ? currentStep.defaultNext : -1;
                        for (const branch of currentStep.branches) {
                            const kws = (branch.keywords || '').split(',')
                                .map(k => k.trim().toLowerCase()).filter(Boolean);
                            if (kws.some(k => msgLower.includes(k))) {
                                nextIdx = typeof branch.nextStep === 'number' ? branch.nextStep : -1;
                                break;
                            }
                        }
                        if (nextIdx >= 0 && nextIdx < flow.steps.length) {
                            activeState.stepIndex = nextIdx;
                            resolve(executeFlowStep(userId, jid, flow, activeState, userData));
                        } else {
                            delete flowState[stateKey];
                            resolve(null);
                        }
                        return;
                    }
                }

                delete flowState[stateKey];
            }

            // ── Trigger: primer mensaje ───────────────────────────────────
            if (isFirstMsg) {
                const firstMsgFlow = flows.find(f =>
                    f.triggerType === 'any_first_message' && f.steps && f.steps.length > 0);
                if (firstMsgFlow) {
                    const state = {
                        flowId: firstMsgFlow.id, stepIndex: 0,
                        waitingForData: false, waitingField: null,
                        waitingForOptions: false, defaultNext: -1,
                        collectedData: {}
                    };
                    flowState[stateKey] = state;
                    resolve(executeFlowStep(userId, jid, firstMsgFlow, state, userData));
                    return;
                }
            }

            // ── Trigger: palabra clave ────────────────────────────────────
            const triggeredFlow = flows.find(f =>
                f.triggerType !== 'any_first_message' &&
                f.trigger && msgLower.includes(f.trigger.toLowerCase()) &&
                f.steps && f.steps.length > 0
            );
            if (triggeredFlow) {
                const state = {
                    flowId: triggeredFlow.id, stepIndex: 0,
                    waitingForData: false, waitingField: null,
                    waitingForOptions: false, defaultNext: -1,
                    collectedData: {}
                };
                flowState[stateKey] = state;
                resolve(executeFlowStep(userId, jid, triggeredFlow, state, userData));
                return;
            }

            // ── Fallback: legacy keyword rules ────────────────────────────
            const matchedRule = rules.find(r => r.keyword && msgLower.includes(r.keyword.toLowerCase()));
            if (matchedRule) { resolve(matchedRule.reply); return; }

            resolve(null);
            return;
        }

        // ── AI mode: Google Gemini ────────────────────────────────────────────
        if (aiConfig && aiConfig.apiKey && aiConfig.apiKey.trim() !== '') {
            try {
                const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
                const model = (aiConfig.model && aiConfig.model.trim()) ? aiConfig.model.trim() : 'gemini-2.5-flash';
                const histKey = `${userId}:${jid}`;

                const shouldIncludeProducts = messageNeedsProducts(incomingMessage) ||
                    !(conversationHistory[histKey] || []).length;

                // ── Build system instruction (separate from conversation) ──────
                let systemInstruction = `${aiConfig.prompt || 'Vendedor amable y profesional en WhatsApp.'}\n`;
                if (aiConfig.context && aiConfig.context.trim()) {
                    systemInstruction += `\n${aiConfig.context}\n`;
                }
                if (aiConfig.orderInstructions && aiConfig.orderInstructions.trim()) {
                    systemInstruction += `\nPedidos: ${aiConfig.orderInstructions}\n`;
                }
                if (shouldIncludeProducts && products && products.length > 0) {
                    systemInstruction += `\nProductos:\n`;
                    products.forEach(p => {
                        systemInstruction += `• ${p.name} — ${p.price}`;
                        if (p.description && p.description.trim()) systemInstruction += ` (${p.description})`;
                        systemInstruction += '\n';
                    });
                }

                // ── Add user message to history, build strictly alternating contents ──
                addToHistory(histKey, 'user', incomingMessage);

                const rawHistory = conversationHistory[histKey] || [];
                const contents = [];
                let expectedRole = 'user';
                for (const h of rawHistory) {
                    const role = h.role === 'user' ? 'user' : 'model';
                    if (role !== expectedRole) continue;
                    contents.push({ role, parts: [{ text: h.text }] });
                    expectedRole = role === 'user' ? 'model' : 'user';
                }
                if (!contents.length || contents[contents.length - 1].role !== 'user') {
                    contents.push({ role: 'user', parts: [{ text: incomingMessage }] });
                }

                const response = await ai.models.generateContent({
                    model,
                    config: { systemInstruction },
                    contents,
                });
                const reply = response.text;

                addToHistory(histKey, 'bot', reply);

                const currentHistory = [...(conversationHistory[histKey] || [])];
                const cleanPhone = jid.split('@')[0];
                detectAndSaveOrder(userId, jid, '+' + cleanPhone, currentHistory, aiConfig)
                    .catch(e => console.error('[wibc.ai] detectOrder error:', e.message));
                detectAndCancelOrder(userId, jid, currentHistory, aiConfig)
                    .catch(e => console.error('[wibc.ai] detectCancel error:', e.message));

                resolve(reply);
                return;
            } catch (error) {
                console.error("[wibc.ai] 🔴 Error IA:", error.message);
                resolve("🤖 [Wibc.ai] Lo siento, hubo un problema con el proveedor de IA. Revisa tu API Key o el modelo configurado.");
                return;
            }
        }

        // ── Sin API Key ───────────────────────────────────────────────────────
        let response = "⚠️ *Configuración Pendiente*\n\n";
        response += "Wibc.ai necesita una **API Key** para funcionar con Inteligencia Artificial.\n\n";
        response += "🔧 Configura el bot desde tu panel.\n\n";
        response += "💬 *¿Necesitas ayuda?*\nEscríbeme al: +591 64770568";
        setTimeout(() => resolve(response), 800);
    });
};

module.exports = { generateAIResponse, saveChatMessage, getChatHistory, listChatContacts };
