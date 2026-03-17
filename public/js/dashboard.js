document.addEventListener('DOMContentLoaded', () => {
    const userId = localStorage.getItem('wibc_userId');
    if (!userId) {
        window.location.href = '/';
        return;
    }

    // Navegación Sidebar
    const navLinks = document.querySelectorAll('.nav-links li');
    const viewSections = document.querySelectorAll('.view-section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            // Activar link
            navLinks.forEach(n => n.classList.remove('active'));
            link.classList.add('active');
            
            // Mostrar sección
            const targetView = link.getAttribute('data-view');
            viewSections.forEach(section => {
                section.classList.remove('active');
                if(section.id === `view-${targetView}`) {
                    section.classList.add('active');
                }
            });
        });
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('wibc_userId');
        window.location.href = '/';
    });

    // Estado global de usuario local
    let userData = {
        products: [],
        aiConfig: { apiKey: '', prompt: '', context: '' },
        botMode: 'ai',
        manualRules: []
    };

    // ------------- DATA FETCHING -------------
    const fetchUserData = async () => {
        try {
            const res = await fetch(`/api/data/${userId}`);
            if (res.ok) {
                userData = await res.json();
                if (!userData.manualRules) userData.manualRules = []; // backwards compat
                if (!userData.botMode) userData.botMode = 'ai';
                if (!userData.aiConfig.context) userData.aiConfig.context = '';
                
                renderProducts();
                renderConfigForm();
                renderRules();
            }
        } catch (e) {
            console.error('Failed to load user data', e);
        }
    };

    const saveUserData = async () => {
        try {
            await fetch(`/api/data/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
            // Opcional: mostrar notificación de guardado
        } catch (e) {
            console.error('Failed to save user data', e);
        }
    };

    // ------------- PRODUCTS -------------
    const productForm = document.getElementById('productForm');
    const productsList = document.getElementById('productsList');

    const renderProducts = () => {
        productsList.innerHTML = '';
        if (userData.products.length === 0) {
            productsList.innerHTML = '<p style="color:var(--text-muted);">No tienes productos agregados aún.</p>';
            return;
        }

        userData.products.forEach(p => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <div class="prod-header">
                    <h3>${p.name}</h3>
                    <span class="prod-price">$${p.price}</span>
                </div>
                <p style="color:var(--text-muted); font-size: 0.9em;">${p.description}</p>
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteProduct('${p.id}')">Eliminar</button>
            `;
            productsList.appendChild(div);
        });
    };

    window.deleteProduct = (id) => {
        userData.products = userData.products.filter(p => p.id !== id);
        renderProducts();
        saveUserData();
    };

    productForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newProduct = {
            id: Date.now().toString(),
            name: document.getElementById('prodName').value,
            price: document.getElementById('prodPrice').value,
            description: document.getElementById('prodDesc').value
        };
        userData.products.push(newProduct);
        renderProducts();
        saveUserData();
        productForm.reset();
    });

    // ------------- AI CONFIG -------------
    const aiForm = document.getElementById('aiForm');
    
    const renderConfigForm = () => {
        document.getElementById('botMode').value = userData.botMode || 'ai';
        if(userData.aiConfig) {
            document.getElementById('apiKey').value = userData.aiConfig.apiKey || '';
            document.getElementById('aiPrompt').value = userData.aiConfig.prompt || '';
            document.getElementById('aiContext').value = userData.aiConfig.context || '';
        }
    };

    aiForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = document.querySelector('#aiForm button');
        btn.textContent = 'Guardado!';
        
        userData.botMode = document.getElementById('botMode').value;
        userData.aiConfig = {
            apiKey: document.getElementById('apiKey').value,
            prompt: document.getElementById('aiPrompt').value,
            context: document.getElementById('aiContext').value
        };
        saveUserData();
        
        setTimeout(()=> { btn.textContent = 'Guardar Configuración'; }, 2000);
    });

    // ------------- MANUAL RULES -------------
    const ruleForm = document.getElementById('ruleForm');
    const rulesList = document.getElementById('rulesList');

    const renderRules = () => {
        rulesList.innerHTML = '';
        if (userData.manualRules.length === 0) {
            rulesList.innerHTML = '<p style="color:var(--text-muted);">No tienes reglas manuales agregados aún.</p>';
            return;
        }

        userData.manualRules.forEach(r => {
            const div = document.createElement('div');
            div.className = 'product-card'; // reusar estilos de card
            div.innerHTML = `
                <div class="prod-header">
                    <h4>Si dicen: <span class="highlight">${r.keyword}</span></h4>
                </div>
                <p style="color:var(--text-muted); font-size: 0.9em; margin-bottom:10px;">Resp: ${r.reply}</p>
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteRule('${r.id}')">Eliminar</button>
            `;
            rulesList.appendChild(div);
        });
    };

    window.deleteRule = (id) => {
        userData.manualRules = userData.manualRules.filter(r => r.id !== id);
        renderRules();
        saveUserData();
    };

    ruleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newRule = {
            id: Date.now().toString(),
            keyword: document.getElementById('ruleKeyword').value,
            reply: document.getElementById('ruleReply').value
        };
        userData.manualRules.push(newRule);
        renderRules();
        saveUserData();
        ruleForm.reset();
    });

    // ------------- WHATSAPP -------------
    let qrPollInterval = null;
    let qrActive = false;
    
    const checkQR = async () => {
        try {
            const res = await fetch(`/api/qr/${userId}`);
            const data = await res.json();
            
            const qrContainer = document.getElementById('qrcode');
            const status = document.getElementById('qrStatus');

            if (data.connected && !data.qr) {
                // Conectado
                clearInterval(qrPollInterval);
                qrContainer.innerHTML = '✅';
                qrContainer.style.fontSize = '80px';
                status.textContent = 'Bot conectado y funcionando!';
            } else if (data.qr) {
                // Mostrar QR
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: data.qr,
                    width: 200,
                    height: 200
                });
                status.textContent = 'Escanea el QR con WhatsApp';
            } else {
                if(!qrActive) {
                    qrContainer.innerHTML = '';
                    status.textContent = 'Inicializando...';
                }
            }
        } catch (e) {
            console.error('QR check failed', e);
        }
    };

    document.getElementById('startBotBtn').addEventListener('click', async () => {
        try {
            qrActive = true;
            await fetch('/api/init-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            document.getElementById('startBotBtn').style.display = 'none';
            checkQR();
            qrPollInterval = setInterval(checkQR, 3000); // Polling cada 3 segundos
        } catch (e) {
            console.error('Failed to init bot', e);
        }
    });

    // Iniciar
    fetchUserData();
});
