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
            if (tab.dataset.tab === 'logs') loadLogs();
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

    // ── Logs ──
    const logsContainer = document.getElementById('logsContainer');

    const loadLogs = async () => {
        logsContainer.innerHTML = '<p style="color:#666;">Cargando...</p>';
        const r = await api('GET', 'logs');
        if (!r.ok) { logsContainer.innerHTML = `<p style="color:#f66;">${r.data.error}</p>`; return; }

        const { logs } = r.data;
        if (!logs.length) { logsContainer.innerHTML = '<p style="color:#666;">No hay logs disponibles.</p>'; return; }

        logsContainer.innerHTML = logs.map(l => `
            <div class="log-section">
                <div class="log-section-title">${l.file}</div>${escHtml(l.content)}
            </div>`).join('');
        logsContainer.scrollTop = logsContainer.scrollHeight;
    };

    document.getElementById('btnRefreshLogs').addEventListener('click', loadLogs);

    const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
});
