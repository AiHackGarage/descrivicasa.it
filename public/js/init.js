// ── Application bootstrap ────────────────────────────────────
import { navigateTo } from './navigation.js';
import { updateUI, showModal } from './auth.js';
import { loadDashboard } from './dashboard.js';
import { showPropertyDetail, copyDetailLink, shareDetail } from './detail.js';
import { loadEditPage } from './edit.js';
import { showUpgradeBanner } from './profile.js';

// ── Google Sign-In init ──────────────────────────────────────

function initGoogle() {
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.initialize({
            client_id: '718077316234-lato3jpdj7hc6b1ts5nc532pnhs5eeun.apps.googleusercontent.com',
            callback: window.handleGoogleCredential,
        });
    } else {
        setTimeout(initGoogle, 500);
    }
}
initGoogle();

// ── Auth check on load ──────────────────────────────────────

if (window.authToken) {
    fetch('/api/me', {
        headers: { 'Authorization': 'Bearer ' + window.authToken }
    })
        .then(r => r.json())
        .then(data => {
            if (data.user) {
                window.currentUser = data.user;
                updateUI();

                // Sync subscription after Stripe redirect
                const urlParams = new URLSearchParams(window.location.search);
                const subscribedPlan = urlParams.get('subscribed');
                if (subscribedPlan && (subscribedPlan === 'base' || subscribedPlan === 'pro')) {
                    fetch('/api/sync-subscription', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + window.authToken, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ plan: subscribedPlan }),
                    })
                        .then(r => r.json())
                        .then(syncData => {
                            if (syncData.synced) {
                                window.currentUser.plan = syncData.plan;
                                window.currentUser.monthly_limit = syncData.monthly_limit;
                                window.currentUser.remaining = syncData.remaining;
                                updateUI();
                                showUpgradeBanner(window.currentUser.name, subscribedPlan, syncData.monthly_limit);
                                window.history.replaceState({}, '', '/');
                            }
                        })
                        .catch(() => { });
                }

                if (window.currentView === 'dashboard' || window.currentView === 'landing') loadDashboard();
            } else {
                localStorage.removeItem('dc_token');
            }
        })
        .catch(() => {
            localStorage.removeItem('dc_token');
        });
}

// ── URL-based routing ───────────────────────────────────────

function checkUrlForDetail() {
    const match = window.location.pathname.match(/^\/p\/([a-f0-9-]+)$/);
    if (match) {
        const id = match[1];
        setTimeout(() => showPropertyDetail(id), 300);
    }
}
checkUrlForDetail();
window.addEventListener('popstate', checkUrlForDetail);

// Check for ?edit=UUID parameter
(function checkEditParam() {
    const params = new URLSearchParams(window.location.search);
    const editUuid = params.get('edit');
    if (editUuid) {
        const tryLoad = () => {
            if (window.authToken && window.currentUser) {
                loadEditPage(editUuid);
            } else if (window.authToken && !window.currentUser) {
                setTimeout(tryLoad, 300);
            } else {
                showModal('login');
            }
        };
        setTimeout(tryLoad, 500);
    }
})();
