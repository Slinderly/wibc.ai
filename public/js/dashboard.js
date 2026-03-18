document.addEventListener('DOMContentLoaded', () => {
    const userId = localStorage.getItem('wibc_userId');
    if (!userId) { window.location.href = '/'; return; }

    // Init Lucide icons
    lucide.createIcons();

    // ── Toast ──
    const showToast = (msg, type = '') => {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast' + (type ? ' ' + type : '');
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2500);
    };

    // ── Navigation ──
    const viewSections = document.querySelectorAll('.view-section');

    const switchView = (viewName) => {
        viewSections.forEach(s => s.classList.remove('active'));
        document.getElementById(`view-${viewName}`)?.classList.add('active');
        document.querySelectorAll('.nav-links li').forEach(l =>
            l.classList.toggle('active', l.dataset.view === viewName));
        document.querySelectorAll('.bottom-nav-item').forEach(b =>
            b.classList.toggle('active', b.dataset.view === viewName));
    };

    document.querySelectorAll('.nav-links li').forEach(li =>
        li.addEventListener('click', () => switchView(li.dataset.view)));
    document.querySelectorAll('.bottom-nav-item').forEach(btn =>
        btn.addEventListener('click', () => switchView(btn.dataset.view)));

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
                userData.aiConfig = { ...{ apiKey:'', prompt:'', context:'' }, ...userData.aiConfig };
                renderProducts(); renderConfigForm(); renderRules();
            }
        } catch (e) { console.error(e); }
    };

    const saveUserData = async () => {
        try {
            await fetch(`/api/data/${userId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
        } catch (e) { console.error(e); }
    };

    // ── Products ──
    const renderProducts = () => {
        const list = document.getElementById('productsList');
        if (!userData.products.length) {
            list.innerHTML = '<p style="color:var(--text-muted);">No tienes productos agregados aún.</p>'; return;
        }
        list.innerHTML = '';
        userData.products.forEach(p => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <div class="prod-header"><h3>${p.name}</h3><span class="prod-price">$${p.price}</span></div>
                <p style="color:var(--text-muted);font-size:0.88em;">${p.description}</p>
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteProduct('${p.id}')">Eliminar</button>`;
            list.appendChild(div);
        });
    };

    window.deleteProduct = (id) => { userData.products = userData.products.filter(p => p.id !== id); renderProducts(); saveUserData(); };

    document.getElementById('productForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.products.push({ id: Date.now().toString(), name: document.getElementById('prodName').value, price: document.getElementById('prodPrice').value, description: document.getElementById('prodDesc').value });
        renderProducts(); saveUserData(); e.target.reset();
        showToast('Producto agregado', 'success');
    });

    // ── AI Config ──
    const renderConfigForm = () => {
        document.getElementById('botMode').value = userData.botMode;
        document.getElementById('apiKey').value = userData.aiConfig.apiKey || '';
        document.getElementById('aiPrompt').value = userData.aiConfig.prompt || '';
        document.getElementById('aiContext').value = userData.aiConfig.context || '';
    };

    document.getElementById('aiForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.botMode = document.getElementById('botMode').value;
        userData.aiConfig = { apiKey: document.getElementById('apiKey').value, prompt: document.getElementById('aiPrompt').value, context: document.getElementById('aiContext').value };
        saveUserData(); showToast('Configuración guardada', 'success');
    });

    // ── Manual Rules ──
    const renderRules = () => {
        const list = document.getElementById('rulesList');
        if (!userData.manualRules.length) { list.innerHTML = '<p style="color:var(--text-muted);">No tienes reglas manuales aún.</p>'; return; }
        list.innerHTML = '';
        userData.manualRules.forEach(r => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.innerHTML = `
                <div class="prod-header"><h4>Si dicen: <span class="highlight">"${r.keyword}"</span></h4></div>
                <p style="color:var(--text-muted);font-size:0.88em;margin-bottom:6px;">Responde: ${r.reply}</p>
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteRule('${r.id}')">Eliminar</button>`;
            list.appendChild(div);
        });
    };

    window.deleteRule = (id) => { userData.manualRules = userData.manualRules.filter(r => r.id !== id); renderRules(); saveUserData(); };

    document.getElementById('ruleForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.manualRules.push({ id: Date.now().toString(), keyword: document.getElementById('ruleKeyword').value, reply: document.getElementById('ruleReply').value });
        renderRules(); saveUserData(); e.target.reset();
        showToast('Regla agregada', 'success');
    });

    // ── WhatsApp Multi-Device ──

    // Render devices list
    const renderDevices = (sessions) => {
        const list = document.getElementById('devicesList');
        if (!sessions.length) {
            list.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;padding:8px 0;">Sin dispositivos conectados.</p>';
            return;
        }
        list.innerHTML = '';
        sessions.forEach(s => {
            const phone  = s.device?.phone ? `+${s.device.phone}` : '—';
            const name   = s.device?.name || '';
            const connAt = s.device?.connectedAt
                ? new Date(s.device.connectedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                : '—';

            const dotClass = s.status === 'connected' ? 'connected' : s.status === 'connecting' ? 'connecting' : 'disconnected';

            const row = document.createElement('div');
            row.className = 'device-row';
            row.innerHTML = `
                <div class="device-dot ${dotClass}"></div>
                <div class="device-details" style="flex:1;">
                    <div class="device-phone">${phone}${name ? ` <span style="color:var(--text-muted);font-weight:400;font-size:0.85em;">${name}</span>` : ''}</div>
                    <div class="device-meta">${s.status === 'connected' ? `Conectado desde ${connAt}` : s.status === 'connecting' ? 'Conectando...' : 'Desconectado'}</div>
                </div>
                <button class="btn-danger" style="padding:6px 12px;font-size:0.8rem;" onclick="window.disconnectDevice('${s.sessionId}')">Desconectar</button>`;
            list.appendChild(row);
        });
    };

    const fetchDevices = async () => {
        try {
            const res = await fetch(`/api/devices/${userId}`);
            if (res.ok) {
                const data = await res.json();
                renderDevices(data.sessions || []);
            }
        } catch (e) { console.error(e); }
    };

    window.disconnectDevice = async (sessionId) => {
        if (!confirm('¿Desconectar este dispositivo?')) return;
        await fetch(`/api/devices/${userId}/${sessionId}`, { method: 'DELETE' });
        showToast('Dispositivo desconectado');
        fetchDevices();
    };

    // ── Add Device Panel ──
    const addDeviceCard = document.getElementById('addDeviceCard');
    const addDeviceBtn  = document.getElementById('addDeviceBtn');
    const closeAddBtn   = document.getElementById('closeAddDevice');

    addDeviceBtn.addEventListener('click', () => {
        addDeviceCard.style.display = 'block';
        addDeviceBtn.disabled = true;
        lucide.createIcons();
        resetQRPanel();
        resetPhonePanel();
    });

    closeAddBtn.addEventListener('click', () => {
        addDeviceCard.style.display = 'none';
        addDeviceBtn.disabled = false;
        clearAllPolling();
    });

    // ── Tab switching inside add panel ──
    document.querySelectorAll('.connect-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.connect-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.connect-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.panel).classList.add('active');
        });
    });

    // ── QR Method ──
    let qrPollInterval = null;
    let qrCountdownInterval = null;
    let qrRendered = false;
    let activeQRSessionId = null;
    const QR_TIMEOUT_MS = 60000;

    const clearAllPolling = () => {
        clearInterval(qrPollInterval); clearInterval(qrCountdownInterval);
        clearInterval(phonePollInterval); clearInterval(phoneCountdown);
    };

    const resetQRPanel = () => {
        clearInterval(qrPollInterval); clearInterval(qrCountdownInterval);
        qrRendered = false; activeQRSessionId = null;
        document.getElementById('qrWrapper').style.display = 'none';
        document.getElementById('qrTimeoutMsg').style.display = 'none';
        document.getElementById('qrcode').innerHTML = '';
        document.getElementById('qrStatus').textContent = '';
        const btn = document.getElementById('startBotBtn');
        btn.style.display = ''; btn.disabled = false; btn.textContent = 'Generar Código QR';
    };

    const onQRConnected = () => {
        clearInterval(qrPollInterval); clearInterval(qrCountdownInterval);
        addDeviceCard.style.display = 'none';
        addDeviceBtn.disabled = false;
        showToast('WhatsApp vinculado correctamente', 'success');
        setTimeout(fetchDevices, 1000);
    };

    const startQRCountdown = () => {
        const timerWrap = document.getElementById('qrTimer');
        const timerBar  = document.getElementById('timerBar');
        const timerLabel = document.getElementById('timerLabel');
        timerWrap.style.display = 'flex';
        let remaining = QR_TIMEOUT_MS / 1000;
        timerBar.style.width = '100%';
        timerLabel.textContent = `${remaining}s`;
        qrCountdownInterval = setInterval(() => {
            remaining -= 1;
            timerBar.style.width = `${Math.max(0, (remaining / (QR_TIMEOUT_MS / 1000)) * 100)}%`;
            timerLabel.textContent = `${remaining}s`;
            if (remaining <= 0) clearInterval(qrCountdownInterval);
        }, 1000);
    };

    const checkQR = async () => {
        if (!activeQRSessionId) return;
        try {
            const res = await fetch(`/api/qr/${userId}/${activeQRSessionId}`);
            const data = await res.json();
            const qrContainer = document.getElementById('qrcode');

            if (data.connected || data.status === 'connected') { onQRConnected(); return; }
            if (data.status === 'timeout') {
                clearInterval(qrPollInterval); clearInterval(qrCountdownInterval);
                document.getElementById('qrWrapper').style.display = 'none';
                document.getElementById('qrTimeoutMsg').style.display = 'block';
                return;
            }
            if (data.qr) {
                document.getElementById('qrWrapper').style.display = 'flex';
                if (!qrRendered) {
                    qrContainer.innerHTML = '';
                    new QRCode(qrContainer, { text: data.qr, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
                    qrRendered = true; startQRCountdown();
                }
                document.getElementById('qrStatus').textContent = 'Escanea con WhatsApp';
            } else {
                document.getElementById('qrWrapper').style.display = 'flex';
                document.getElementById('qrStatus').textContent = 'Inicializando...';
            }
        } catch (e) { console.error(e); }
    };

    document.getElementById('startBotBtn').addEventListener('click', async () => {
        const btn = document.getElementById('startBotBtn');
        btn.disabled = true; btn.textContent = 'Iniciando...';
        document.getElementById('qrTimeoutMsg').style.display = 'none';
        qrRendered = false;

        try {
            const res = await fetch('/api/init-bot', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            const data = await res.json();
            activeQRSessionId = data.sessionId;
            btn.style.display = 'none';
            clearInterval(qrPollInterval);
            checkQR();
            qrPollInterval = setInterval(checkQR, 2000);
            setTimeout(() => clearInterval(qrPollInterval), QR_TIMEOUT_MS + 5000);
        } catch {
            btn.disabled = false; btn.textContent = 'Generar Código QR';
        }
    });

    document.getElementById('retryQrBtn').addEventListener('click', resetQRPanel);

    // ── Phone Number Method ──
    let phonePollInterval = null;
    let phoneCountdown = null;
    let activePhoneSessionId = null;
    const PHONE_TIMEOUT_MS = 60000;

    const resetPhonePanel = () => {
        clearInterval(phonePollInterval); clearInterval(phoneCountdown);
        activePhoneSessionId = null;
        document.getElementById('pairingCodeDisplay').style.display = 'none';
        document.getElementById('phoneTimeoutMsg').style.display = 'none';
        document.getElementById('pairingError').style.display = 'none';
        document.getElementById('phoneNumber').value = '';
        document.getElementById('countryCode').selectedIndex = 0;
        const btn = document.getElementById('requestCodeBtn');
        btn.disabled = false; btn.textContent = 'Obtener Código';
    };

    const onPhoneConnected = () => {
        clearInterval(phonePollInterval); clearInterval(phoneCountdown);
        addDeviceCard.style.display = 'none';
        addDeviceBtn.disabled = false;
        showToast('WhatsApp vinculado correctamente', 'success');
        setTimeout(fetchDevices, 1000);
    };

    const startPhoneCountdown = () => {
        const label = document.getElementById('phoneTimer');
        let remaining = PHONE_TIMEOUT_MS / 1000;
        label.textContent = `El código expira en ${remaining}s`;
        phoneCountdown = setInterval(() => {
            remaining -= 1;
            label.textContent = remaining > 0 ? `El código expira en ${remaining}s` : 'El código expiró.';
            if (remaining <= 0) clearInterval(phoneCountdown);
        }, 1000);
    };

    const checkPhoneConnection = async () => {
        if (!activePhoneSessionId) return;
        try {
            const res = await fetch(`/api/qr/${userId}/${activePhoneSessionId}`);
            const data = await res.json();
            if (data.connected || data.status === 'connected') { onPhoneConnected(); return; }
            if (data.status === 'timeout') {
                clearInterval(phonePollInterval); clearInterval(phoneCountdown);
                document.getElementById('pairingCodeDisplay').style.display = 'none';
                document.getElementById('phoneTimeoutMsg').style.display = 'block';
            }
        } catch {}
    };

    document.getElementById('requestCodeBtn').addEventListener('click', async () => {
        const btn = document.getElementById('requestCodeBtn');
        const countryCode = document.getElementById('countryCode').value;
        const localNumber = document.getElementById('phoneNumber').value.replace(/\D/g, '');
        const phone = countryCode + localNumber;
        const errorEl = document.getElementById('pairingError');

        if (!localNumber || localNumber.length < 5) {
            errorEl.textContent = 'Ingresa un número de teléfono válido (sin código de país).';
            errorEl.style.display = 'block'; return;
        }

        errorEl.style.display = 'none';
        document.getElementById('pairingCodeDisplay').style.display = 'none';
        document.getElementById('phoneTimeoutMsg').style.display = 'none';
        btn.disabled = true; btn.textContent = 'Solicitando...';

        try {
            const res = await fetch('/api/request-pairing-code', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, phoneNumber: phone })
            });
            const data = await res.json();

            if (data.success) {
                activePhoneSessionId = data.sessionId;
                const raw = data.code || '';
                document.getElementById('pairingCode').textContent = raw.length === 8 ? `${raw.slice(0,4)}-${raw.slice(4)}` : raw;
                document.getElementById('pairingCodeDisplay').style.display = 'block';
                btn.textContent = 'Nuevo Código'; btn.disabled = false;
                clearInterval(phonePollInterval); clearInterval(phoneCountdown);
                startPhoneCountdown();
                phonePollInterval = setInterval(checkPhoneConnection, 3000);
                setTimeout(() => clearInterval(phonePollInterval), PHONE_TIMEOUT_MS + 5000);
            } else {
                errorEl.textContent = data.message || 'Error al solicitar el código.';
                errorEl.style.display = 'block';
                btn.disabled = false; btn.textContent = 'Obtener Código';
            }
        } catch {
            errorEl.textContent = 'Error de conexión. Intenta de nuevo.';
            errorEl.style.display = 'block';
            btn.disabled = false; btn.textContent = 'Obtener Código';
        }
    });

    document.getElementById('retryPhoneBtn').addEventListener('click', resetPhonePanel);

    // ── Init ──
    fetchUserData();
    fetchDevices();
});
