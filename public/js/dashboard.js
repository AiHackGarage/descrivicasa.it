// ── Dashboard: property listing, search, filtering ────────────
import { propertyUrl, escapeHtml } from './utils.js';
import { handleAuthError } from './auth.js';

export async function loadDashboard() {
    const content = document.getElementById('dashboard-content');
    content.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div><p style="color:#86868b">Caricamento...</p></div>';
    try {
        const res = await fetch('/api/properties', {
            headers: { 'Authorization': 'Bearer ' + window.authToken }
        });
        const data = await res.json();
        if (data.error) { content.innerHTML = '<div class="error-msg show">' + data.error + '</div>'; return; }
        const properties = (data && data.properties) ? data.properties : (Array.isArray(data) ? data : []);
        window._dashboardProperties = Array.isArray(properties) ? properties : [];
        if (window._dashboardProperties.length === 0) {
            content.innerHTML = '<div class="dashboard-empty"><div class="big-icon">🏠</div><p>Nessun immobile ancora inserito.</p><button class="btn-primary" onclick="newProperty()">➕ Aggiungi il primo immobile</button></div>';
            return;
        }
        renderDashboard();
    } catch (err) {
        content.innerHTML = '<div class="error-msg show">Errore di connessione: ' + err.message + '</div>';
    }
}

export function renderDashboard() {
    const content = document.getElementById('dashboard-content');
    let arr = window._dashboardProperties;

    // Read filter values
    const q = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();
    const terms = q ? q.split(/\s+/).filter(t => t.length > 0) : [];
    const priceMin = parseFloat(document.getElementById('filter-price-min')?.value) || 0;
    const priceMax = parseFloat(document.getElementById('filter-price-max')?.value) || 0;
    const zone = (document.getElementById('filter-zone')?.value || '').toLowerCase().trim();
    const dateDays = parseInt(document.getElementById('filter-date')?.value) || 0;

    // Apply filters
    if (terms.length || priceMin || priceMax || zone || dateDays) {
        const cutoff = dateDays ? Date.now() - dateDays * 86400000 : 0;
        arr = arr.filter(p => {
            if (terms.length) {
                const haystack = [
                    p.address, p.city, p.province, p.zone, p.title, p.property_type,
                    p.description, p.contract_type, p.agent_name
                ].filter(Boolean).join(' ').toLowerCase();
                if (!terms.every(t => haystack.includes(t))) return false;
            }
            const pVal = parseFloat(p.price) || 0;
            if (priceMin && pVal < priceMin) return false;
            if (priceMax && pVal > priceMax) return false;
            if (zone) {
                const loc = [p.address, p.city, p.province].filter(Boolean).join(' ').toLowerCase();
                if (!loc.includes(zone)) return false;
            }
            if (cutoff) {
                const created = new Date(p.created_at || p.updated_at).getTime();
                if (created < cutoff) return false;
            }
            return true;
        });
    }

    if (arr.length === 0) {
        content.innerHTML = '<div class="dashboard-empty"><div class="big-icon">🔍</div><p>Nessun immobile corrisponde ai filtri.</p><button class="btn-primary" onclick="clearFilters()">✕ Cancella filtri</button></div>';
        return;
    }

    let html = '<div class="property-grid">';
    arr.forEach(p => {
        const price = p.contract_type === 'rent' ? '€ ' + (p.price || 0) + '/mese' : '€ ' + (p.price || 0);
        const pht = (() => {
            try { const raw = Array.isArray(p.photos) ? p.photos : (typeof p.photos === 'string' ? JSON.parse(p.photos) : []); return Array.isArray(raw) ? raw : []; }
            catch (_) { return []; }
        })();
        const imgSrc = pht.length > 0 ? pht[0] : '';
        const address = p.address || p.city || 'Indirizzo non specificato';
        html += '<div class="property-card" onclick="window.location.href=\'' + propertyUrl(p.uuid || p.id, p.title) + '\'">';
        if (imgSrc) {
            html += '<img class="property-card-img" src="' + imgSrc + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
            html += '<div class="card-fallback property-card-img" style="display:none;align-items:center;justify-content:center;background:#e8e8ed;color:#86868b;font-size:2rem">🏠</div>';
        } else {
            html += '<div class="property-card-img" style="display:flex;align-items:center;justify-content:center;background:#e8e8ed;color:#86868b;font-size:2rem">🏠</div>';
        }
        html += '<div class="property-card-body">';
        html += '<div class="property-card-price">' + price + '</div>';
        html += '<div class="property-card-address">' + escapeHtml(address) + '</div>';
        html += '<div class="property-card-meta">';
        if (p.surface) html += '<span>📐 ' + p.surface + ' mq</span>';
        if (p.rooms) html += '<span>🛏️ ' + p.rooms + '</span>';
        if (p.bathrooms) html += '<span>🚿 ' + p.bathrooms + '</span>';
        html += '</div></div>';
        html += '<div class="property-card-actions" onclick="event.stopPropagation()">';
        html += '<button style="background:linear-gradient(135deg,#667eea,#764ba2)" onclick="editProperty(\'' + (p.uuid || p.id) + '\')">✏️ Modifica</button>';
        html += '<a href="/api/p/' + encodeURIComponent(p.uuid || p.id) + '/pdf" target="_blank" rel="noopener" style="background:linear-gradient(135deg,#6daa7e,#4f8a5f)">📄 PDF</a>';
        html += '<button style="background:linear-gradient(135deg,#c97a7a,#a85555)" onclick="deleteProperty(' + p.id + ')">🗑️ Elimina</button>';
        html += '</div></div>';
    });
    html += '</div>';
    html += '<div class="dashboard-filter-count">Mostrati ' + arr.length + ' di ' + window._dashboardProperties.length + ' immobili</div>';
    content.innerHTML = html;
}

