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

    // ── Navigation ──
    const viewSections = document.querySelectorAll('.view-section');

    const switchView = (viewName) => {
        viewSections.forEach(s => s.classList.remove('active'));
        const target = document.getElementById(`view-${viewName}`);
        if (target) target.classList.add('active');
        document.querySelectorAll('.nav-links li').forEach(l =>
            l.classList.toggle('active', l.getAttribute('data-view') === viewName));
        document.querySelectorAll('.bottom-nav-item').forEach(b =>
            b.classList.toggle('active', b.getAttribute('data-view') === viewName));
    };

    document.querySelectorAll('.nav-links li').forEach(li =>
        li.addEventListener('click', () => switchView(li.getAttribute('data-view'))));
    document.querySelectorAll('.bottom-nav-item').forEach(btn =>
        btn.addEventListener('click', () => switchView(btn.getAttribute('data-view'))));

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
        } catch (e) { console.error(e); }
    };

    const saveUserData = async () => {
        try {
            await fetch(`/api/data/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
        } catch (e) { console.error(e); }
    };

    // ── Products ──
    const renderProducts = () => {
        const list = document.getElementById('productsList');
        if (!userData.products.length) {
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
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteProduct('${p.id}')">Eliminar</button>`;
            list.appendChild(div);
        });
    };

    window.deleteProduct = (id) => {
        userData.products = userData.products.filter(p => p.id !== id);
        renderProducts(); saveUserData();
    };

    document.getElementById('productForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.products.push({
            id: Date.now().toString(),
            name: document.getElementById('prodName').value,
            price: document.getElementById('prodPrice').value,
            description: document.getElementById('prodDesc').value
        });
        renderProducts(); saveUserData(); e.target.reset();
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
        saveUserData(); showToast('Configuración guardada', 'success');
    });

    // ── Manual Rules ──
    const renderRules = () => {
        const list = document.getElementById('rulesList');
        if (!userData.manualRules.length) {
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
                <button class="btn-danger" style="margin-top:auto;" onclick="window.deleteRule('${r.id}')">Eliminar</button>`;
            list.appendChild(div);
        });
    };

    window.deleteRule = (id) => {
        userData.manualRules = userData.manualRules.filter(r => r.id !== id);
        renderRules(); saveUserData();
    };

    document.getElementById('ruleForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.manualRules.push({
            id: Date.now().toString(),
            keyword: document.getElementById('ruleKeyword').value,
            reply: document.getElementById('ruleReply').value
        });
        renderRules(); saveUserData(); e.target.reset();
        showToast('Regla agregada', 'success');
    });

    // ── Device Info Renderer ──
    const renderDeviceInfo = (device, status) => {
        const el = document.getElementById('deviceInfo');
        if (status === 'connected' && device) {
            const phone = device.phone || '—';
            const name = device.name ? `<span style="color:var(--text-muted);font-size:0.85em;">${device.name}</span>` : '';
            const connAt = device.connectedAt
                ? new Date(device.connectedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
                : '—';
            el.innerHTML = `
                <div class="device-row">
                    <div class="device-dot connected"></div>
                    <div class="device-details">
                        <div class="device-phone">+${phone} ${name}</div>
                        <div class="device-meta">Conectado desde ${connAt}</div>
                    </div>
                </div>`;
        } else if (status === 'connecting') {
            el.innerHTML = `<div class="device-row"><div class="device-dot connecting"></div><div class="device-details"><div class="device-phone">Conectando...</div></div></div>`;
        } else {
            el.innerHTML = `<p style="color:var(--text-muted);font-size:0.9rem;">Sin conexión activa.</p>`;
        }
    };

    const fetchDevices = async () => {
        try {
            const res = await fetch(`/api/devices/${userId}`);
            const data = await res.json();
            renderDeviceInfo(data.device, data.status);
            return data.status;
        } catch { return 'disconnected'; }
    };

    // ── WhatsApp: Tab switching ──
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
    let qrCountdownInterval = null;
    let qrRendered = false;
    const QR_TIMEOUT_MS = 30000;

    const resetQRPanel = () => {
        clearInterval(qrPollInterval);
        clearInterval(qrCountdownInterval);
        qrRendered = false;
        document.getElementById('qrWrapper').style.display = 'none';
        document.getElementById('qrTimeoutMsg').style.display = 'none';
        document.getElementById('qrcode').innerHTML = '';
        document.getElementById('qrStatus').textContent = '';
        document.getElementById('startBotBtn').style.display = '';
        document.getElementById('startBotBtn').disabled = false;
        document.getElementById('startBotBtn').textContent = 'Generar Código QR';
    };

    const showQRTimeout = () => {
        clearInterval(qrPollInterval);
        clearInterval(qrCountdownInterval);
        document.getElementById('qrWrapper').style.display = 'none';
        document.getElementById('qrTimeoutMsg').style.display = 'block';
    };

    const setConnectedUI = () => {
        clearInterval(qrPollInterval);
        clearInterval(qrCountdownInterval);
        document.getElementById('qrWrapper').style.display = 'none';
        document.getElementById('qrTimeoutMsg').style.display = 'none';
        document.getElementById('startBotBtn').style.display = 'none';
        document.getElementById('connectedBadge').style.display = 'flex';
        document.getElementById('connectCard').style.display = 'none';
        fetchDevices();
    };

    const startQRCountdown = () => {
        const timerWrap = document.getElementById('qrTimer');
        const timerBar = document.getElementById('timerBar');
        const timerLabel = document.getElementById('timerLabel');
        timerWrap.style.display = 'flex';

        let remaining = QR_TIMEOUT_MS / 1000;
        timerBar.style.width = '100%';
        timerLabel.textContent = `${remaining}s`;

        qrCountdownInterval = setInterval(() => {
            remaining -= 1;
            const pct = (remaining / (QR_TIMEOUT_MS / 1000)) * 100;
            timerBar.style.width = `${Math.max(0, pct)}%`;
            timerLabel.textContent = `${remaining}s`;
            if (remaining <= 0) clearInterval(qrCountdownInterval);
        }, 1000);
    };

    const checkQR = async () => {
        try {
            const res = await fetch(`/api/qr/${userId}`);
            const data = await res.json();
            const qrContainer = document.getElementById('qrcode');

            if (data.connected || data.status === 'connected') {
                setConnectedUI(); return;
            }
            if (data.status === 'timeout') {
                showQRTimeout(); return;
            }
            if (data.qr) {
                document.getElementById('qrWrapper').style.display = 'flex';
                if (!qrRendered) {
                    qrContainer.innerHTML = '';
                    new QRCode(qrContainer, { text: data.qr, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
                    qrRendered = true;
                    startQRCountdown();
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
        btn.disabled = true;
        btn.textContent = 'Iniciando...';
        document.getElementById('qrTimeoutMsg').style.display = 'none';
        qrRendered = false;

        try {
            await fetch('/api/init-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            btn.style.display = 'none';
            clearInterval(qrPollInterval);
            checkQR();
            qrPollInterval = setInterval(checkQR, 3000);
            // Auto-stop polling after QR timeout + buffer
            setTimeout(() => {
                if (connectionStatus !== 'connected') {
                    clearInterval(qrPollInterval);
                }
            }, QR_TIMEOUT_MS + 5000);
        } catch {
            btn.disabled = false;
            btn.textContent = 'Generar Código QR';
        }
    });

    document.getElementById('retryQrBtn').addEventListener('click', () => {
        resetQRPanel();
    });

    // ── WhatsApp: Phone Number Method ──
    let phonePollInterval = null;
    let phoneCountdown = null;
    const PHONE_TIMEOUT_MS = 60000;

    const resetPhonePanel = () => {
        clearInterval(phonePollInterval);
        clearInterval(phoneCountdown);
        document.getElementById('pairingCodeDisplay').style.display = 'none';
        document.getElementById('phoneTimeoutMsg').style.display = 'none';
        document.getElementById('pairingError').style.display = 'none';
        document.getElementById('phoneNumber').value = '';
        const btn = document.getElementById('requestCodeBtn');
        btn.disabled = false;
        btn.textContent = 'Obtener Código';
    };

    const startPhoneCountdown = () => {
        const label = document.getElementById('phoneTimer');
        let remaining = PHONE_TIMEOUT_MS / 1000;
        label.textContent = `El código expira en ${remaining}s`;

        phoneCountdown = setInterval(() => {
            remaining -= 1;
            label.textContent = `El código expira en ${remaining}s`;
            if (remaining <= 0) {
                clearInterval(phoneCountdown);
                label.textContent = 'El código expiró.';
            }
        }, 1000);
    };

    const checkPhoneConnection = async () => {
        try {
            const res = await fetch(`/api/qr/${userId}`);
            const data = await res.json();
            if (data.connected || data.status === 'connected') {
                clearInterval(phonePollInterval);
                clearInterval(phoneCountdown);
                setConnectedUI();
            } else if (data.status === 'timeout') {
                clearInterval(phonePollInterval);
                clearInterval(phoneCountdown);
                document.getElementById('pairingCodeDisplay').style.display = 'none';
                document.getElementById('phoneTimeoutMsg').style.display = 'block';
            }
        } catch {}
    };

    document.getElementById('requestCodeBtn').addEventListener('click', async () => {
        const btn = document.getElementById('requestCodeBtn');
        const phone = document.getElementById('phoneNumber').value.replace(/\D/g, '');
        const errorEl = document.getElementById('pairingError');

        if (!phone || phone.length < 7) {
            errorEl.textContent = 'Ingresa un número válido con código de país (ej: 59171234567).';
            errorEl.style.display = 'block';
            return;
        }

        errorEl.style.display = 'none';
        document.getElementById('pairingCodeDisplay').style.display = 'none';
        document.getElementById('phoneTimeoutMsg').style.display = 'none';
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
                const raw = data.code || '';
                document.getElementById('pairingCode').textContent =
                    raw.length === 8 ? `${raw.slice(0,4)}-${raw.slice(4)}` : raw;
                document.getElementById('pairingCodeDisplay').style.display = 'block';
                btn.textContent = 'Nuevo Código';
                btn.disabled = false;

                clearInterval(phonePollInterval);
                clearInterval(phoneCountdown);
                startPhoneCountdown();
                phonePollInterval = setInterval(checkPhoneConnection, 3000);

                // Stop polling after timeout
                setTimeout(() => clearInterval(phonePollInterval), PHONE_TIMEOUT_MS + 5000);
            } else {
                errorEl.textContent = data.message || 'Error al solicitar el código.';
                errorEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Obtener Código';
            }
        } catch {
            errorEl.textContent = 'Error de conexión. Intenta de nuevo.';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Obtener Código';
        }
    });

    document.getElementById('retryPhoneBtn').addEventListener('click', resetPhonePanel);

    // ── Init: check current connection status ──
    const initWhatsAppStatus = async () => {
        const status = await fetchDevices();
        if (status === 'connected') {
            document.getElementById('connectedBadge').style.display = 'flex';
            document.getElementById('connectCard').style.display = 'none';
        }
    };

    fetchUserData();
    initWhatsAppStatus();
});
