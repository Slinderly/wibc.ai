document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    const TOKEN_KEY = 'wibc_admin_token';
    let token = localStorage.getItem(TOKEN_KEY) || '';
    let currentPath = '';
    let currentFile = null;
    let pendingDelete = null;

    const api = async (method, endpoint, body, params) => {
        let url = `/admin-api/${endpoint}`;
        if (params) {
            const q = new URLSearchParams(params);
            url += '?' + q.toString();
        }
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { ok: res.ok, status: res.status, data: await res.json() };
    };

    // ── Login ──
    const loginScreen = document.getElementById('loginScreen');
    const adminPanel  = document.getElementById('adminPanel');

    const showPanel = () => {
        loginScreen.style.display = 'none';
        adminPanel.style.display = 'flex';
        lucide.createIcons();
        loadTree('');
    };

    const tryAutoLogin = async () => {
        if (!token) return;
        const r = await api('GET', 'ls', null, { path: '/' });
        if (r.ok) showPanel();
        else { localStorage.removeItem(TOKEN_KEY); token = ''; }
    };

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('adminPass').value;
        const err  = document.getElementById('loginError');
        err.style.display = 'none';

        const r = await fetch('/admin-api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass }),
        });
        const data = await r.json();
        if (r.ok) {
            token = data.token;
            localStorage.setItem(TOKEN_KEY, token);
            showPanel();
        } else {
            err.textContent = data.error || 'Error al iniciar sesión';
            err.style.display = 'block';
        }
    });

    document.getElementById('logoutAdminBtn').addEventListener('click', async () => {
        await api('POST', 'logout');
        localStorage.removeItem(TOKEN_KEY);
        token = '';
        adminPanel.style.display = 'none';
        loginScreen.style.display = 'flex';
    });

    tryAutoLogin();

    // ── Tabs ──
    document.querySelectorAll('.topbar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.topbar-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // ── File Tree ──
    const fileTree    = document.getElementById('fileTree');
    const treePath    = document.getElementById('treePath');
    const editorFilename = document.getElementById('editorFilename');
    const codeEditor  = document.getElementById('codeEditor');
    const editorPH    = document.getElementById('editorPlaceholder');
    const btnSave     = document.getElementById('btnSave');
    const btnDelete   = document.getElementById('btnDelete');
    const btnRename   = document.getElementById('btnRename');
    const editorStatus = document.getElementById('editorStatus');
    const editorSize  = document.getElementById('editorSize');

    // Build tree for given relative path
    const loadTree = async (relPath) => {
        fileTree.innerHTML = '<div class="tree-loading">Cargando...</div>';
        const r = await api('GET', 'ls', null, { path: relPath || '/' });
        if (!r.ok) { fileTree.innerHTML = `<div class="tree-loading">${r.data.error}</div>`; return; }

        const { items, path: serverPath } = r.data;
        currentPath = serverPath;
        treePath.textContent = '/' + (serverPath === '.' ? '' : serverPath);
        fileTree.innerHTML = '';

        // Back button
        if (serverPath && serverPath !== '.') {
            const back = makeTreeItem('..', true, '');
            back.style.color = '#666';
            back.addEventListener('click', () => {
                const parent = serverPath.split('/').slice(0, -1).join('/');
                loadTree(parent);
            });
            fileTree.appendChild(back);
        }

        items.forEach(item => {
            const el = makeTreeItem(item.name, item.isDir, item.path);
            if (item.isDir) {
                el.addEventListener('click', () => loadTree(item.path));
            } else {
                el.addEventListener('click', () => openFile(item.path, item.name, el));
            }
            fileTree.appendChild(el);
        });
        lucide.createIcons();
    };

    const makeTreeItem = (name, isDir, filePath) => {
        const el = document.createElement('div');
        el.className = 'tree-item' + (isDir ? ' is-dir' : '');
        el.dataset.path = filePath;
        el.innerHTML = isDir
            ? `<i data-lucide="folder"></i><span class="tree-item-name">${name}</span>`
            : `<i data-lucide="file-text"></i><span class="tree-item-name">${name}</span>`;
        return el;
    };

    const openFile = async (filePath, name, el) => {
        document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
        el?.classList.add('active');

        const r = await api('GET', 'read', null, { path: filePath });
        if (!r.ok) { alert(r.data.error); return; }

        currentFile = { path: filePath, name };
        codeEditor.value = r.data.content;
        codeEditor.disabled = false;
        editorPH.style.display = 'none';
        editorFilename.textContent = '/' + filePath;
        btnSave.disabled = false;
        btnDelete.disabled = false;
        btnRename.disabled = false;
        editorStatus.textContent = 'Listo';
        editorSize.textContent = `${r.data.content.length} caracteres`;
    };

    // ── Save ──
    btnSave.addEventListener('click', async () => {
        if (!currentFile) return;
        btnSave.disabled = true;
        editorStatus.textContent = 'Guardando...';
        const r = await api('POST', 'write', { path: currentFile.path, content: codeEditor.value });
        btnSave.disabled = false;
        editorStatus.textContent = r.ok ? 'Guardado' : `Error: ${r.data.error}`;
        editorSize.textContent = `${codeEditor.value.length} caracteres`;
    });

    // Ctrl+S save
    codeEditor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            btnSave.click();
        }
    });

    // ── New File ──
    document.getElementById('btnNewFile').addEventListener('click', async () => {
        const name = prompt('Nombre del nuevo archivo:');
        if (!name) return;
        const filePath = currentPath && currentPath !== '.' ? `${currentPath}/${name}` : name;
        const r = await api('POST', 'write', { path: filePath, content: '' });
        if (r.ok) { loadTree(currentPath); }
        else alert(r.data.error);
    });

    // ── New Directory ──
    document.getElementById('btnNewDir').addEventListener('click', async () => {
        const name = prompt('Nombre de la nueva carpeta:');
        if (!name) return;
        const dirPath = currentPath && currentPath !== '.' ? `${currentPath}/${name}` : name;
        const r = await api('POST', 'mkdir', { path: dirPath });
        if (r.ok) loadTree(currentPath);
        else alert(r.data.error);
    });

    // ── Refresh ──
    document.getElementById('btnRefresh').addEventListener('click', () => loadTree(currentPath));

    // ── Delete ──
    const deleteModal = document.getElementById('deleteModal');
    const deleteMsg   = document.getElementById('deleteModalMsg');

    btnDelete.addEventListener('click', () => {
        if (!currentFile) return;
        pendingDelete = currentFile.path;
        deleteMsg.textContent = `¿Eliminar "${currentFile.name}"? Esta acción no se puede deshacer.`;
        deleteModal.style.display = 'flex';
    });

    document.getElementById('deleteConfirm').addEventListener('click', async () => {
        deleteModal.style.display = 'none';
        if (!pendingDelete) return;
        const r = await api('DELETE', 'delete', null, { path: pendingDelete });
        if (r.ok) {
            currentFile = null;
            codeEditor.value = '';
            codeEditor.disabled = true;
            editorPH.style.display = 'flex';
            editorFilename.textContent = '— ningún archivo —';
            btnSave.disabled = true;
            btnDelete.disabled = true;
            btnRename.disabled = true;
            editorStatus.textContent = '';
            loadTree(currentPath);
        } else { alert(r.data.error); }
    });
    document.getElementById('deleteCancel').addEventListener('click', () => { deleteModal.style.display = 'none'; });

    // ── Rename ──
    const renameModal = document.getElementById('renameModal');
    const renameInput = document.getElementById('renameInput');

    btnRename.addEventListener('click', () => {
        if (!currentFile) return;
        renameInput.value = currentFile.name;
        renameModal.style.display = 'flex';
        renameInput.focus();
        renameInput.select();
    });

    document.getElementById('renameConfirm').addEventListener('click', async () => {
        const newName = renameInput.value.trim();
        if (!newName || !currentFile) return;
        renameModal.style.display = 'none';

        const dir = currentFile.path.includes('/') ? currentFile.path.split('/').slice(0, -1).join('/') : '';
        const newPath = dir ? `${dir}/${newName}` : newName;

        const r = await api('POST', 'rename', { from: currentFile.path, to: newPath });
        if (r.ok) {
            currentFile = { path: newPath, name: newName };
            editorFilename.textContent = '/' + newPath;
            loadTree(currentPath);
        } else { alert(r.data.error); }
    });
    document.getElementById('renameCancel').addEventListener('click', () => { renameModal.style.display = 'none'; });
    renameInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('renameConfirm').click(); });

    // ── Logs (SSE live stream) ──
    const logsContainer = document.getElementById('logsContainer');
    let logES = null;
    let autoScroll = true;

    const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Auto-scroll only when user is near bottom
    logsContainer.addEventListener('scroll', () => {
        const nearBottom = logsContainer.scrollHeight - logsContainer.scrollTop - logsContainer.clientHeight < 80;
        autoScroll = nearBottom;
    });

    const appendLines = (text) => {
        const span = document.createElement('span');
        span.textContent = text;
        // Colorize log levels inline
        span.innerHTML = escHtml(text)
            .replace(/(\[.*?ERROR.*?\])/g, '<span style="color:#f87171;">$1</span>')
            .replace(/(\[.*?WARN.*?\])/g,  '<span style="color:#fbbf24;">$1</span>')
            .replace(/(\[wibc\.ai\])/g,    '<span style="color:#a78bfa;">$1</span>');
        logsContainer.appendChild(span);
        if (autoScroll) logsContainer.scrollTop = logsContainer.scrollHeight;
    };

    const connectLogStream = () => {
        if (logES) { logES.close(); logES = null; }
        logsContainer.innerHTML = '<span style="color:#555;">Conectando al stream de logs...</span>\n';
        autoScroll = true;

        logES = new EventSource(`/admin-api/logs/stream?token=${encodeURIComponent(token)}`);

        logES.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'clear') {
                logsContainer.innerHTML = '';
                const header = document.createElement('span');
                header.style.cssText = 'color:#9d4edd;font-weight:600;';
                header.textContent = `── ${data.file} ──\n`;
                logsContainer.appendChild(header);
            } else if (data.type === 'lines') {
                appendLines(data.content);
            }
        };

        logES.onerror = () => {
            // SSE auto-reconnects natively; just show a subtle indicator
            const span = document.createElement('span');
            span.style.color = '#555';
            span.textContent = '\n[reconectando...]\n';
            logsContainer.appendChild(span);
        };
    };

    // Connect when switching to logs tab
    document.querySelectorAll('.topbar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'logs' && !logES) connectLogStream();
            // Disconnect stream when leaving logs tab to save resources
            if (tab.dataset.tab !== 'logs' && logES) { logES.close(); logES = null; }
        });
    });

    document.getElementById('btnRefreshLogs').addEventListener('click', connectLogStream);
});