export function applyFilters() {
    renderDashboard();
}

export function clearFilters() {
    const ids = ['filter-search', 'filter-price-min', 'filter-price-max', 'filter-zone', 'filter-date'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderDashboard();
}

export function deleteProperty(id) {
    if (!confirm('Sei sicuro di voler eliminare questo immobile? L\'operazione non può essere annullata.')) return;
    fetch('/api/properties/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + window.authToken }
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { alert(data.error); return; }
        loadDashboard();
    })
    .catch(err => alert('Errore: ' + err.message));
}

export function editProperty(uuid) {
    window.location.href = '/?edit=' + uuid;
}

export function newProperty() {
    if (window.currentUser && window.currentUser.remaining <= 0) {
        alert('Hai esaurito le descrizioni di questo mese. Passa a Base o Pro per continuare.');
        return;
    }
    // Reset editor state
    window.editorState.editingId = null;
    window.editorState.step = 1;
    window.editorState.data = {
        contract: 'vendita',
        type: 'Appartamento',
        price: '',
        condominium: '',
        address: '',
        city: '',
        province: '',
        lat: 41.9028,
        lng: 12.4964,
        surface: '',
        rooms: '',
        bedrooms: '',
        bathrooms: '',
        floor: '',
        total_floors: '',
        elevator: false,
        condition: 'Nuovo',
        energy_class: 'A4',
        heating: 'Autonomo',
        air_conditioning: false,
        exposure: '',
        balcony: '',
        garden: '',
        parking: false,
        basement: false,
        furnished: 'No',
        year_built: '',
        photos: [],
        description: '',
        phone: '',
        email: ''
    };
    import('./navigation.js').then(m => m.navigateTo('editor'));
    import('./editor.js').then(m => m.renderEditor());
}

window.loadDashboard = loadDashboard;
window.renderDashboard = renderDashboard;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.deleteProperty = deleteProperty;
window.editProperty = editProperty;
window.newProperty = newProperty;
