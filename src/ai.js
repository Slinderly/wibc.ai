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
            let errorMsg = "🤖 *Aviso del Sistema*\n\n";
            errorMsg += "Lo siento, la tienda no está configurada aún.\n\n";
            errorMsg += "🔧 *¿Qué puedes hacer?*\n";
            errorMsg += "1. Configura tu bot aquí: https://wibc.up.railway.app/\n";
            errorMsg += "2. Si prefieres usarlo **sin IA**, puedes modificar el bot manualmente.\n\n";
            errorMsg += "💬 *¿Necesitas ayuda para conseguir una clave API?*\n";
            errorMsg += "Escríbeme al: +591 64770568";
            
            resolve(errorMsg);
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
                resolve("🤖 [Wibc.ai] Lo siento, hubo un problema procesando tu mensaje con el proveedor de IA. Revisa tu API Key.");
                return;
            }
        }
        
       // --- FALLBACK: CONFIGURACIÓN REQUERIDA ---
let response = "⚠️ *Configuración Pendiente*\n\n";
response += "Wibc.ai necesita una **API Key** para funcionar con Inteligencia Artificial.\n\n";
response += "🔧 *Opciones:* \n";
response += "1. Configura el bot aquí: https://wibc.up.railway.app/\n";
response += "2. Si prefieres usarlo **sin IA**, puedes modificar el bot manualmente desde el código.\n\n";
response += "💬 *¿Necesitas ayuda para conseguir una clave API?*\n";
response += "Escríbeme al: +591 64770568";

        setTimeout(() => { resolve(response); }, 800);
    });
};

module.exports = { generateAIResponse };
