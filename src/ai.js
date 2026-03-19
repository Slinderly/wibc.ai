const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require("@google/genai");

// In-memory flow state per user per contact
// key: `${userId}:${jid}` → { flowId, stepIndex }
const flowState = {};

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
                        // Buscar rama que coincida
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

                systemInstruction += `\nEl usuario acaba de decir: "${incomingMessage}"`;

                const response = await ai.models.generateContent({
                    model,
                    contents: systemInstruction,
                });

                resolve(response.text);
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
