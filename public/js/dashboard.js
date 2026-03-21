document.addEventListener('DOMContentLoaded', () => {
    const userId = localStorage.getItem('wibc_userId');
    if (!userId) { window.location.href = '/'; return; }

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

    // ── Automation sub-tabs ──
    document.querySelectorAll('.auto-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auto-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auto-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`auto-${tab.dataset.auto}`)?.classList.add('active');
        });
    });

    // ── Logout ──
    const logout = () => { localStorage.removeItem('wibc_userId'); window.location.href = '/'; };
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('logoutBtnMobile').addEventListener('click', logout);

    // ── User Data ──
    let userData = {
        products: [],
        aiConfig: { apiKey: '', prompt: '', context: '', model: '' },
        botMode: 'ai',
        manualRules: [],
        conversationFlows: []
    };

    const fetchUserData = async () => {
        try {
            const res = await fetch(`/api/data/${userId}`);
            if (res.ok) {
                userData = await res.json();
                userData.manualRules       = userData.manualRules || [];
                userData.botMode           = userData.botMode || 'ai';
                userData.conversationFlows = userData.conversationFlows || [];
                userData.aiConfig = { apiKey:'', prompt:'', context:'', model:'', ...userData.aiConfig };
                renderProducts(); renderConfigForm(); renderRules(); renderFlows();
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
    const buildWizardPrompt = (w) => {
        const botName  = w.botName      || 'el asistente virtual';
        const bizName  = w.businessName || 'el negocio';
        const persona  = w.personality  || 'amable y profesional';

        let p = `Eres ${botName}, el asistente virtual de ${bizName}. Tu personalidad es ${persona}. Tu objetivo es atender a los clientes, presentar los productos disponibles y tomar pedidos de forma clara y ordenada.\n\n`;

        if (w.doesDelivery) {
            const data = w.deliveryData || 'nombre completo, dirección, referencia';
            p += `Realizamos envíos a domicilio. Para coordinar cualquier pedido con envío, solicita siempre al cliente: ${data}.\n`;
        } else {
            p += `Los pedidos son únicamente para retirar en tienda, no realizamos envíos a domicilio.\n`;
        }

        if (w.location)      p += `\nNuestra ubicación: ${w.location}.`;
        if (w.businessPhone) p += `\nTeléfono directo del negocio: ${w.businessPhone}.`;
        if (w.hoursFrom && w.hoursTo) p += `\nHorario de atención: de ${w.hoursFrom} a ${w.hoursTo}.`;
        if (w.currency)      p += `\nTodos los precios están expresados en ${w.currency}.`;
        if (w.askClientPhone) p += `\nAl confirmar cualquier pedido, solicita siempre el número de teléfono del cliente para coordinar.`;

        return p.trim();
    };

    const renderConfigForm = () => {
        document.getElementById('botMode').value   = userData.botMode;
        document.getElementById('apiKey').value    = userData.aiConfig.apiKey || '';
        document.getElementById('aiModel').value   = userData.aiConfig.model  || '';
        document.getElementById('aiContext').value = userData.aiConfig.context || '';
        document.getElementById('aiPrompt').value  = userData.aiConfig.prompt  || '';
        document.getElementById('aiOrderInstructions').value = userData.aiConfig.orderInstructions || '';

        const mode = userData.aiConfig.promptMode || 'wizard';
        setPromptMode(mode);

        const w = userData.aiConfig.wizardData || {};
        document.getElementById('wBotName').value       = w.botName       || '';
        document.getElementById('wBusinessName').value  = w.businessName  || '';
        document.getElementById('wPersonality').value   = w.personality   || '';
        document.getElementById('wLocation').value      = w.location      || '';
        document.getElementById('wBusinessPhone').value = w.businessPhone || '';
        document.getElementById('wHoursFrom').value     = w.hoursFrom     || '';
        document.getElementById('wHoursTo').value       = w.hoursTo       || '';
        document.getElementById('wCurrency').value      = w.currency      || '';
        document.getElementById('wDoesDelivery').checked   = !!w.doesDelivery;
        document.getElementById('wAskClientPhone').checked = w.askClientPhone !== false;
        document.getElementById('wDeliveryRow').style.display = w.doesDelivery ? 'block' : 'none';
        document.getElementById('wDeliveryData').value  = w.deliveryData  || '';
    };

    // ── Mode tabs ──
    const setPromptMode = (mode) => {
        document.querySelectorAll('.prompt-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
        document.getElementById('panel-wizard').style.display   = mode === 'wizard'   ? 'block' : 'none';
        document.getElementById('panel-advanced').style.display = mode === 'advanced' ? 'block' : 'none';
        userData.aiConfig = { ...userData.aiConfig, promptMode: mode };
        lucide.createIcons();
    };

    document.querySelectorAll('.prompt-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => setPromptMode(tab.dataset.mode));
    });

    // Delivery toggle
    document.getElementById('wDoesDelivery').addEventListener('change', (e) => {
        document.getElementById('wDeliveryRow').style.display = e.target.checked ? 'block' : 'none';
    });

    // Wizard preview
    const getWizardData = () => ({
        botName:      document.getElementById('wBotName').value.trim(),
        businessName: document.getElementById('wBusinessName').value.trim(),
        personality:  document.getElementById('wPersonality').value.trim(),
        location:     document.getElementById('wLocation').value.trim(),
        businessPhone:document.getElementById('wBusinessPhone').value.trim(),
        hoursFrom:    document.getElementById('wHoursFrom').value.trim(),
        hoursTo:      document.getElementById('wHoursTo').value.trim(),
        currency:     document.getElementById('wCurrency').value.trim(),
        doesDelivery: document.getElementById('wDoesDelivery').checked,
        deliveryData: document.getElementById('wDeliveryData').value.trim(),
        askClientPhone: document.getElementById('wAskClientPhone').checked,
    });

    document.getElementById('wizardPreviewBtn').addEventListener('click', () => {
        const w = getWizardData();
        const prompt = buildWizardPrompt(w);
        const wrap = document.getElementById('wizardPreviewWrap');
        document.getElementById('wizardPromptPreview').value = prompt;
        wrap.style.display = 'block';
    });

    // Wizard save
    document.getElementById('wizardForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const w = getWizardData();
        const prompt = document.getElementById('wizardPromptPreview').style.display !== 'none'
            ? document.getElementById('wizardPromptPreview').value
            : buildWizardPrompt(w);
        userData.aiConfig = {
            ...userData.aiConfig,
            promptMode:  'wizard',
            wizardData:  w,
            prompt,
        };
        saveUserData(); showToast('Configuración guardada', 'success');
    });

    // Form 1: credentials
    document.getElementById('aiCredForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.botMode = document.getElementById('botMode').value;
        userData.aiConfig = {
            ...userData.aiConfig,
            apiKey: document.getElementById('apiKey').value.trim(),
            model:  document.getElementById('aiModel').value.trim(),
        };
        saveUserData(); showToast('Credenciales guardadas', 'success');
    });

    // Form 2: advanced mode save
    document.getElementById('aiPromptForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.aiConfig = {
            ...userData.aiConfig,
            promptMode:        'advanced',
            prompt:            document.getElementById('aiPrompt').value,
            orderInstructions: document.getElementById('aiOrderInstructions').value,
            context:           document.getElementById('aiContext').value,
        };
        saveUserData(); showToast('Personalidad guardada', 'success');
    });

    // ── Manual Rules ──
    const renderRules = () => {
        const list = document.getElementById('rulesList');
        if (!userData.manualRules.length) {
            list.innerHTML = '<p style="color:var(--text-muted);">No tienes reglas manuales aún.</p>'; return;
        }
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

    // ── Conversation Flows ──────────────────────────────────────────────────

    let editingFlowIdx = null;  // null = new flow, number = editing existing
    let editingSteps   = [];    // working copy of steps in the editor

    const renderFlows = () => {
        const list = document.getElementById('flowsList');
        const flows = userData.conversationFlows || [];
        if (!flows.length) {
            list.innerHTML = '<p style="color:var(--text-muted);">No tienes flujos creados aún. Crea uno para diseñar conversaciones ramificadas.</p>';
            return;
        }
        list.innerHTML = '';
        flows.forEach((flow, idx) => {
            const div = document.createElement('div');
            div.className = 'product-card flow-card';
            div.innerHTML = `
                <div class="prod-header" style="flex-wrap:wrap;gap:6px;">
                    <h4 style="font-size:0.95rem;">${flow.name}</h4>
                    <span class="flow-trigger-badge">${flow.trigger}</span>
                </div>
                <p style="color:var(--text-muted);font-size:0.85em;margin:6px 0;">
                    ${flow.steps.length} paso${flow.steps.length !== 1 ? 's' : ''}
                </p>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <button class="btn-secondary" style="padding:7px 14px;font-size:0.82rem;flex:1;"
                        onclick="window.openFlowEditor(${idx})">Editar</button>
                    <button class="btn-danger" style="padding:7px 14px;font-size:0.8rem;"
                        onclick="window.deleteFlow('${flow.id}')">Eliminar</button>
                </div>`;
            list.appendChild(div);
        });
    };

    window.deleteFlow = (id) => {
        if (!confirm('¿Eliminar este flujo? No se puede deshacer.')) return;
        userData.conversationFlows = (userData.conversationFlows || []).filter(f => f.id !== id);
        renderFlows(); saveUserData();
        showToast('Flujo eliminado');
    };

    window.openFlowEditor = (idx = null) => {
        editingFlowIdx = idx;
        const flow = idx !== null ? (userData.conversationFlows || [])[idx] : null;
        editingSteps = flow ? JSON.parse(JSON.stringify(flow.steps)) : [];

        document.getElementById('flowName').value    = flow?.name    || '';
        document.getElementById('flowTrigger').value = flow?.trigger || '';
        document.getElementById('flowModalTitle').textContent = idx !== null ? 'Editar Flujo' : 'Nuevo Flujo';
        renderFlowEditor();
        document.getElementById('flowModal').style.display = 'flex';
    };

    document.getElementById('newFlowBtn').addEventListener('click', () => window.openFlowEditor(null));

    // Render the steps inside the flow editor modal
    const renderFlowEditor = () => {
        const container = document.getElementById('flowStepsContainer');
        container.innerHTML = '';

        if (!editingSteps.length) {
            container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px 0;font-size:0.9rem;">
                Sin pasos aún. Agrega el primero con el botón de abajo.
            </p>`;
            return;
        }

        editingSteps.forEach((step, si) => {
            const card = document.createElement('div');
            card.className = 'flow-step-card';

            const branchesHtml = (step.branches || []).map((b, bi) => `
                <div class="flow-branch">
                    <span class="branch-label">Si dicen</span>
                    <input class="branch-keywords" placeholder="palabras, separadas, por, coma" value="${escHtml(b.keywords || '')}">
                    <span class="branch-arrow">→ ir al paso</span>
                    <input class="branch-next" type="number" min="-1" max="${editingSteps.length - 1}" value="${b.nextStep ?? -1}">
                    <button class="branch-del-btn" onclick="window.deleteBranch(${si},${bi})" title="Eliminar rama">×</button>
                </div>
            `).join('');

            card.innerHTML = `
                <div class="step-card-header">
                    <span class="step-index-label">Paso ${si}</span>
                    <button class="step-del-btn" onclick="window.deleteStep(${si})">× Eliminar paso</button>
                </div>
                <div class="input-group" style="margin-bottom:10px;">
                    <label style="font-size:0.78rem;">Mensaje del bot</label>
                    <textarea class="step-message" rows="3" placeholder="Escribe lo que dirá el bot en este paso...">${escHtml(step.message || '')}</textarea>
                </div>
                <div class="branches-section">
                    <div class="branches-label">Ramas <span style="color:var(--text-muted);font-size:0.78rem;">(según lo que responda el usuario)</span></div>
                    <div class="branches-list">${branchesHtml}</div>
                    <button class="add-branch-btn" onclick="window.addBranch(${si})">+ Agregar rama</button>
                </div>
                <div class="step-default-row">
                    <label>Si ninguna rama coincide → ir al paso:</label>
                    <input type="number" class="default-next-input" min="-1" max="${editingSteps.length - 1}" value="${step.defaultNext ?? -1}">
                    <span class="default-hint">(-1 = terminar flujo)</span>
                </div>
            `;
            container.appendChild(card);
        });
    };

    const escHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // Collect current form values into editingSteps before any mutation
    const collectEditorState = () => {
        document.querySelectorAll('.flow-step-card').forEach((card, si) => {
            if (!editingSteps[si]) return;
            editingSteps[si].message     = card.querySelector('.step-message')?.value || '';
            editingSteps[si].defaultNext = parseInt(card.querySelector('.default-next-input')?.value ?? '-1');
            card.querySelectorAll('.flow-branch').forEach((branchEl, bi) => {
                if (!editingSteps[si].branches[bi]) return;
                editingSteps[si].branches[bi].keywords  = branchEl.querySelector('.branch-keywords')?.value || '';
                editingSteps[si].branches[bi].nextStep  = parseInt(branchEl.querySelector('.branch-next')?.value ?? '-1');
            });
        });
    };

    window.addFlowStep = () => {
        collectEditorState();
        editingSteps.push({ message: '', branches: [], defaultNext: -1 });
        renderFlowEditor();
    };

    window.deleteStep = (si) => {
        collectEditorState();
        editingSteps.splice(si, 1);
        // Fix references: decrement indices that pointed to si+, remove refs to si
        editingSteps.forEach(step => {
            step.branches.forEach(b => {
                if (b.nextStep === si)       b.nextStep = -1;
                else if (b.nextStep > si)    b.nextStep -= 1;
            });
            if (step.defaultNext === si)     step.defaultNext = -1;
            else if (step.defaultNext > si)  step.defaultNext -= 1;
        });
        renderFlowEditor();
    };

    window.addBranch = (si) => {
        collectEditorState();
        editingSteps[si].branches.push({ keywords: '', nextStep: -1 });
        renderFlowEditor();
    };

    window.deleteBranch = (si, bi) => {
        collectEditorState();
        editingSteps[si].branches.splice(bi, 1);
        renderFlowEditor();
    };

    document.getElementById('addStepBtn').addEventListener('click', window.addFlowStep);

    document.getElementById('saveFlowBtn').addEventListener('click', () => {
        collectEditorState();
        const name    = document.getElementById('flowName').value.trim();
        const trigger = document.getElementById('flowTrigger').value.trim();
        if (!name)    { alert('El flujo necesita un nombre.'); return; }
        if (!trigger) { alert('El flujo necesita una palabra de activación.'); return; }

        if (!userData.conversationFlows) userData.conversationFlows = [];

        if (editingFlowIdx !== null) {
            userData.conversationFlows[editingFlowIdx] = {
                ...userData.conversationFlows[editingFlowIdx],
                name, trigger, steps: editingSteps
            };
        } else {
            userData.conversationFlows.push({
                id: 'flow_' + Date.now(),
                name, trigger, steps: editingSteps
            });
        }

        document.getElementById('flowModal').style.display = 'none';
        renderFlows(); saveUserData();
        showToast('Flujo guardado', 'success');
    });

    document.getElementById('closeFlowModal').addEventListener('click', () => {
        document.getElementById('flowModal').style.display = 'none';
    });

    // ── WhatsApp Multi-Device ──────────────────────────────────────────────

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
            if (res.ok) { const data = await res.json(); renderDevices(data.sessions || []); }
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

    addDeviceBtn.addEventListener('click', () => {
        addDeviceCard.style.display = 'block';
        addDeviceBtn.disabled = true;
        lucide.createIcons();
        resetQRPanel(); resetPhonePanel();
    });

    document.getElementById('closeAddDevice').addEventListener('click', () => {
        addDeviceCard.style.display = 'none';
        addDeviceBtn.disabled = false;
        clearAllPolling();
    });

    document.querySelectorAll('.connect-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.connect-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.connect-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.panel).classList.add('active');
        });
    });

    // ── QR Method ──
    let qrPollInterval = null, qrCountdownInterval = null, qrRendered = false, activeQRSessionId = null;
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
        addDeviceCard.style.display = 'none'; addDeviceBtn.disabled = false;
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
            const res  = await fetch(`/api/qr/${userId}/${activeQRSessionId}`);
            const data = await res.json();
            const qrContainer = document.getElementById('qrcode');
            if (data.connected || data.status === 'connected') { onQRConnected(); return; }
            if (data.status === 'timeout') {
                clearInterval(qrPollInterval); clearInterval(qrCountdownInterval);
                document.getElementById('qrWrapper').style.display = 'none';
                document.getElementById('qrTimeoutMsg').style.display = 'block'; return;
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
            const res  = await fetch('/api/init-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
            const data = await res.json();
            activeQRSessionId = data.sessionId;
            btn.style.display = 'none';
            clearInterval(qrPollInterval);
            checkQR();
            qrPollInterval = setInterval(checkQR, 2000);
            setTimeout(() => clearInterval(qrPollInterval), QR_TIMEOUT_MS + 5000);
        } catch { btn.disabled = false; btn.textContent = 'Generar Código QR'; }
    });

    document.getElementById('retryQrBtn').addEventListener('click', resetQRPanel);

    // ── Phone Number Method ──
    let phonePollInterval = null, phoneCountdown = null, activePhoneSessionId = null;
    const PHONE_TIMEOUT_MS = 160000;

    const resetPhonePanel = () => {
        clearInterval(phonePollInterval); clearInterval(phoneCountdown);
        activePhoneSessionId = null;
        document.getElementById('pairingCodeDisplay').style.display = 'none';
        document.getElementById('phoneTimeoutMsg').style.display   = 'none';
        document.getElementById('pairingError').style.display      = 'none';
        document.getElementById('phoneNumber').value = '';
        document.getElementById('countryCode').selectedIndex = 0;
        const btn = document.getElementById('requestCodeBtn');
        btn.disabled = false; btn.textContent = 'Obtener Código';
    };

    const onPhoneConnected = () => {
        clearInterval(phonePollInterval); clearInterval(phoneCountdown);
        addDeviceCard.style.display = 'none'; addDeviceBtn.disabled = false;
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
            const res  = await fetch(`/api/qr/${userId}/${activePhoneSessionId}`);
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
        const btn         = document.getElementById('requestCodeBtn');
        const countryCode = document.getElementById('countryCode').value;
        const localNumber = document.getElementById('phoneNumber').value.replace(/\D/g, '');
        const phone       = countryCode + localNumber;
        const errorEl     = document.getElementById('pairingError');

        if (!localNumber || localNumber.length < 5) {
            errorEl.textContent = 'Ingresa un número de teléfono válido (sin código de país).';
            errorEl.style.display = 'block'; return;
        }

        errorEl.style.display = 'none';
        document.getElementById('pairingCodeDisplay').style.display = 'none';
        document.getElementById('phoneTimeoutMsg').style.display    = 'none';
        btn.disabled = true; btn.textContent = 'Solicitando...';

        try {
            const res  = await fetch('/api/request-pairing-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, phoneNumber: phone }) });
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

    // ── Orders ──────────────────────────────────────────────────────────────
    let allOrders = [];

    const STATUS_LABELS = {
        pending:   { label: 'Pendiente',  cls: 'status-pending' },
        confirmed: { label: 'Confirmado', cls: 'status-confirmed' },
        delivered: { label: 'Entregado',  cls: 'status-delivered' },
        cancelled: { label: 'Cancelado',  cls: 'status-cancelled' },
    };

    const formatOrderDate = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    };

    const renderOrders = () => {
        const list   = document.getElementById('ordersList');
        const filter = document.getElementById('orderStatusFilter').value;
        const orders = filter ? allOrders.filter(o => o.status === filter) : allOrders;

        if (!orders.length) {
            list.innerHTML = `<div class="orders-empty">
                <i data-lucide="inbox" style="width:40px;height:40px;stroke-width:1.5;color:var(--text-muted);margin-bottom:12px;"></i>
                <p>No hay pedidos aún.</p>
                <p style="font-size:0.82rem;color:var(--text-muted);margin-top:6px;">Los pedidos que detecte la IA aparecerán aquí automáticamente.</p>
            </div>`;
            lucide.createIcons();
            return;
        }

        list.innerHTML = '';
        orders.forEach(order => {
            const st    = STATUS_LABELS[order.status] || STATUS_LABELS.pending;
            const items = (order.items || []).map(i =>
                `<span class="order-item-tag">${i.quantity ? i.quantity + 'x ' : ''}${i.name}${i.price ? ' ($' + i.price + ')' : ''}</span>`
            ).join('');

            const card = document.createElement('div');
            card.className = 'order-card glassmorphism';
            card.innerHTML = `
                <div class="order-card-header">
                    <div class="order-phone-block">
                        <i data-lucide="message-circle" style="width:15px;height:15px;flex-shrink:0;"></i>
                        <span class="order-phone">${order.phone || '—'}</span>
                        ${order.customerName ? `<span class="order-name">${order.customerName}</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                        <span class="order-status-badge ${st.cls}">${st.label}</span>
                        <span class="order-time">${formatOrderDate(order.timestamp)}</span>
                    </div>
                </div>

                ${items ? `<div class="order-items">${items}</div>` : ''}

                <div class="order-details-grid">
                    ${order.address       ? `<div class="order-detail"><i data-lucide="map-pin" style="width:13px;height:13px;"></i><span>${order.address}</span></div>` : ''}
                    ${order.paymentMethod ? `<div class="order-detail"><i data-lucide="credit-card" style="width:13px;height:13px;"></i><span>${order.paymentMethod}</span></div>` : ''}
                    ${order.total         ? `<div class="order-detail"><i data-lucide="dollar-sign" style="width:13px;height:13px;"></i><span>Total: <strong>${order.total}</strong></span></div>` : ''}
                    ${order.notes         ? `<div class="order-detail" style="grid-column:1/-1;"><i data-lucide="file-text" style="width:13px;height:13px;"></i><span>${order.notes}</span></div>` : ''}
                </div>

                <div class="order-actions">
                    <select class="order-status-select" data-id="${order.id}">
                        <option value="pending"   ${order.status==='pending'   ? 'selected':''}>Pendiente</option>
                        <option value="confirmed" ${order.status==='confirmed' ? 'selected':''}>Confirmado</option>
                        <option value="delivered" ${order.status==='delivered' ? 'selected':''}>Entregado</option>
                        <option value="cancelled" ${order.status==='cancelled' ? 'selected':''}>Cancelado</option>
                    </select>
                    <button class="btn-danger order-delete-btn" data-id="${order.id}" style="width:auto;padding:7px 14px;font-size:0.8rem;">Eliminar</button>
                </div>
            `;
            list.appendChild(card);
        });

        lucide.createIcons();

        list.querySelectorAll('.order-status-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                await fetch(`/api/orders/${userId}/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: sel.value })
                });
                const order = allOrders.find(o => o.id === id);
                if (order) order.status = sel.value;
                renderOrders();
                showToast('Estado actualizado', 'success');
            });
        });

        list.querySelectorAll('.order-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('¿Eliminar este pedido?')) return;
                const id = btn.dataset.id;
                await fetch(`/api/orders/${userId}/${id}`, { method: 'DELETE' });
                allOrders = allOrders.filter(o => o.id !== id);
                renderOrders();
                showToast('Pedido eliminado');
            });
        });
    };

    const fetchOrders = async () => {
        try {
            const res = await fetch(`/api/orders/${userId}`);
            if (res.ok) {
                const data = await res.json();
                allOrders = data.orders || [];
                renderOrders();
            }
        } catch (e) { console.error(e); }
    };

    document.getElementById('orderStatusFilter').addEventListener('change', renderOrders);
    document.getElementById('refreshOrdersBtn').addEventListener('click', () => {
        fetchOrders();
        showToast('Actualizando pedidos...');
    });

    // Auto-refresh orders every 30s when on orders view
    setInterval(() => {
        const ordersSection = document.getElementById('view-orders');
        if (ordersSection && ordersSection.classList.contains('active')) fetchOrders();
    }, 30000);

    // ── Init ──
    fetchUserData();
    fetchDevices();
    fetchOrders();
});
