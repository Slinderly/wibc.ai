document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    const TOKEN_KEY = 'wibc_admin_token';
    let token = localStorage.getItem(TOKEN_KEY) || '';
    let currentPath = '';
    let currentFile = null;
    let pendingDelete = null;

    const api = async (method, endpoint, body, params) => {
        let url = `/admin-api/${endpoint}`;
        if (params) url += '?' + new URLSearchParams(params).toString();
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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

    // ── Mobile: back button ──
    const filesLayout = document.getElementById('filesLayout');

    const showEditor = () => filesLayout.classList.add('show-editor');
    const showTree   = () => filesLayout.classList.remove('show-editor');

    document.getElementById('btnBack').addEventListener('click', showTree);

    // ── File Tree ──
    const fileTree       = document.getElementById('fileTree');
    const treePath       = document.getElementById('treePath');
    const editorFilename = document.getElementById('editorFilename');
    const codeEditor     = document.getElementById('codeEditor');
    const editorPH       = document.getElementById('editorPlaceholder');
    const btnSave        = document.getElementById('btnSave');
    const btnRename      = document.getElementById('btnRename');
    const editorStatus   = document.getElementById('editorStatus');
    const editorSize     = document.getElementById('editorSize');

    const loadTree = async (relPath) => {
        fileTree.innerHTML = '<div class="tree-loading">Cargando...</div>';
        const r = await api('GET', 'ls', null, { path: relPath || '/' });
        if (!r.ok) { fileTree.innerHTML = `<div class="tree-loading">${r.data.error}</div>`; return; }

        const { items, path: serverPath } = r.data;
        currentPath = serverPath;
        treePath.textContent = '/' + (serverPath === '.' ? '' : serverPath);
        fileTree.innerHTML = '';

        // Back button (navigate up)
        if (serverPath && serverPath !== '.') {
            const back = makeTreeItem('..', true, '', true);
            back.style.color = '#666';
            back.querySelector('.tree-item-name').addEventListener('click', () => {
                const parent = serverPath.split('/').slice(0, -1).join('/');
                loadTree(parent);
            });
            // hide delete on ".." item
            back.querySelector('.tree-item-del').style.display = 'none';
            fileTree.appendChild(back);
        }

        items.forEach(item => {
            const el = makeTreeItem(item.name, item.isDir, item.path);
            const nameEl = el.querySelector('.tree-item-name');
            const delBtn = el.querySelector('.tree-item-del');

            if (item.isDir) {
                nameEl.addEventListener('click', () => loadTree(item.path));
                el.querySelector('svg:first-child') && el.querySelector('i') && (el.onclick = null);
            } else {
                nameEl.addEventListener('click', () => openFile(item.path, item.name, el));
                el.querySelector('.tree-item-icon')?.addEventListener('click', () => openFile(item.path, item.name, el));
            }

            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                triggerDelete(item.path, item.name, item.isDir);
            });

            fileTree.appendChild(el);
        });

        lucide.createIcons();
    };

    const makeTreeItem = (name, isDir, filePath, isBack = false) => {
        const el = document.createElement('div');
        el.className = 'tree-item' + (isDir ? ' is-dir' : '');
        el.dataset.path = filePath;

        const iconName = isBack ? 'corner-left-up' : (isDir ? 'folder' : 'file-text');
        el.innerHTML = `
            <i data-lucide="${iconName}" class="tree-item-icon"></i>
            <span class="tree-item-name">${name}</span>
            <button class="tree-item-del" title="Eliminar"><i data-lucide="trash-2"></i></button>
        `;

        // Clicking anywhere on a file item (not the del btn) opens the file
        if (!isDir && !isBack) {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('.tree-item-del')) {
                    openFile(filePath, name, el);
                }
            });
        }
        // Clicking anywhere on a dir item (not the del btn) navigates
        if (isDir && !isBack) {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('.tree-item-del')) {
                    loadTree(filePath);
                }
            });
        }

        return el;
    };

    const openFile = async (filePath, name, el) => {
        document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
        el?.classList.add('active');

        editorStatus.textContent = 'Cargando...';
        const r = await api('GET', 'read', null, { path: filePath });
        if (!r.ok) { alert(r.data.error); editorStatus.textContent = ''; return; }

        currentFile = { path: filePath, name };
        codeEditor.value = r.data.content;
        codeEditor.disabled = false;
        editorPH.style.display = 'none';
        editorFilename.textContent = '/' + filePath;
        btnSave.disabled = false;
        btnRename.disabled = false;
        editorStatus.textContent = 'Listo';
        editorSize.textContent = `${r.data.content.length} caracteres`;

        // On mobile: switch to editor view
        showEditor();
    };

    // ── Save ──
    btnSave.addEventListener('click', async () => {
        if (!currentFile) return;
        btnSave.disabled = true;
        editorStatus.textContent = 'Guardando...';
        const r = await api('POST', 'write', { path: currentFile.path, content: codeEditor.value });
        btnSave.disabled = false;
        editorStatus.textContent = r.ok ? 'Guardado ✓' : `Error: ${r.data.error}`;
        editorSize.textContent = `${codeEditor.value.length} caracteres`;
    });

    // Ctrl+S / Cmd+S save
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
        if (r.ok) loadTree(currentPath);
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

    // ── Delete (generic: file or folder) ──
    const deleteModal   = document.getElementById('deleteModal');
    const deleteMsg     = document.getElementById('deleteModalMsg');

    const triggerDelete = (itemPath, itemName, isDir) => {
        pendingDelete = { path: itemPath, name: itemName, isDir };
        const type = isDir ? 'carpeta' : 'archivo';
        deleteMsg.textContent = `¿Eliminar ${type} "${itemName}"? Esta acción no se puede deshacer.`;
        if (isDir) deleteMsg.textContent += ' Se eliminará todo su contenido.';
        deleteModal.style.display = 'flex';
    };

    document.getElementById('deleteConfirm').addEventListener('click', async () => {
        deleteModal.style.display = 'none';
        if (!pendingDelete) return;

        const r = await api('DELETE', 'delete', null, { path: pendingDelete.path });
        if (r.ok) {
            // If deleted item was the open file, reset editor
            if (currentFile && currentFile.path === pendingDelete.path) {
                currentFile = null;
                codeEditor.value = '';
                codeEditor.disabled = true;
                editorPH.style.display = 'flex';
                editorFilename.textContent = '— ningún archivo —';
                btnSave.disabled = true;
                btnRename.disabled = true;
                editorStatus.textContent = '';
                editorSize.textContent = '';
                showTree();
            }
            // If deleted item was a directory we're inside, go up
            if (pendingDelete.isDir && currentPath.startsWith(pendingDelete.path)) {
                const parent = pendingDelete.path.split('/').slice(0, -1).join('/');
                loadTree(parent);
            } else {
                loadTree(currentPath);
            }
            pendingDelete = null;
        } else {
            alert(r.data.error);
        }
    });

    document.getElementById('deleteCancel').addEventListener('click', () => {
        deleteModal.style.display = 'none';
        pendingDelete = null;
    });

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
});
