document.addEventListener('DOMContentLoaded', () => {
    const userId = localStorage.getItem('wibc_userId');
    if (!userId) { window.location.href = '/'; return; }

    // ── Toast ──
    const showToast = (msg, type = '') => {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast' + (type ? ' ' + type : '');
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2500);
    };

    // ── Navigation (desktop sidebar + mobile bottom nav) ──
    const viewSections = document.querySelectorAll('.view-section');

    const switchView = (viewName) => {
        viewSections.forEach(s => s.classList.remove('active'));
        const target = document.getElementById(`view-${viewName}`);
        if (target) target.classList.add('active');

        document.querySelectorAll('.nav-links li').forEach(l => {
            l.classList.toggle('active', l.getAttribute('data-view') === viewName);
        });
        document.querySelectorAll('.bottom-nav-item').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-view') === viewName);
        });
    };

    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', () => switchView(li.getAttribute('data-view')));
    });
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.getAttribute('data-view')));
    });

    // ── Logout ──
    const logout = () => { localStorage.removeItem('wibc_userId'); window.location.href = '/'; };
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('logoutBtnMobile').addEventListener('click', logout);

    // ── User Data ──
    let userData = { products: [], aiConfig: { apiKey: '', prompt: '', context: '' }, botMode: 'ai', manualRules: [] };

    const fetchUserData = async () => {
        try {
            const res = await fetch(`/api/data/${userId}`);
            if (res.ok) {
                userData = await res.json();
                userData.manualRules = userData.manualRules || [];
                userData.botMode = userData.botMode || 'ai';
                userData.aiConfig = userData.aiConfig || {};
                userData.aiConfig.context = userData.aiConfig.context || '';
                renderProducts();
                renderConfigForm();
                renderRules();
            }
        } catch (e) { console.error('Failed to load user data', e); }
    };

    const saveUserData = async () => {
        try {
            await fetch(`/api/data/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
        } catch (e) { console.error('Failed to save', e); }
    };

    // ── Products ──
    const renderProducts = () => {
        const list = document.getElementById('productsList');
        if (userData.products.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);">No tienes productos agregados aún.</p>';
            return;
        }
        list.innerHTML = '';
        userData.products.forEach(p => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <div class="prod-header">
                    <h3>${p.name}</h3>
                    <span class="prod-price">$${p.price}</span>
                </div>
                <p style="color:var(--text-muted);font-size:0.88em;">${p.description}</p>
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteProduct('${p.id}')">Eliminar</button>
            `;
            list.appendChild(div);
        });
    };

    window.deleteProduct = (id) => {
        userData.products = userData.products.filter(p => p.id !== id);
        renderProducts();
        saveUserData();
    };

    document.getElementById('productForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.products.push({
            id: Date.now().toString(),
            name: document.getElementById('prodName').value,
            price: document.getElementById('prodPrice').value,
            description: document.getElementById('prodDesc').value
        });
        renderProducts();
        saveUserData();
        e.target.reset();
        showToast('Producto agregado', 'success');
    });

    // ── AI Config ──
    const renderConfigForm = () => {
        document.getElementById('botMode').value = userData.botMode || 'ai';
        document.getElementById('apiKey').value = userData.aiConfig?.apiKey || '';
        document.getElementById('aiPrompt').value = userData.aiConfig?.prompt || '';
        document.getElementById('aiContext').value = userData.aiConfig?.context || '';
    };

    document.getElementById('aiForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.botMode = document.getElementById('botMode').value;
        userData.aiConfig = {
            apiKey: document.getElementById('apiKey').value,
            prompt: document.getElementById('aiPrompt').value,
            context: document.getElementById('aiContext').value
        };
        saveUserData();
        showToast('Configuración guardada', 'success');
    });

    // ── Manual Rules ──
    const renderRules = () => {
        const list = document.getElementById('rulesList');
        if (userData.manualRules.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);">No tienes reglas manuales aún.</p>';
            return;
        }
        list.innerHTML = '';
        userData.manualRules.forEach(r => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <div class="prod-header">
                    <h4>Si dicen: <span class="highlight">"${r.keyword}"</span></h4>
                </div>
                <p style="color:var(--text-muted);font-size:0.88em;margin-bottom:6px;">Responde: ${r.reply}</p>
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteRule('${r.id}')">Eliminar</button>
            `;
            list.appendChild(div);
        });
    };

    window.deleteRule = (id) => {
        userData.manualRules = userData.manualRules.filter(r => r.id !== id);
        renderRules();
        saveUserData();
    };

    document.getElementById('ruleForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.manualRules.push({
            id: Date.now().toString(),
            keyword: document.getElementById('ruleKeyword').value,
            reply: document.getElementById('ruleReply').value
        });
        renderRules();
        saveUserData();
        e.target.reset();
        showToast('Regla agregada', 'success');
    });

    // ── WhatsApp: Connect Tabs ──
    document.querySelectorAll('.connect-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.connect-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.connect-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.getAttribute('data-panel')).classList.add('active');
        });
    });

    // ── WhatsApp: QR Method ──
    let qrPollInterval = null;
    let qrRendered = false;

    const setConnectedState = () => {
        clearInterval(qrPollInterval);
        document.getElementById('qrBoxContainer').style.display = 'none';
        document.getElementById('qrStatus').style.display = 'none';
        document.getElementById('startBotBtn').style.display = 'none';
        document.getElementById('connectedBadge').style.display = 'flex';
    };

    const checkQR = async () => {
        try {
            const res = await fetch(`/api/qr/${userId}`);
            const data = await res.json();
            const qrContainer = document.getElementById('qrcode');
            const status = document.getElementById('qrStatus');

            if (data.connected) {
                setConnectedState();
            } else if (data.qr) {
                document.getElementById('qrBoxContainer').style.display = 'flex';
                status.style.display = 'block';
                if (!qrRendered) {
                    qrContainer.innerHTML = '';
                    new QRCode(qrContainer, { text: data.qr, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
                    qrRendered = true;
                }
                status.textContent = 'Escanea con WhatsApp';
            } else {
                status.style.display = 'block';
                status.textContent = 'Inicializando...';
            }
        } catch (e) { console.error('QR check failed', e); }
    };

    document.getElementById('startBotBtn').addEventListener('click', async () => {
        const btn = document.getElementById('startBotBtn');
        btn.disabled = true;
        btn.textContent = 'Iniciando...';
        qrRendered = false;
        document.getElementById('qrBoxContainer').style.display = 'flex';
        document.getElementById('qrStatus').style.display = 'block';
        document.getElementById('qrStatus').textContent = 'Iniciando...';

        try {
            await fetch('/api/init-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            btn.style.display = 'none';
            checkQR();
            qrPollInterval = setInterval(checkQR, 3000);
        } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Generar Código QR';
            console.error('Failed to init bot', e);
        }
    });

    // ── WhatsApp: Phone Number Method ──
    let phonePollInterval = null;

    const checkPhoneConnection = async () => {
        try {
            const res = await fetch(`/api/qr/${userId}`);
            const data = await res.json();
            if (data.connected) {
                clearInterval(phonePollInterval);
                document.getElementById('pairingCodeDisplay').style.display = 'none';
                document.getElementById('phoneConnectedBadge').style.display = 'flex';
            }
        } catch (e) {}
    };

    document.getElementById('requestCodeBtn').addEventListener('click', async () => {
        const btn = document.getElementById('requestCodeBtn');
        const phoneInput = document.getElementById('phoneNumber');
        const errorEl = document.getElementById('pairingError');
        const codeDisplay = document.getElementById('pairingCodeDisplay');
        const codeEl = document.getElementById('pairingCode');

        const phone = phoneInput.value.replace(/\D/g, '');
        if (!phone || phone.length < 7) {
            errorEl.textContent = 'Ingresa un número válido con código de país.';
            errorEl.style.display = 'block';
            return;
        }

        errorEl.style.display = 'none';
        codeDisplay.style.display = 'none';
        document.getElementById('phoneConnectedBadge').style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Solicitando...';

        try {
            const res = await fetch('/api/request-pairing-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, phoneNumber: phone })
            });
            const data = await res.json();

            if (data.success) {
                // Format code with a dash in the middle: ABCD-EFGH
                const raw = data.code || '';
                codeEl.textContent = raw.length === 8 ? `${raw.slice(0,4)}-${raw.slice(4)}` : raw;
                codeDisplay.style.display = 'block';
                btn.textContent = 'Nuevo Código';
                btn.disabled = false;

                // Start polling for connection
                clearInterval(phonePollInterval);
                phonePollInterval = setInterval(checkPhoneConnection, 3000);
            } else {
                errorEl.textContent = data.message || 'Error al solicitar el código.';
                errorEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Obtener Código';
            }
        } catch (e) {
            errorEl.textContent = 'Error de conexión. Intenta de nuevo.';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Obtener Código';
        }
    });

    fetchUserData();
});
