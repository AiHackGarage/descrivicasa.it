// ── Profile panel ────────────────────────────────────────────
import { escapeHtml } from './utils.js';
import { logout, updateUI } from './auth.js';
import { navigateTo } from './navigation.js';

export function toggleProfile() {
    const panel = document.getElementById('profile-panel');
    const arrow = document.querySelector('.user-arrow');
    panel.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
    if (panel.classList.contains('open') && window.currentUser) { loadProfile(); }
}

export function loadProfile() {
    if (!window.currentUser) return;
    document.getElementById('profile-avatar').src = window.currentUser.avatar || '';
    document.getElementById('profile-name').textContent = window.currentUser.name;
    document.getElementById('profile-email').textContent = window.currentUser.email;
    const planNames = { free: 'Free', base: 'Base — €9/mese', pro: 'Pro — €29/mese' };
    document.getElementById('profile-plan').textContent = planNames[window.currentUser.plan] || 'Free';
    const limit = window.currentUser.monthly_limit || 3;
    // Mostra Rinnovo solo per piani a pagamento
    const renewalRow = document.getElementById('profile-renewal-row');
    if (window.currentUser.plan === 'base' || window.currentUser.plan === 'pro') {
        if (renewalRow) renewalRow.style.display = '';
        const now = new Date();
        const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        document.getElementById('profile-renewal').textContent = endMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    } else {
        if (renewalRow) renewalRow.style.display = 'none';
    }
    // Mostra/nascondi pulsante gestione abbonamento
    const manageBtn = document.getElementById('profile-btn-manage');
    const pricingBtn = document.getElementById('profile-btn-pricing');
    if (window.currentUser.plan === 'base' || window.currentUser.plan === 'pro') {
        if (manageBtn) manageBtn.style.display = '';
        if (pricingBtn) pricingBtn.textContent = '🔁 Cambia piano';
    } else {
        if (manageBtn) manageBtn.style.display = 'none';
        if (pricingBtn) pricingBtn.textContent = 'Vedi piani ➤';
    }
    loadHistory();
}

export async function openCustomerPortal() {
    const btn = document.getElementById('profile-btn-manage');
    if (btn) btn.textContent = '⏳ Apertura...';
    try {
        const resp = await fetch('/api/stripe/customer-portal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + window.authToken,
            },
            body: JSON.stringify({ returnUrl: window.location.origin + '/' }),
        });
        const data = await resp.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            alert(data.error || 'Errore apertura portale');
            if (btn) btn.textContent = '⚙️ Gestisci abbonamento';
        }
    } catch (err) {
        alert('Errore: ' + err.message);
        if (btn) btn.textContent = '⚙️ Gestisci abbonamento';
    }
}

export function loadHistory() {
    const list = document.getElementById('history-list');
    const loading = document.getElementById('history-loading');
    loading.style.display = 'block';
    list.innerHTML = '';
    fetch('/api/history', {
        headers: { 'Authorization': 'Bearer ' + window.authToken }
    })
    .then(r => r.json())
    .then(data => {
        loading.style.display = 'none';
        if (data.history && data.history.length > 0) {
            data.history.slice(0, 3).forEach(h => {
                const d = new Date(h.created_at);
                const dateStr = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                const div = document.createElement('div');
                div.className = 'history-item';
                div.innerHTML = '<div class="h-date">' + dateStr + '</div><div class="h-text">' + escapeHtml(h.description.slice(0, 150)) + '</div>';
                div.onclick = () => showDescription(h);
                list.appendChild(div);
            });
        } else {
            list.innerHTML = '<div class="history-empty">Ancora nessuna descrizione</div>';
        }
    })
    .catch(() => {
        loading.style.display = 'none';
        list.innerHTML = '<div class="history-empty">Errore caricamento</div>';
    });
}

function showDescription(h) {
    if (h.property_uuid) {
        window.location.href = '/p/' + h.property_uuid;
        return;
    }
    navigateTo('detail');
    import('./detail.js').then(m => m.showPropertyDetail(h.property_id || null));
}

// ── Upgrade Banner ────────────────────────────────────────

export function showUpgradeBanner(name, plan, limit) {
    const planNames = { base: 'Base', pro: 'Pro' };
    const planName = planNames[plan] || plan;
    const planDetails = {
        base: '50 descrizioni al mese e fino a 5 foto',
        pro: 'descrizioni illimitate e fino a 10 foto'
    };
    const details = planDetails[plan] || (limit + ' descrizioni al mese');

    const textEl = document.getElementById('banner-text');
    if (textEl) {
        textEl.innerHTML = '<strong>Grazie ' + escapeHtml(name) + '!</strong> 🎉<br>Benvenuto nel piano <strong>' + planName + '</strong>. Ora hai ' + details + ' per descrizione.';
    }

    const banner = document.getElementById('upgrade-banner');
    if (banner) {
        banner.classList.add('show');
        if (window.bannerTimer) clearTimeout(window.bannerTimer);
        window.bannerTimer = setTimeout(dismissBanner, 8000);
    }
}

export function dismissBanner() {
    const banner = document.getElementById('upgrade-banner');
    if (banner) banner.classList.remove('show');
    if (window.bannerTimer) { clearTimeout(window.bannerTimer); window.bannerTimer = null; }
}

// Close profile on click outside
document.addEventListener('click', (e) => {
    const panel = document.getElementById('profile-panel');
    const trigger = document.querySelector('.user-trigger');
    if (panel && panel.classList.contains('open') && trigger && !trigger.contains(e.target) && !panel.contains(e.target)) {
        panel.classList.remove('open');
        const arrow = document.querySelector('.user-arrow');
        if (arrow) arrow.classList.remove('open');
    }
});

window.toggleProfile = toggleProfile;
window.loadProfile = loadProfile;
window.openCustomerPortal = openCustomerPortal;
window.showUpgradeBanner = showUpgradeBanner;
window.dismissBanner = dismissBanner;
