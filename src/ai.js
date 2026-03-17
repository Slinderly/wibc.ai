const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require("@google/genai");

/**
 * Función simulada para generar respuesta IA.
 * En el entorno de producción, esto debería usar OpenAI, Mistral, u otro LLM validando la API Key.
 * @param {string} userId - ID del usuario de la plataforma
 * @param {string} incomingMessage - Mensaje recibido en WhatsApp
 * @returns {Promise<string>} - Respuesta del bot
 */
const generateAIResponse = async (userId, incomingMessage) => {
    return new Promise(async (resolve) => {
        // 1. Cargar datos del usuario
        const userDataPath = path.join(__dirname, `../data/user_data/${userId}.json`);
        
        if (!fs.existsSync(userDataPath)) {
            resolve("Lo siento, la tienda no está configurada aún.");
            return;
        }

        const userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
        const { botMode, manualRules, aiConfig, products } = userData;
        
        const mode = botMode || 'ai';

        if (mode === 'manual') {
            const rules = manualRules || [];
            // Simple keyword match
            const msgLower = incomingMessage.toLowerCase();
            const matchedRule = rules.find(r => msgLower.includes(r.keyword.toLowerCase()));
            
            if (matchedRule) {
                resolve(matchedRule.reply);
            } else {
                resolve(null); // No match, don't reply
            }
            return;
        }

        // --- INTEGRACIÓN GOOGLE GEMINI REAL ---
        if (aiConfig.apiKey && aiConfig.apiKey.trim() !== '') {
            try {
                const ai = new GoogleGenAI({ apiKey: aiConfig.apiKey });
                
                // Construimos el promt inyectando contexto y catálogo
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
                    model: "gemini-2.5-flash",
                    contents: systemInstruction,
                });

                resolve(response.text);
                return;
            } catch (error) {
                console.error("[wibc.ai] 🔴 Error:", error);
                resolve("🤖 [Error de IA] Lo siento, hubo un problema procesando tu mensaje con el proveedor de IA. Revisa tu API Key.");
                return;
            }
        }
        
        // --- FALLBACK: MODO IA SIMULADA (Si no hay API KEY) ---
        let response = `🤖 [IA Simulada - Sin API Key]\n**Prompt:** ${aiConfig.prompt}\n\n`;
        
        if (products && products.length > 0) {
            // Lógica simple manual
            if (incomingMessage.toLowerCase().includes('precio') || incomingMessage.toLowerCase().includes('producto')) {
                response += "Aquí tienes nuestros productos:\n";
                products.forEach(p => {
                    response += `- ${p.name}: $${p.price}\n  (${p.description})\n`;
                });
            } else {
                response += "¡Hola! Pregúntame por productos o precios.";
            }
        } else {
             response += "Actualmente no tenemos productos en stock.";
        }

        setTimeout(() => { resolve(response); }, 800);
    });
};

module.exports = { generateAIResponse };
