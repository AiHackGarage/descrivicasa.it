// ── Utility functions shared across modules ──────────────────

export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function slugify(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 80);
}

export function propertyUrl(uuid, title) {
    const slug = slugify(title || '');
    return '/p/' + uuid + (slug ? '/' + slug : '');
}

export function addDots(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function getMaxPhotos() {
    const plan = (window.currentUser && window.currentUser.plan) || 'free';
    return plan === 'pro' ? 10 : 5;
}
