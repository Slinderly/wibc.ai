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
        if (viewName === 'profile') loadProfile();
        if (viewName === 'flows') renderFlows();
        if (viewName === 'orders') fetchOrders();
        if (viewName === 'chats') {
            loadChatContacts();
            // On mobile: show contacts panel, hide chat window
            document.getElementById('chatContactsPanel').classList.remove('chat-hidden');
            document.getElementById('chatWindowPanel').classList.add('chat-hidden');
        }
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
                renderProducts(); renderConfigForm(); renderFlows();
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
                <div class="prod-header"><h3>${p.name}</h3><span class="prod-price">${p.price}</span></div>
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
        const langLine = w.defaultLanguage
            ? `Responde SIEMPRE en ${w.defaultLanguage}, sin importar en qué idioma te escriba el cliente.`
            : `Responde siempre en el idioma en que te escriba el cliente.`;
        let p = `Eres ${botName}, el asistente virtual de ${bizName}. Tu personalidad es ${persona}. Tu objetivo es atender a los clientes, presentar los productos disponibles y tomar pedidos de forma clara y ordenada. ${langLine}\n\n`;
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
        if (w.acceptsReturns) {
            const deadline = w.returnDeadline ? ` dentro de ${w.returnDeadline}` : '';
            const contact  = w.cancelContact  ? ` a través de: ${w.cancelContact}` : ' contactando al negocio directamente';
            p += `\nAceptamos cancelaciones de pedido${deadline}. IMPORTANTE: Si un cliente quiere cancelar, SIEMPRE debes pedirle que confirme explícitamente con "Sí, confirmo la cancelación" antes de proceder, ya que las cancelaciones no son inmediatas y requieren verificación. Una vez confirmado, indícale que se comunique${contact} para completar el proceso.`;
        } else {
            p += `\nNo aceptamos cancelaciones de pedido una vez confirmado. Si el cliente lo solicita, explícalo con amabilidad.`;
        }
        if (w.responseLength === 'short') {
            p += `\nResponde siempre de forma breve y directa, en pocas líneas. Evita mensajes largos.`;
        } else if (w.responseLength === 'long') {
            p += `\nResponde de forma completa y detallada, explicando bien cada punto para que el cliente quede bien informado.`;
        }
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
        document.getElementById('wDoesDelivery').checked    = !!w.doesDelivery;
        document.getElementById('wAskClientPhone').checked  = w.askClientPhone !== false;
        document.getElementById('wAcceptsReturns').checked  = !!w.acceptsReturns;
        document.getElementById('wDeliveryRow').style.display = w.doesDelivery ? 'block' : 'none';
        document.getElementById('wReturnsRow').style.display  = w.acceptsReturns ? 'block' : 'none';
        document.getElementById('wDeliveryData').value    = w.deliveryData    || '';
        document.getElementById('wReturnDeadline').value  = w.returnDeadline  || '';
        document.getElementById('wCancelContact').value   = w.cancelContact   || '';
        document.getElementById('wDefaultLanguage').value = w.defaultLanguage || '';
        document.getElementById('wResponseLength').value  = w.responseLength  || 'medium';
    };

    const setPromptMode = (mode) => {
        document.querySelectorAll('.prompt-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
        document.getElementById('panel-wizard').style.display   = mode === 'wizard'   ? 'block' : 'none';
        document.getElementById('panel-advanced').style.display = mode === 'advanced' ? 'block' : 'none';
        userData.aiConfig = { ...userData.aiConfig, promptMode: mode };
        lucide.createIcons();
    };

    document.querySelectorAll('.prompt-mode-tab').forEach(tab =>
        tab.addEventListener('click', () => setPromptMode(tab.dataset.mode)));

    document.getElementById('wDoesDelivery').addEventListener('change', (e) => {
        document.getElementById('wDeliveryRow').style.display = e.target.checked ? 'block' : 'none';
    });

    document.getElementById('wAcceptsReturns').addEventListener('change', (e) => {
        document.getElementById('wReturnsRow').style.display = e.target.checked ? 'block' : 'none';
    });

    const getWizardData = () => ({
        botName:        document.getElementById('wBotName').value.trim(),
        businessName:   document.getElementById('wBusinessName').value.trim(),
        personality:    document.getElementById('wPersonality').value.trim(),
        location:       document.getElementById('wLocation').value.trim(),
        businessPhone:  document.getElementById('wBusinessPhone').value.trim(),
        hoursFrom:      document.getElementById('wHoursFrom').value.trim(),
        hoursTo:        document.getElementById('wHoursTo').value.trim(),
        currency:       document.getElementById('wCurrency').value.trim(),
        doesDelivery:   document.getElementById('wDoesDelivery').checked,
        deliveryData:   document.getElementById('wDeliveryData').value.trim(),
        askClientPhone: document.getElementById('wAskClientPhone').checked,
        acceptsReturns:  document.getElementById('wAcceptsReturns').checked,
        returnDeadline:  document.getElementById('wReturnDeadline').value.trim(),
        cancelContact:   document.getElementById('wCancelContact').value.trim(),
        defaultLanguage: document.getElementById('wDefaultLanguage').value,
        responseLength:  document.getElementById('wResponseLength').value,
    });

    document.getElementById('wizardPreviewBtn').addEventListener('click', () => {
        const prompt = buildWizardPrompt(getWizardData());
        document.getElementById('wizardPromptPreview').value = prompt;
        document.getElementById('wizardPreviewWrap').style.display = 'block';
    });

    document.getElementById('wizardForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const w = getWizardData();
        const prompt = document.getElementById('wizardPreviewWrap').style.display !== 'none'
            ? document.getElementById('wizardPromptPreview').value
            : buildWizardPrompt(w);
        userData.aiConfig = { ...userData.aiConfig, promptMode: 'wizard', wizardData: w, prompt };
        saveUserData(); showToast('Configuración guardada', 'success');
    });

    document.getElementById('aiCredForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.botMode = document.getElementById('botMode').value;
        userData.aiConfig = { ...userData.aiConfig,
            apiKey: document.getElementById('apiKey').value.trim(),
            model:  document.getElementById('aiModel').value.trim(),
        };
        saveUserData(); showToast('Credenciales guardadas', 'success');
    });

    document.getElementById('aiPromptForm').addEventListener('submit', (e) => {
        e.preventDefault();
        userData.aiConfig = { ...userData.aiConfig,
            promptMode:        'advanced',
            prompt:            document.getElementById('aiPrompt').value,
            orderInstructions: document.getElementById('aiOrderInstructions').value,
            context:           document.getElementById('aiContext').value,
        };
        saveUserData(); showToast('Personalidad guardada', 'success');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ── Flows ────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    const STEP_TYPES = {
        message:      { label: '💬 Mensaje',           hint: 'El bot envía un texto. Puedes agregar ramas para ramificar según la respuesta.' },
        show_products:{ label: '🛍️ Mostrar Productos',  hint: 'El bot muestra el catálogo de productos registrados.' },
        collect_data: { label: '📝 Recolectar Dato',    hint: 'El bot hace una pregunta y guarda la respuesta del cliente.' },
        options:      { label: '📋 Menú de Opciones',   hint: 'El bot muestra un menú numerado y va al paso según la elección.' },
        save_order:   { label: '✅ Guardar Pedido',     hint: 'Registra un pedido con todos los datos recolectados en el flujo.' },
    };

    const COLLECT_FIELDS = [
        { value: 'name',    label: 'Nombre del cliente' },
        { value: 'phone',   label: 'Teléfono del cliente' },
        { value: 'address', label: 'Dirección de entrega' },
        { value: 'items',   label: 'Productos / lo que quiere pedir' },
        { value: 'payment', label: 'Método de pago' },
        { value: 'total',   label: 'Total / monto acordado' },
        { value: 'notes',   label: 'Notas adicionales' },
    ];

    let editingFlowIdx = null;
    let editingSteps   = [];

    const TRIGGER_TYPE_LABELS = {
        any_first_message: '🔔 Primer mensaje',
        keyword: '🔤 Palabra clave',
    };

    const renderFlows = () => {
        const list = document.getElementById('flowsList');
        const flows = userData.conversationFlows || [];
        if (!flows.length) {
            list.innerHTML = `
                <div class="flow-empty-state">
                    <i data-lucide="git-branch" style="width:44px;height:44px;opacity:0.2;margin-bottom:14px;"></i>
                    <p style="font-weight:600;margin-bottom:6px;">No tienes flujos aún</p>
                    <p style="color:var(--text-muted);font-size:0.85rem;">Crea tu primer flujo para automatizar conversaciones.</p>
                </div>`;
            lucide.createIcons();
            return;
        }
        list.innerHTML = '';
        flows.forEach((flow, idx) => {
            const triggerLabel = flow.triggerType === 'any_first_message'
                ? '🔔 Primer mensaje'
                : `🔤 "${flow.trigger || ''}"`;
            const stepSummary = (flow.steps || []).map(s => STEP_TYPES[s.type || 'message']?.label || '💬').join(' → ');
            const div = document.createElement('div');
            div.className = 'product-card flow-card';
            div.innerHTML = `
                <div class="prod-header" style="flex-wrap:wrap;gap:6px;">
                    <h4 style="font-size:0.95rem;">${flow.name}</h4>
                    <span class="flow-trigger-badge">${triggerLabel}</span>
                </div>
                <p style="color:var(--text-muted);font-size:0.8em;margin:4px 0 2px;line-height:1.5;">${stepSummary || 'Sin pasos'}</p>
                <p style="color:var(--text-muted);font-size:0.8em;">${(flow.steps || []).length} paso${(flow.steps || []).length !== 1 ? 's' : ''}</p>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button class="btn-secondary" style="padding:7px 14px;font-size:0.82rem;flex:1;"
                        onclick="window.openFlowEditor(${idx})">Editar</button>
                    <button class="btn-danger" style="padding:7px 14px;font-size:0.8rem;"
                        onclick="window.deleteFlow('${flow.id}')">Eliminar</button>
                </div>`;
            list.appendChild(div);
        });
        lucide.createIcons();
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
        editingSteps = flow ? JSON.parse(JSON.stringify(flow.steps || [])) : [];

        document.getElementById('flowName').value = flow?.name || '';
        const trigType = flow?.triggerType || 'any_first_message';
        document.getElementById('flowTriggerType').value = trigType;
        document.getElementById('flowTrigger').value = flow?.trigger || '';
        document.getElementById('flowTriggerKeywordRow').style.display = trigType === 'keyword' ? 'block' : 'none';
        document.getElementById('flowModalTitle').textContent = idx !== null ? 'Editar Flujo' : 'Nuevo Flujo';
        renderFlowEditor();
        document.getElementById('flowModal').style.display = 'flex';
    };

    document.getElementById('flowTriggerType').addEventListener('change', (e) => {
        document.getElementById('flowTriggerKeywordRow').style.display =
            e.target.value === 'keyword' ? 'block' : 'none';
    });

    document.getElementById('newFlowBtn').addEventListener('click', () => window.openFlowEditor(null));

    // ── Flow Editor ──────────────────────────────────────────────────────────

    const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const collectEditorState = () => {
        document.querySelectorAll('.flow-step-card').forEach((card, si) => {
            if (!editingSteps[si]) return;
            const type = editingSteps[si].type || 'message';

            editingSteps[si].message = card.querySelector('.step-message')?.value ?? '';

            if (type === 'collect_data') {
                editingSteps[si].field = card.querySelector('.step-field-select')?.value || 'name';
            }

            if (type === 'options') {
                const optRows = card.querySelectorAll('.option-row');
                editingSteps[si].options = Array.from(optRows).map(row => ({
                    label: row.querySelector('.option-label-input')?.value || '',
                    nextStep: parseInt(row.querySelector('.option-next-input')?.value ?? '-1'),
                }));
            }

            if (type === 'message') {
                card.querySelectorAll('.flow-branch').forEach((branchEl, bi) => {
                    if (!editingSteps[si].branches) editingSteps[si].branches = [];
                    if (!editingSteps[si].branches[bi]) return;
                    editingSteps[si].branches[bi].keywords = branchEl.querySelector('.branch-keywords')?.value || '';
                    editingSteps[si].branches[bi].nextStep = parseInt(branchEl.querySelector('.branch-next')?.value ?? '-1');
                });
            }

            const defaultNextEl = card.querySelector('.default-next-input');
            if (defaultNextEl) editingSteps[si].defaultNext = parseInt(defaultNextEl.value ?? '-1');
        });
    };

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
            const type = step.type || 'message';
            const card = document.createElement('div');
            card.className = 'flow-step-card';

            // ── Type selector ──
            const typeOptions = Object.entries(STEP_TYPES).map(([v, d]) =>
                `<option value="${v}" ${v === type ? 'selected' : ''}>${d.label}</option>`).join('');

            // ── Message field (used by message, show_products, collect_data, save_order) ──
            const showMsgField = ['message','show_products','collect_data','save_order'].includes(type);
            const msgPlaceholders = {
                message:       'Escribe lo que dirá el bot...',
                show_products: 'Texto introductorio antes de los productos (opcional)',
                collect_data:  '¿Cuál es tu pregunta? Ej: ¿Cuál es tu nombre completo?',
                save_order:    'Mensaje de confirmación. Ej: ✅ ¡Pedido registrado! Te contactamos pronto.',
            };
            const msgField = showMsgField ? `
                <div class="input-group" style="margin-bottom:10px;">
                    <label style="font-size:0.78rem;">${type === 'collect_data' ? 'Pregunta al cliente' : type === 'save_order' ? 'Mensaje de confirmación' : 'Mensaje del bot'}</label>
                    <textarea class="step-message" rows="3" placeholder="${msgPlaceholders[type] || ''}">${escHtml(step.message || '')}</textarea>
                </div>` : '';

            // ── Collect data: field selector ──
            const fieldOptions = COLLECT_FIELDS.map(f =>
                `<option value="${f.value}" ${f.value === (step.field || 'name') ? 'selected' : ''}>${f.label}</option>`).join('');
            const collectSection = type === 'collect_data' ? `
                <div class="input-group" style="margin-bottom:10px;">
                    <label style="font-size:0.78rem;">Dato a recolectar</label>
                    <select class="step-field-select">${fieldOptions}</select>
                    <span style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">La respuesta del cliente se guardará con este nombre para usarla en "Guardar Pedido".</span>
                </div>` : '';

            // ── Options list ──
            const optionsSection = type === 'options' ? (() => {
                const opts = (step.options || [{ label: '', nextStep: -1 }]);
                const optRows = opts.map((o, oi) => `
                    <div class="option-row">
                        <span class="option-num">${oi + 1}.</span>
                        <input class="option-label-input" placeholder="Texto de la opción" value="${escHtml(o.label || '')}">
                        <span class="option-arrow">→ paso</span>
                        <input class="option-next-input" type="number" min="-1" max="${editingSteps.length - 1}" value="${o.nextStep ?? -1}">
                        <button class="branch-del-btn" onclick="window.deleteOption(${si},${oi})" title="Eliminar opción">×</button>
                    </div>`).join('');
                return `
                    <div class="options-section">
                        <div class="branches-label">Opciones del menú <span style="color:var(--text-muted);font-size:0.78rem;">(el cliente elige por número)</span></div>
                        <div class="options-list">${optRows}</div>
                        <button class="add-branch-btn" onclick="window.addOption(${si})" style="margin-top:6px;">+ Agregar opción</button>
                    </div>`;
            })() : '';

            // ── Branches (only for message type) ──
            const branchesSection = type === 'message' ? (() => {
                const branches = step.branches || [];
                const branchesHtml = branches.map((b, bi) => `
                    <div class="flow-branch">
                        <span class="branch-label">Si dicen</span>
                        <input class="branch-keywords" placeholder="palabras, separadas, por, coma" value="${escHtml(b.keywords || '')}">
                        <span class="branch-arrow">→ ir al paso</span>
                        <input class="branch-next" type="number" min="-1" max="${editingSteps.length - 1}" value="${b.nextStep ?? -1}">
                        <button class="branch-del-btn" onclick="window.deleteBranch(${si},${bi})" title="Eliminar rama">×</button>
                    </div>`).join('');
                return `
                    <div class="branches-section">
                        <div class="branches-label">Ramas <span style="color:var(--text-muted);font-size:0.78rem;">(respuestas que redirigen a otro paso)</span></div>
                        <div class="branches-list">${branchesHtml}</div>
                        <button class="add-branch-btn" onclick="window.addBranch(${si})">+ Agregar rama</button>
                    </div>`;
            })() : '';

            // ── Default next ──
            const showDefaultNext = type !== 'save_order';
            const defaultNextSection = showDefaultNext ? `
                <div class="step-default-row">
                    <label>${type === 'collect_data' ? 'Ir al paso después de recolectar:' : type === 'options' ? 'Si no reconoce la opción → ir al paso:' : 'Si ninguna rama coincide → ir al paso:'}</label>
                    <input type="number" class="default-next-input" min="-1" max="${editingSteps.length - 1}" value="${typeof step.defaultNext === 'number' ? step.defaultNext : -1}">
                    <span class="default-hint">(-1 = terminar flujo)</span>
                </div>` : '';

            // ── Type hint ──
            const typeHint = STEP_TYPES[type]?.hint
                ? `<div class="step-type-hint">${STEP_TYPES[type].hint}</div>` : '';

            card.innerHTML = `
                <div class="step-card-header">
                    <span class="step-index-label">Paso ${si}</span>
                    <select class="step-type-select" onchange="window.changeStepType(${si}, this.value)">${typeOptions}</select>
                    <button class="step-del-btn" onclick="window.deleteStep(${si})">× Eliminar</button>
                </div>
                ${typeHint}
                ${msgField}
                ${collectSection}
                ${optionsSection}
                ${branchesSection}
                ${defaultNextSection}
            `;
            container.appendChild(card);
        });

        lucide.createIcons();
    };

    // ── Step mutations ──

    window.changeStepType = (si, newType) => {
        collectEditorState();
        editingSteps[si] = {
            type: newType,
            message: editingSteps[si].message || '',
            defaultNext: editingSteps[si].defaultNext ?? -1,
            branches: [],
            options: newType === 'options' ? [{ label: '', nextStep: -1 }] : [],
            field: newType === 'collect_data' ? (editingSteps[si].field || 'name') : undefined,
        };
        renderFlowEditor();
    };

    window.addFlowStep = () => {
        collectEditorState();
        editingSteps.push({ type: 'message', message: '', branches: [], options: [], defaultNext: -1 });
        renderFlowEditor();
    };

    window.deleteStep = (si) => {
        collectEditorState();
        editingSteps.splice(si, 1);
        editingSteps.forEach(step => {
            if (step.branches) step.branches.forEach(b => {
                if (b.nextStep === si) b.nextStep = -1;
                else if (b.nextStep > si) b.nextStep -= 1;
            });
            if (step.options) step.options.forEach(o => {
                if (o.nextStep === si) o.nextStep = -1;
                else if (o.nextStep > si) o.nextStep -= 1;
            });
            if (step.defaultNext === si) step.defaultNext = -1;
            else if (typeof step.defaultNext === 'number' && step.defaultNext > si) step.defaultNext -= 1;
        });
        renderFlowEditor();
    };

    window.addBranch = (si) => {
        collectEditorState();
        if (!editingSteps[si].branches) editingSteps[si].branches = [];
        editingSteps[si].branches.push({ keywords: '', nextStep: -1 });
        renderFlowEditor();
    };

    window.deleteBranch = (si, bi) => {
        collectEditorState();
        editingSteps[si].branches.splice(bi, 1);
        renderFlowEditor();
    };

    window.addOption = (si) => {
        collectEditorState();
        if (!editingSteps[si].options) editingSteps[si].options = [];
        editingSteps[si].options.push({ label: '', nextStep: -1 });
        renderFlowEditor();
    };

    window.deleteOption = (si, oi) => {
        collectEditorState();
        editingSteps[si].options.splice(oi, 1);
        renderFlowEditor();
    };

    document.getElementById('addStepBtn').addEventListener('click', window.addFlowStep);

    document.getElementById('saveFlowBtn').addEventListener('click', () => {
        collectEditorState();
        const name     = document.getElementById('flowName').value.trim();
        const trigType = document.getElementById('flowTriggerType').value;
        const trigger  = document.getElementById('flowTrigger').value.trim();

        if (!name) { alert('El flujo necesita un nombre.'); return; }
        if (trigType === 'keyword' && !trigger) { alert('Ingresa una palabra de activación.'); return; }

        if (!userData.conversationFlows) userData.conversationFlows = [];

        const flowData = { name, triggerType: trigType, trigger: trigType === 'keyword' ? trigger : '', steps: editingSteps };

        if (editingFlowIdx !== null) {
            userData.conversationFlows[editingFlowIdx] = {
                ...userData.conversationFlows[editingFlowIdx], ...flowData
            };
        } else {
            userData.conversationFlows.push({ id: 'flow_' + Date.now(), ...flowData });
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
                <button class="btn-danger" style="flex-shrink:0;" onclick="window.disconnectDevice('${s.sessionId}')">Desconectar</button>`;
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
        const timerWrap  = document.getElementById('qrTimer');
        const timerBar   = document.getElementById('timerBar');
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
        completed: { label: 'Realizado',  cls: 'status-completed' },
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
                <p style="font-size:0.82rem;color:var(--text-muted);margin-top:6px;">Los pedidos que detecte la IA o los flujos aparecerán aquí.</p>
            </div>`;
            lucide.createIcons();
            return;
        }

        list.innerHTML = '';
        orders.forEach(order => {
            const st    = STATUS_LABELS[order.status] || STATUS_LABELS.pending;
            const items = (order.items || []).map(i =>
                `<span class="order-item-tag">${i.quantity ? i.quantity + 'x ' : ''}${i.name}${i.price ? ' (' + i.price + ')' : ''}</span>`
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
                        <option value="completed" ${order.status==='completed' ? 'selected':''}>Realizado</option>
                        <option value="cancelled" ${order.status==='cancelled' ? 'selected':''}>Cancelado</option>
                    </select>
                    ${order.jid ? `<button class="btn-secondary order-chat-btn" data-jid="${order.jid}" data-phone="${order.phone || ''}" style="width:auto;padding:7px 12px;font-size:0.8rem;display:flex;align-items:center;gap:5px;"><i data-lucide="message-circle" style="width:13px;height:13px;"></i>Chat</button>` : ''}
                    <button class="btn-danger order-delete-btn" data-id="${order.id}" style="width:auto;padding:7px 14px;font-size:0.8rem;">Eliminar</button>
                </div>
            `;
            list.appendChild(card);
        });

        lucide.createIcons();

        list.querySelectorAll('.order-status-select').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const newStatus = sel.value;
                try {
                    const res = await fetch(`/api/orders/${userId}/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus })
                    });
                    if (!res.ok) throw new Error('Error al guardar');
                    const order = allOrders.find(o => o.id === id);
                    if (order) order.status = newStatus;
                    renderOrders();
                    showToast('Estado actualizado', 'success');
                } catch (e) {
                    showToast('Error al actualizar el estado', 'error');
                    renderOrders();
                }
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

        list.querySelectorAll('.order-chat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                window.openChatFromOrder(btn.dataset.jid, btn.dataset.phone);
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

    setInterval(() => {
        const ordersSection = document.getElementById('view-orders');
        if (ordersSection && ordersSection.classList.contains('active')) fetchOrders();
    }, 30000);

    // ── Profile ──────────────────────────────────────────────────────────────

    const loadProfile = async () => {
        try {
            const res = await fetch(`/api/profile/${userId}`);
            if (res.ok) {
                const data = await res.json();
                const uname = data.username || 'Usuario';
                document.getElementById('profileUsernameDisplay').textContent = uname;
                document.getElementById('profileIdDisplay').textContent = `ID: ${data.id || userId}`;
                document.getElementById('profileAvatarCircle').textContent = uname.charAt(0).toUpperCase();
            }
        } catch (e) { console.error(e); }
    };

    document.getElementById('changeUsernameForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('usernameMsg');
        const newUsername    = document.getElementById('newUsername').value.trim();
        const currentPassword = document.getElementById('passForUsername').value;
        msgEl.textContent = '';
        msgEl.style.color = '';
        if (!newUsername) { msgEl.textContent = 'Ingresa el nuevo nombre.'; msgEl.style.color = 'var(--danger)'; return; }
        try {
            const res  = await fetch(`/api/profile/${userId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newUsername })
            });
            const data = await res.json();
            if (data.success) {
                msgEl.textContent = '✓ Nombre actualizado correctamente.';
                msgEl.style.color = 'var(--success)';
                document.getElementById('profileUsernameDisplay').textContent = data.username;
                document.getElementById('profileAvatarCircle').textContent = data.username.charAt(0).toUpperCase();
                document.getElementById('changeUsernameForm').reset();
                showToast('Nombre de usuario actualizado', 'success');
            } else {
                msgEl.textContent = data.message || 'Error al actualizar.';
                msgEl.style.color = 'var(--danger)';
            }
        } catch { msgEl.textContent = 'Error de conexión.'; msgEl.style.color = 'var(--danger)'; }
    });

    document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('passwordMsg');
        const currentPass = document.getElementById('currentPass').value;
        const newPass     = document.getElementById('newPass').value;
        const confirmPass = document.getElementById('confirmPass').value;
        msgEl.textContent = '';
        msgEl.style.color = '';
        if (!newPass) { msgEl.textContent = 'Ingresa la nueva contraseña.'; msgEl.style.color = 'var(--danger)'; return; }
        if (newPass !== confirmPass) { msgEl.textContent = 'Las contraseñas no coinciden.'; msgEl.style.color = 'var(--danger)'; return; }
        if (newPass.length < 4) { msgEl.textContent = 'La contraseña debe tener al menos 4 caracteres.'; msgEl.style.color = 'var(--danger)'; return; }
        try {
            const res  = await fetch(`/api/profile/${userId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
            });
            const data = await res.json();
            if (data.success) {
                msgEl.textContent = '✓ Contraseña actualizada correctamente.';
                msgEl.style.color = 'var(--success)';
                document.getElementById('changePasswordForm').reset();
                showToast('Contraseña actualizada', 'success');
            } else {
                msgEl.textContent = data.message || 'Error al actualizar.';
                msgEl.style.color = 'var(--danger)';
            }
        } catch { msgEl.textContent = 'Error de conexión.'; msgEl.style.color = 'var(--danger)'; }
    });

    // ── Chats ────────────────────────────────────────────────────────────────

    let activeChatJid = null;

    const formatChatTime = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    };

    const formatChatFullTime = (iso) => {
        if (!iso) return '';
        return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    };

    const jidToB64 = (jid) => btoa(unescape(encodeURIComponent(jid)));

    const loadChatContacts = async () => {
        try {
            const res = await fetch(`/api/chats/${userId}`);
            if (!res.ok) return;
            const { contacts } = await res.json();
            const list = document.getElementById('chatContactsList');
            if (!contacts || !contacts.length) {
                list.innerHTML = `<div class="chat-contacts-empty">
                    <i data-lucide="message-circle" style="width:32px;height:32px;opacity:0.2;"></i>
                    <p>Sin conversaciones aún</p>
                    <p style="font-size:0.76rem;margin-top:4px;">Las conversaciones con tus clientes aparecerán aquí</p>
                </div>`;
                lucide.createIcons();
                return;
            }
            list.innerHTML = '';
            contacts.forEach(contact => {
                const phone = contact.phone || '+' + contact.jid.split('@')[0];
                const initial = phone.replace(/\D/g, '').slice(-2, -1) || '?';
                const previewPrefix = contact.lastRole === 'bot' ? '🤖 ' : '';
                const preview = contact.lastMessage
                    ? (previewPrefix + contact.lastMessage).slice(0, 45)
                    : '';
                const item = document.createElement('div');
                item.className = 'chat-contact-item' + (activeChatJid === contact.jid ? ' active' : '');
                item.dataset.jid = contact.jid;
                item.innerHTML = `
                    <div class="chat-contact-avatar">${initial}</div>
                    <div class="chat-contact-body">
                        <div class="chat-contact-phone">${phone}</div>
                        ${preview ? `<div class="chat-contact-preview">${preview}</div>` : ''}
                    </div>
                    <div class="chat-contact-time">${formatChatTime(contact.lastTs)}</div>
                `;
                item.addEventListener('click', () => openChatThread(contact.jid, phone));
                list.appendChild(item);
            });
            lucide.createIcons();
        } catch (e) { console.error('[wibc.ai] loadChatContacts:', e); }
    };

    const openChatThread = async (jid, phone) => {
        activeChatJid = jid;
        const phone$ = phone || ('+' + jid.split('@')[0]);
        const initial = phone$.replace(/\D/g, '').slice(-2, -1) || '?';

        document.getElementById('chatThreadPhone').textContent = phone$;
        document.getElementById('chatThreadAvatar').textContent = initial;
        document.getElementById('chatThreadJid').textContent = jid;

        document.getElementById('chatWindowEmpty').style.display = 'none';
        document.getElementById('chatWindowActive').style.display = 'flex';

        document.querySelectorAll('.chat-contact-item').forEach(el =>
            el.classList.toggle('active', el.dataset.jid === jid));

        // Mobile: hide contact list, show chat window
        document.getElementById('chatContactsPanel').classList.add('chat-hidden');
        document.getElementById('chatWindowPanel').classList.remove('chat-hidden');

        document.getElementById('chatMessages').innerHTML =
            '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.82rem;">Cargando mensajes...</div>';

        try {
            const res = await fetch(`/api/chats/${userId}/${jidToB64(jid)}`);
            if (!res.ok) return;
            const { messages } = await res.json();
            renderChatMessages(messages);
        } catch (e) { console.error('[wibc.ai] openChatThread:', e); }

        document.getElementById('chatComposeInput').focus();
        lucide.createIcons();
    };

    const renderChatMessages = (messages) => {
        const container = document.getElementById('chatMessages');
        if (!messages || !messages.length) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.82rem;">Sin mensajes aún</div>';
            return;
        }
        container.innerHTML = '';
        let lastDay = '';
        messages.forEach(msg => {
            const day = msg.ts ? new Date(msg.ts).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
            if (day && day !== lastDay) {
                lastDay = day;
                const label = document.createElement('div');
                label.className = 'chat-day-label';
                label.textContent = day;
                container.appendChild(label);
            }
            const wrap = document.createElement('div');
            wrap.className = 'chat-bubble-wrap ' + (msg.role === 'user' ? 'from-user' : 'from-bot');
            wrap.innerHTML = `
                <div class="chat-bubble">${escHtml(msg.text)}</div>
                <div class="chat-bubble-time">${formatChatFullTime(msg.ts)}</div>
            `;
            container.appendChild(wrap);
        });
        container.scrollTop = container.scrollHeight;
    };

    const sendChatMessage = async () => {
        if (!activeChatJid) return;
        const input = document.getElementById('chatComposeInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.focus();

        const optimistic = document.createElement('div');
        optimistic.className = 'chat-bubble-wrap from-bot';
        optimistic.innerHTML = `
            <div class="chat-bubble">${escHtml(text)}</div>
            <div class="chat-bubble-time">Enviando...</div>
        `;
        const container = document.getElementById('chatMessages');
        container.appendChild(optimistic);
        container.scrollTop = container.scrollHeight;

        try {
            const res = await fetch(`/api/chats/${userId}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jid: activeChatJid, text })
            });
            const data = await res.json();
            if (!data.success) {
                optimistic.querySelector('.chat-bubble-time').textContent = '⚠️ ' + (data.message || 'Error al enviar');
                optimistic.querySelector('.chat-bubble').style.opacity = '0.5';
                showToast(data.message || 'Error al enviar', 'danger');
            } else {
                optimistic.querySelector('.chat-bubble-time').textContent = formatChatFullTime(new Date().toISOString());
            }
        } catch (e) {
            optimistic.querySelector('.chat-bubble-time').textContent = '⚠️ Sin conexión';
            optimistic.querySelector('.chat-bubble').style.opacity = '0.5';
        }
    };

    document.getElementById('chatSendBtn').addEventListener('click', sendChatMessage);
    document.getElementById('chatComposeInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });

    document.getElementById('refreshChatsBtn').addEventListener('click', loadChatContacts);

    document.getElementById('chatBackBtn').addEventListener('click', () => {
        activeChatJid = null;
        document.getElementById('chatContactsPanel').classList.remove('chat-hidden');
        document.getElementById('chatWindowPanel').classList.add('chat-hidden');
        document.getElementById('chatWindowActive').style.display = 'none';
        document.getElementById('chatWindowEmpty').style.display = 'flex';
    });

    // ── Expose openChatFromOrder for Orders ──
    window.openChatFromOrder = (jid, phone) => {
        switchView('chats');
        setTimeout(() => openChatThread(jid, phone), 50);
    };

    // ── Init ──
    fetchUserData();
    fetchDevices();
    fetchOrders();
});
