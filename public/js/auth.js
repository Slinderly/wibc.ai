// --- AUTO LOGIN CHECK ---
document.addEventListener('DOMContentLoaded', () => {
    const userId = localStorage.getItem('wibc_userId');
    if (userId) {
        window.location.href = '/dashboard';
    }
});

// --- TAB SWITCHER ---
function switchTab(tab) {
    document.getElementById('panelLogin').classList.toggle('active', tab === 'login');
    document.getElementById('panelRegister').classList.toggle('active', tab === 'register');
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    document.getElementById('loginError').innerText = '';
    document.getElementById('registerError').innerText = '';
    document.getElementById('registerSuccess').innerText = '';
}

// --- LOGIN ---
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl  = document.getElementById('loginError');
    errorEl.innerText = '';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('wibc_userId', data.userId);
            window.location.href = '/dashboard';
        } else {
            errorEl.innerText = data.message;
        }
    } catch (err) {
        errorEl.innerText = 'Error de conexión. Intenta de nuevo.';
    }
});

// --- REGISTER ---
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username  = document.getElementById('regUsername').value.trim();
    const password  = document.getElementById('regPassword').value;
    const errorEl   = document.getElementById('registerError');
    const successEl = document.getElementById('registerSuccess');
    errorEl.innerText   = '';
    successEl.innerText = '';

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('wibc_userId', data.userId);
            window.location.href = '/dashboard';
        } else {
            errorEl.innerText = data.message;
        }
    } catch (err) {
        errorEl.innerText = 'Error de conexión. Intenta de nuevo.';
    }
});
