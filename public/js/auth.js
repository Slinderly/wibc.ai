const loginForm = document.getElementById('loginForm');

// --- AUTO LOGIN CHECK ---
document.addEventListener('DOMContentLoaded', () => {
    const userId = localStorage.getItem('wibc_userId');
    if (userId) {
        window.location.href = '/dashboard';
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

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
            document.getElementById('loginError').innerText = data.message;
        }
    } catch (err) {
        console.error("Error en login:", err);
    }
});
