// ── SPA Navigation ────────────────────────────────────────────
import { loadDashboard } from './dashboard.js';

export function navigateTo(view) {
    // If logged in and trying to go to landing, redirect to dashboard
    if (view === 'landing' && window.authToken && window.currentUser) {
        view = 'dashboard';
    }
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Show target
    const target = document.getElementById('view-' + view);
    if (target) target.classList.add('active');
    window.currentView = view;
    window.scrollTo(0, 0);
    if (view === 'dashboard') loadDashboard();
}

window.navigateTo = navigateTo;
