// ── Authentication, modal, and UI helpers ─────────────────────
import { escapeHtml } from './utils.js';

// ── Modal ─────────────────────────────────────────────────

export function showModal(type) {
    document.getElementById('modal-login').style.display = type === 'login' ? 'block' : 'none';
    document.getElementById('modal-register').style.display = type === 'register' ? 'block' : 'none';
    document.getElementById('modal-overlay').classList.add('show');
    document.getElementById('login-error').classList.remove('show');
    document.getElementById('reg-error').classList.remove('show');
    setTimeout(() => renderGoogleButton(type), 200);
}

export function closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
}

export function renderGoogleButton(type) {
    const container = document.getElementById(type === 'login' ? 'g-button-login' : 'g-button-register');
    container.innerHTML = '';
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.renderButton(container, {
            type: 'standard',
            shape: 'rectangular',
            theme: 'outline',
            text: type === 'login' ? 'signin_with' : 'signup_with',
            size: 'large',
            width: container.parentElement.offsetWidth - 64 || 300,
        });
    }
}

// ── Error display ─────────────────────────────────────────

export function showError(msg, form = 'login') {
    const el = document.getElementById(form === 'login' ? 'login-error' : 'reg-error');
    el.textContent = msg;
    el.classList.add('show');
}

// ── UI update ─────────────────────────────────────────────

export function updateUI() {
    const authDiv = document.getElementById('topbar-auth');
    const userDiv = document.getElementById('topbar-user');
    const nameSpan = document.getElementById('user-name');
    const avatarImg = document.getElementById('user-avatar');
    const genSpan = document.getElementById('user-generations');

    if (window.authToken && window.currentUser) {
        authDiv.style.display = 'none';
        userDiv.style.display = 'flex';
        nameSpan.textContent = window.currentUser.name;
        const remaining = window.currentUser.remaining !== undefined ? window.currentUser.remaining : '?';
        genSpan.textContent = remaining + '/' + (window.currentUser.monthly_limit || 3);
        avatarImg.src = window.currentUser.avatar || '/favicon.png';
        // Disabilita pulsante Nuovo immobile se crediti esauriti
        const btnNew = document.getElementById('btn-new-property');
        if (btnNew) {
            if (remaining <= 0) {
                btnNew.disabled = true;
                btnNew.style.opacity = '0.5';
                btnNew.style.cursor = 'not-allowed';
                btnNew.textContent = '🔒 Crediti esauriti';
            } else {
                btnNew.disabled = false;
                btnNew.style.opacity = '';
                btnNew.style.cursor = '';
                btnNew.textContent = '➕ Nuovo immobile';
            }
        }
        // If on landing and logged in, go to dashboard
        if (window.currentView === 'landing') {
            import('./navigation.js').then(m => { m.navigateTo('dashboard'); });
        }
    } else {
        authDiv.style.display = 'flex';
        userDiv.style.display = 'none';
        // If on dashboard and not logged in, go to landing
        if (window.currentView === 'dashboard' || window.currentView === 'editor' || window.currentView === 'detail') {
            import('./navigation.js').then(m => m.navigateTo('landing'));
        }
    }
}

// ── Auth error handler ────────────────────────────────────

export function handleAuthError(status) {
    if (status === 401) {
        alert('Sessione scaduta. Per favore, rieffettua il login.');
        localStorage.removeItem('dc_token');
        window.authToken = null;
        window.currentUser = null;
        updateUI();
        import('./navigation.js').then(m => m.navigateTo('landing'));
        return true;
    }
    return false;
}

// ── Email Login ───────────────────────────────────────────

export function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { return showError('Inserisci email e password', 'login'); }
    document.querySelector('#modal-login .btn-submit').textContent = '⏳...';
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    })
    .then(r => r.json())
    .then(data => {
        document.querySelector('#modal-login .btn-submit').textContent = 'Accedi';
        if (data.error) return showError(data.error, 'login');
        window.authToken = data.token;
        window.currentUser = data.user;
        localStorage.setItem('dc_token', window.authToken);
        closeModal();
        updateUI();
    })
    .catch(err => {
        document.querySelector('#modal-login .btn-submit').textContent = 'Accedi';
        showError('Errore: ' + err.message, 'login');
    });
}

// ── Email Register ────────────────────────────────────────

export function register() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const marketing_consent = document.getElementById('reg-marketing').checked;
    if (!name || !email || !password) { return showError('Compila tutti i campi', 'reg'); }
    if (password.length < 6) { return showError('La password deve essere almeno 6 caratteri', 'reg'); }
    document.querySelector('#modal-register .btn-submit').textContent = '⏳...';
    fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, marketing_consent }),
    })
    .then(r => r.json())
    .then(data => {
        document.querySelector('#modal-register .btn-submit').textContent = 'Crea Account';
        if (data.error) return showError(data.error, 'reg');
        window.authToken = data.token;
        window.currentUser = data.user;
        localStorage.setItem('dc_token', window.authToken);
        closeModal();
        updateUI();
    })
    .catch(err => {
        document.querySelector('#modal-register .btn-submit').textContent = 'Crea Account';
        showError('Errore: ' + err.message, 'reg');
    });
}

// ── Logout ────────────────────────────────────────────────

export function logout() {
    window.authToken = null;
    window.currentUser = null;
    localStorage.removeItem('dc_token');
    window.location.href = '/';
}

// ── Google Sign-In callback ───────────────────────────────

export function handleGoogleCredential(response) {
    fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { showError(data.error); return; }
        window.authToken = data.token;
        window.currentUser = data.user;
        localStorage.setItem('dc_token', window.authToken);
        closeModal();
        updateUI();
    })
    .catch(err => showError('Errore Google: ' + err.message));
}

// ── Expose globally for onclick/Google callback ───────────
window.showModal = showModal;
window.closeModal = closeModal;
window.login = login;
window.register = register;
window.logout = logout;
window.handleGoogleCredential = handleGoogleCredential;
window.updateUI = updateUI;
window.handleAuthError = handleAuthError;
