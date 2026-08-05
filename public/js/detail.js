// ── Property detail view (in-app, SPA) ──────────────────────
import { escapeHtml, addDots, propertyUrl } from './utils.js';
import { navigateTo } from './navigation.js';
import { loadDashboard } from './dashboard.js';

export function viewProperty(id) {
    navigateTo('detail');
    showPropertyDetail(id);
}

export async function showPropertyDetail(id) {
    const container = document.getElementById('detail-content');
    container.innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div><p style="color:#86868b">Caricamento...</p></div>';
    try {
        const res = await fetch('/api/p/' + id);
        const data = await res.json();
        const p = data.property || data;
        if (data.error || !p) {
            container.innerHTML = '<div class="error-msg show">Immobile non trovato</div><button class="btn-secondary" onclick="navigateTo(\'dashboard\');loadDashboard()">← Torna</button>';
            return;
        }
        const price = p.contract_type === 'rent' ? '€ ' + (p.price || 0) + '/mese' : '€ ' + addDots(p.price || 0);
        const imgHtml = p.photos && p.photos.length > 0
            ? '<div class="detail-images">' + p.photos.map(img => '<img src="' + img + '" alt="">').join('') + '</div>'
            : '';

        window._detailProperty = p;
        if (window._detailViewUuid === undefined) window._detailViewUuid = p.uuid;
        container.innerHTML = `
            <div class="detail-header">
                <button class="btn-secondary" onclick="window.navigateTo('dashboard');window.loadDashboard()">← Torna</button>
                <h2>${escapeHtml(p.property_type || 'Immobile')}</h2>
                ${window.authToken ? '<button class="btn-secondary" onclick="window.editProperty(\'' + id + '\')">✏️ Modifica</button>' : ''}
            </div>
            <div class="detail-card">
                ${imgHtml}
                <div class="detail-body">
                    <div class="detail-price">${price}</div>
                    <div class="detail-sub">${[p.address, p.city, p.province].filter(Boolean).join(', ') || 'Posizione non specificata'}</div>
                    <div class="detail-features">
                        ${p.surface ? '<div class="detail-feat"><strong>' + p.surface + ' mq</strong><span>Superficie</span></div>' : ''}
                        ${p.rooms ? '<div class="detail-feat"><strong>' + p.rooms + '</strong><span>Locali</span></div>' : ''}
                        ${p.bedrooms ? '<div class="detail-feat"><strong>' + p.bedrooms + '</strong><span>Camere</span></div>' : ''}
                        ${p.bathrooms ? '<div class="detail-feat"><strong>' + p.bathrooms + '</strong><span>Bagni</span></div>' : ''}
                        ${p.floor !== '' && p.floor !== undefined ? '<div class="detail-feat"><strong>' + p.floor + (p.total_floors ? '/' + p.total_floors : '') + '</strong><span>Piano</span></div>' : ''}
                        ${p.building_state ? '<div class="detail-feat"><strong>' + p.building_state + '</strong><span>Stato</span></div>' : ''}
                        ${p.energy_class ? '<div class="detail-feat"><strong>' + p.energy_class + '</strong><span>Classe energetica</span></div>' : ''}
                        ${p.heating ? '<div class="detail-feat"><strong>' + p.heating + '</strong><span>Riscaldamento</span></div>' : ''}
                        ${p.elevator ? '<div class="detail-feat"><strong>✅</strong><span>Ascensore</span></div>' : ''}
                        ${p.air_conditioning ? '<div class="detail-feat"><strong>✅</strong><span>Aria condizionata</span></div>' : ''}
                        ${p.parking ? '<div class="detail-feat"><strong>✅</strong><span>Posto auto</span></div>' : ''}
                        ${p.basement ? '<div class="detail-feat"><strong>✅</strong><span>Cantina</span></div>' : ''}
                        ${p.balcony_sqm ? '<div class="detail-feat"><strong>' + p.balcony_sqm + ' mq</strong><span>Balcone</span></div>' : ''}
                        ${p.garden_sqm ? '<div class="detail-feat"><strong>' + p.garden_sqm + ' mq</strong><span>Giardino</span></div>' : ''}
                        ${p.exposure ? '<div class="detail-feat"><strong>' + p.exposure + '</strong><span>Esposizione</span></div>' : ''}
                        ${p.furnished && p.furnished !== 'No' ? '<div class="detail-feat"><strong>' + p.furnished + '</strong><span>Arredato</span></div>' : ''}
                        ${p.year_built ? '<div class="detail-feat"><strong>' + p.year_built + '</strong><span>Anno costruzione</span></div>' : ''}
                        ${p.condominium && p.contract === 'vendita' ? '<div class="detail-feat"><strong>€ ' + p.condominium + '</strong><span>' + (['apartment','villa','schiera','attico','monolocale'].includes(p.property_type) ? 'Spese condominiali mensili' : 'Spese extra mensili') + '</span></div>' : ''}
                    </div>
                    ${p.description ? '<div class="detail-description">' + escapeHtml(p.description) + '</div>' : ''}
                    <div class="detail-share">
                        <button class="share-btn copy-link" onclick="copyDetailLink('${id}')">📋 Copia link</button>
                        <button class="share-btn fb" onclick="shareDetail('facebook','${id}')">Facebook</button>
                        <button class="share-btn tw" onclick="shareDetail('twitter','${id}')">X</button>
                        <button class="share-btn wa" onclick="shareDetail('whatsapp','${id}')">WhatsApp</button>
                    </div>
                    <div class="copied-msg" id="detail-copied-msg">✅ Link copiato negli appunti!</div>
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = '<div class="error-msg show">Errore di connessione: ' + err.message + '</div><button class="btn-secondary" onclick="window.navigateTo(\'dashboard\');window.loadDashboard()">← Torna</button>';
    }
}

export function copyDetailLink(id) {
    const p = window._detailProperty;
    if (p && p.uuid) id = p.uuid;
    const url = window.location.origin + '/p/' + id;
    navigator.clipboard.writeText(url).then(() => {
        const msg = document.getElementById('detail-copied-msg');
        if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }
    });
}

export function shareDetail(platform, id) {
    const url = window.location.origin + '/p/' + id;
    const text = '🏠 Scopri questo immobile su DescriviCasa.it';
    let shareUrl = '';
    switch (platform) {
        case 'facebook': shareUrl = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url); break;
        case 'twitter': shareUrl = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url); break;
        case 'whatsapp': shareUrl = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url); break;
    }
    window.open(shareUrl, '_blank', 'width=600,height=500,noopener,noreferrer');
}

window.viewProperty = viewProperty;
window.showPropertyDetail = showPropertyDetail;
window.copyDetailLink = copyDetailLink;
window.shareDetail = shareDetail;
