// ── Multi-step property editor wizard ─────────────────────────
import { escapeHtml, getMaxPhotos, propertyUrl } from './utils.js';
import { handleAuthError, updateUI } from './auth.js';

// ── Editor rendering ─────────────────────────────────────────

export function renderEditor() {
    renderStepProgress();
    renderStepContent();
}

function renderStepProgress() {
    const container = document.getElementById('step-progress');
    const labels = ['Tipo & Prezzo', 'Posizione', 'Caratteristiche', 'Dettagli', 'Foto e Crea'];
    let html = '';
    for (let i = 1; i <= window.editorState.totalSteps; i++) {
        if (i > 1) {
            const done = (i - 1) <= window.editorState.step - 1;
            html += '<div class="step-line' + (done ? ' done' : '') + '"></div>';
        }
        let cls = 'step-circle';
        if (i === window.editorState.step) cls += ' active';
        else if (i < window.editorState.step) cls += ' done';
        html += '<div class="' + cls + '" title="' + labels[i - 1] + '" onclick="gotoStep(' + i + ')">' + (i < window.editorState.step ? '✓' : i) + '</div>';
    }
    container.innerHTML = html;
}

export function gotoStep(s) {
    if (s < 1 || s > window.editorState.totalSteps) return;
    window.editorState.step = s;
    renderEditor();
}

export function nextStep() {
    if (window.editorState.step < window.editorState.totalSteps) {
        window.editorState.step++;
        renderEditor();
    }
}

export function prevStep() {
    if (window.editorState.step > 1) {
        window.editorState.step--;
        renderEditor();
    }
}

function renderStepContent() {
    const container = document.getElementById('editor-step-content');
    const step = window.editorState.step;
    let html = '';
    switch (step) {
        case 1: html = renderStep1(); break;
        case 2: html = renderStep2(); break;
        case 3: html = renderStep3(); break;
        case 4: html = renderStep4(); break;
        case 5: html = renderStep5(); break;
    }
    container.innerHTML = html;
    const nav = document.createElement('div');
    nav.className = 'step-nav';
    if (step > 1) {
        nav.innerHTML += '<button class="btn-prev" onclick="prevStep()">← Indietro</button>';
    } else {
        nav.innerHTML += '<div></div>';
    }
    if (step < 5) {
        nav.innerHTML += '<button class="btn-next" onclick="nextStep()">Avanti →</button>';
    }
    container.appendChild(nav);
    if (step === 2) setTimeout(initEditorMap, 200);
}

// ── Step renderers ────────────────────────────────────────────

function renderStep1() {
    const d = window.editorState.data;
    return `
        <h2>💰 Tipo e Prezzo</h2>
        <p class="sub">Seleziona il tipo di contratto e il prezzo dell'immobile</p>
        <div class="form-group">
            <label>Contratto</label>
            <div class="toggle-group">
                <button class="toggle-btn ${d.contract === 'vendita' ? 'active' : ''}" onclick="window.editorState.data.contract='vendita';window.renderEditor()">Vendita</button>
                <button class="toggle-btn ${d.contract === 'affitto' ? 'active' : ''}" onclick="window.editorState.data.contract='affitto';window.renderEditor()">Affitto</button>
            </div>
        </div>
        <div class="form-group">
            <label>Tipo immobile</label>
            <select onchange="window.editorState.data.type=this.value;window.renderEditor()">
                ${['Appartamento','Villa','Schiera','Attico','Monolocale','Ufficio','Negozio','Terreno','Magazzino','Box','Fabbricato'].map(t =>
                    '<option value="' + t + '"' + (d.type === t ? ' selected' : '') + '>' + t + '</option>'
                ).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>Prezzo (€)</label>
            <input type="number" value="${d.price}" onchange="window.editorState.data.price=this.value" placeholder="es. 250000" min="0">
        </div>
        ${d.contract === 'vendita' ? `
        <div class="form-group">
            <label>${['Appartamento','Villa','Schiera','Attico','Monolocale'].includes(d.type) ? 'Spese condominiali mensili (€)' : 'Spese extra mensili (€)'}</label>
            <input type="number" value="${d.condominium}" onchange="window.editorState.data.condominium=this.value" placeholder="es. 150" min="0">
        </div>` : ''}
    `;
}

function renderStep2() {
    const d = window.editorState.data;
    return `
        <h2>📍 Posizione</h2>
        <p class="sub">Inserisci l'indirizzo e scegli il punto sulla mappa</p>
        <div class="form-row">
            <div class="form-group">
                <label>Indirizzo</label>
                <input type="text" value="${escapeHtml(d.address)}" onchange="window.editorState.data.address=this.value" placeholder="es. Via Roma, 12">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Città</label>
                <input type="text" value="${escapeHtml(d.city)}" onchange="window.editorState.data.city=this.value" placeholder="es. Roma">
            </div>
            <div class="form-group">
                <label>Provincia</label>
                <input type="text" value="${escapeHtml(d.province)}" onchange="window.editorState.data.province=this.value" placeholder="es. RM">
            </div>
        </div>
        <div id="map"></div>
        <div class="map-coords">
            Lat: ${d.lat.toFixed(5)}, Lng: ${d.lng.toFixed(5)}
            <br><button class="btn-secondary" onclick="searchOnMap()" style="margin-top:6px;padding:6px 16px;font-size:0.85rem">🔍 Cerca sulla mappa</button>
        </div>
    `;
}

function renderStep3() {
    const d = window.editorState.data;
    return `
        <h2>📐 Caratteristiche</h2>
        <p class="sub">Dimensioni e caratteristiche principali dell'immobile</p>
        <div class="form-row three">
            <div class="form-group"><label>Superficie (mq)</label><input type="number" value="${d.surface}" onchange="window.editorState.data.surface=this.value" placeholder="es. 100"></div>
            <div class="form-group"><label>Locali</label><input type="number" value="${d.rooms}" onchange="window.editorState.data.rooms=this.value" placeholder="es. 5"></div>
            <div class="form-group"><label>Camere da letto</label><input type="number" value="${d.bedrooms}" onchange="window.editorState.data.bedrooms=this.value" placeholder="es. 2"></div>
        </div>
        <div class="form-row three">
            <div class="form-group"><label>Bagni</label><input type="number" value="${d.bathrooms}" onchange="window.editorState.data.bathrooms=this.value" placeholder="es. 2"></div>
            <div class="form-group"><label>Piano</label><input type="number" value="${d.floor}" onchange="window.editorState.data.floor=this.value" placeholder="es. 3"></div>
            <div class="form-group"><label>Totale piani</label><input type="number" value="${d.total_floors}" onchange="window.editorState.data.total_floors=this.value" placeholder="es. 6"></div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" ${d.elevator ? 'checked' : ''} onchange="window.editorState.data.elevator=this.checked">
                    <span>Ascensore</span>
                </label>
            </div>
            <div class="form-group">
                <label>Stato</label>
                <select onchange="window.editorState.data.condition=this.value">
                    ${['Nuovo','Ristrutturato','Abitabile','Da ristrutturare'].map(s =>
                        '<option value="' + s + '"' + (d.condition === s ? ' selected' : '') + '>' + s + '</option>'
                    ).join('')}
                </select>
            </div>
        </div>
    `;
}

function renderStep4() {
    const d = window.editorState.data;
    return `
        <h2>🔧 Dettagli extra</h2>
        <p class="sub">Informazioni aggiuntive sull'immobile</p>
        <div class="form-row">
            <div class="form-group"><label>Classe energetica</label>
                <select onchange="window.editorState.data.energy_class=this.value">
                    ${['A4','A3','A2','A1','B','C','D','E','F','G'].map(c =>
                        '<option value="' + c + '"' + (d.energy_class === c ? ' selected' : '') + '>' + c + '</option>'
                    ).join('')}
                </select>
            </div>
            <div class="form-group"><label>Riscaldamento</label>
                <select onchange="window.editorState.data.heating=this.value">
                    ${['Autonomo','Centralizzato','Riscaldamento a pavimento','Stufa'].map(h =>
                        '<option value="' + h + '"' + (d.heating === h ? ' selected' : '') + '>' + h + '</option>'
                    ).join('')}
                </select>
            </div>
        </div>
        <div class="form-row three">
            <div class="form-group"><label>Esposizione</label><input type="text" value="${escapeHtml(d.exposure)}" onchange="window.editorState.data.exposure=this.value" placeholder="es. Nord, Sud"></div>
            <div class="form-group"><label>Balcone/Terrazzo (mq)</label><input type="number" value="${d.balcony}" onchange="window.editorState.data.balcony=this.value" placeholder="es. 20"></div>
            <div class="form-group"><label>Giardino (mq)</label><input type="number" value="${d.garden}" onchange="window.editorState.data.garden=this.value" placeholder="es. 50"></div>
        </div>
        <div class="form-row three">
            <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" ${d.air_conditioning ? 'checked' : ''} onchange="window.editorState.data.air_conditioning=this.checked"><span>Aria condizionata</span></label>
            </div>
            <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" ${d.parking ? 'checked' : ''} onchange="window.editorState.data.parking=this.checked"><span>Posto auto</span></label>
            </div>
            <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" ${d.basement ? 'checked' : ''} onchange="window.editorState.data.basement=this.checked"><span>Cantina</span></label>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Arredato</label>
                <select onchange="window.editorState.data.furnished=this.value">
                    ${['No','Si','Parzialmente'].map(f =>
                        '<option value="' + f + '"' + (d.furnished === f ? ' selected' : '') + '>' + f + '</option>'
                    ).join('')}
                </select>
            </div>
            <div class="form-group"><label>Anno costruzione</label><input type="number" value="${d.year_built}" onchange="window.editorState.data.year_built=this.value" placeholder="es. 2005" min="1800" max="2030"></div>
        </div>
    `;
}

function renderStep5() {
    const d = window.editorState.data;
    const photosCount = d.photos ? d.photos.length : 0;
    const photosHtml = d.photos && d.photos.length > 0
        ? '<div class="photo-preview-grid">' + d.photos.map((p, i) =>
            '<div class="photo-preview-item"><img src="' + p.url + '" alt=""><button class="photo-remove" onclick="removePhoto(' + i + ')">✕</button></div>'
        ).join('') + '</div>'
        : '';
    return `
        <h2>📸 Carica le foto e crea pagina</h2>
        <p class="sub">Ultimo passo! Carica le foto e pubblica l'immobile</p>
        <div class="photo-dropzone" id="photo-dropzone" onclick="document.getElementById('photo-input').click()">
            <div class="dz-icon">📷</div>
            <p>Trascina qui le foto o clicca per selezionarle</p>
            <p style="font-size:0.8rem;color:#a0a0a0;margin-top:6px;">Max ${getMaxPhotos()} foto • JPEG, PNG, WebP</p>
            <p style="font-size:0.75rem;color:#e8a838;margin-top:4px;">⚠️ Carica solo foto reali dell'immobile, non planimetrie o documenti</p>
        </div>
        <input type="file" id="photo-input" multiple accept="image/*" style="display:none" onchange="handlePhotoSelect(event)">
        ${photosHtml}
        <div style="text-align:center;margin-top:28px;">
            ${photosCount > 0
              ? '<button class="btn-create-page" id="btn-create-page" onclick="createAndPublish()" style="animation:pulse 2s infinite">🚀 Crea pagina</button>'
              : '<button class="btn-create-page" id="btn-create-page" onclick="createAndPublish()" disabled>📸 Carica prima le foto</button>'
            }
        </div>
        <div class="gen-spinner" id="gen-spinner">
            <div class="spinner"></div>
            <p>Creazione immobile...</p>
        </div>
    `;
}

// ── Photo management ──────────────────────────────────────────

export function handlePhotoSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const remaining = getMaxPhotos() - (window.editorState.data.photos ? window.editorState.data.photos.length : 0);
    const toAdd = files.slice(0, remaining);
    toAdd.forEach(f => {
        const url = URL.createObjectURL(f);
        window.editorState.data.photos.push({ url, file: f });
    });
    renderEditor();
}

export function removePhoto(idx) {
    window.editorState.data.photos.splice(idx, 1);
    renderEditor();
}

// ── Map ──────────────────────────────────────────────────────

function initEditorMap() {
    const mapDiv = document.getElementById('map');
    if (!mapDiv) return;
    if (window.editorMap) {
        try { window.editorMap.remove(); } catch (e) { }
        window.editorMap = null;
        window.editorMarker = null;
    }
    const d = window.editorState.data;
    window.editorMap = L.map('map').setView([d.lat, d.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap'
    }).addTo(window.editorMap);
    window.editorMarker = L.marker([d.lat, d.lng], { draggable: true }).addTo(window.editorMap);
    window.editorMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        window.editorState.data.lat = pos.lat;
        window.editorState.data.lng = pos.lng;
        const mc = document.querySelector('.map-coords');
        if (mc) mc.innerHTML = 'Lat: ' + pos.lat.toFixed(5) + ', Lng: ' + pos.lng.toFixed(5) +
            '<br><button class="btn-secondary" onclick="searchOnMap()" style="margin-top:6px;padding:6px 16px;font-size:0.85rem">🔍 Cerca sulla mappa</button>';
    });
    window.editorMap.on('click', (e) => {
        const pos = e.latlng;
        window.editorState.data.lat = pos.lat;
        window.editorState.data.lng = pos.lng;
        if (window.editorMarker) window.editorMarker.setLatLng(pos);
        else window.editorMarker = L.marker(pos, { draggable: true }).addTo(window.editorMap);
        const mc = document.querySelector('.map-coords');
        if (mc) mc.innerHTML = 'Lat: ' + pos.lat.toFixed(5) + ', Lng: ' + pos.lng.toFixed(5) +
            '<br><button class="btn-secondary" onclick="searchOnMap()" style="margin-top:6px;padding:6px 16px;font-size:0.85rem">🔍 Cerca sulla mappa</button>';
    });
}

export function searchOnMap() {
    const d = window.editorState.data;
    const query = (d.address + ', ' + d.city + ', ' + d.province).trim();
    if (!query || query === ', , ') { alert('Inserisci un indirizzo prima di cercare'); return; }
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&limit=1&accept-language=it')
        .then(r => r.json())
        .then(data => {
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                window.editorState.data.lat = lat;
                window.editorState.data.lng = lng;
                if (window.editorMarker) window.editorMarker.setLatLng([lat, lng]);
                if (window.editorMap) window.editorMap.setView([lat, lng], 15);
                const mc = document.querySelector('.map-coords');
                if (mc) mc.innerHTML = 'Lat: ' + lat.toFixed(5) + ', Lng: ' + lng.toFixed(5) +
                    '<br><button class="btn-secondary" onclick="searchOnMap()" style="margin-top:6px;padding:6px 16px;font-size:0.85rem">🔍 Cerca sulla mappa</button>';
            } else {
                alert('Nessun risultato trovato per l\'indirizzo specificato');
            }
        })
        .catch(err => alert('Errore geocoding: ' + err.message));
}

// ── Create and publish ────────────────────────────────────────

export async function createAndPublish() {
    const d = window.editorState.data;
    if (!d.photos || d.photos.length === 0) {
        alert('Carica almeno una foto prima di creare la pagina.');
        return;
    }

    const overlay = document.getElementById('gen-spinner');
    const pEl = overlay ? overlay.querySelector('p') : null;
    if (overlay) overlay.classList.add('show');

    let propId = null;
    let propUuid = null;

    try {
        if (pEl) pEl.textContent = 'Creazione immobile...';

        const formData = new FormData();
        formData.append('data', JSON.stringify({
            contract_type: d.contract === 'vendita' ? 'sell' : 'rent',
            property_type: d.type ? d.type.toLowerCase() : 'apartment',
            address: d.address || '',
            city: d.city || '',
            province: d.province || '',
            latitude: d.lat,
            longitude: d.lng,
            surface: d.surface || null,
            rooms: d.rooms || null,
            bedrooms: d.bedrooms || null,
            bathrooms: d.bathrooms || null,
            floor: d.floor !== '' ? d.floor : null,
            total_floors: d.total_floors || null,
            elevator: d.elevator || false,
            building_state: d.condition || null,
            energy_class: d.energy_class || null,
            heating: d.heating || null,
            air_conditioning: d.air_conditioning || false,
            exposure: d.exposure || null,
            balcony_sqm: d.balcony || null,
            garden_sqm: d.garden || null,
            parking: d.parking || false,
            basement: d.basement || false,
            furnished: d.furnished ? d.furnished.toLowerCase() : 'no',
            year_built: d.year_built || null,
            price: d.price || null,
            condo_fees: d.condominium || null,
            agent_phone: d.phone || null,
            agent_email: d.email || null,
        }));

        d.photos.forEach(ph => {
            if (ph.file) formData.append('files', ph.file);
        });

        const createRes = await fetch('/api/properties', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + window.authToken },
            body: formData
        });
        if (handleAuthError(createRes.status)) return;
        const createData = await createRes.json();
        if (createData.error) throw new Error(createData.error);

        const uuid = createData.uuid;
        if (!uuid) throw new Error('UUID non ricevuto');
        propUuid = uuid;

        if (pEl) pEl.textContent = 'Generazione descrizione in corso...';

        const listRes = await fetch('/api/properties', {
            headers: { 'Authorization': 'Bearer ' + window.authToken }
        });
        if (handleAuthError(listRes.status)) return;
        const listData = await listRes.json();
        const props = listData.properties || [];
        const prop = props.find(p => p.uuid === uuid);
        if (!prop) {
            window.location.href = propertyUrl(uuid);
            return;
        }

        propId = prop.id;

        if (pEl) pEl.textContent = "AI all'opera...";
        const genRes = await fetch('/api/properties/' + prop.id + '/generate', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + window.authToken }
        });
        if (handleAuthError(genRes.status)) return;
        const genData = await genRes.json();
        if (genData.error) throw new Error(genData.error);

        if (genData.remaining !== undefined && window.currentUser) {
            window.currentUser.remaining = genData.remaining;
            updateUI();
        }

        window.location.href = propertyUrl(uuid, genData.title);

    } catch (err) {
        // Cleanup orphan property
        if (propId) {
            try {
                await fetch('/api/properties/' + propId, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + window.authToken }
                });
            } catch (_) { }
        } else if (propUuid) {
            try {
                const listRes = await fetch('/api/properties', {
                    headers: { 'Authorization': 'Bearer ' + window.authToken }
                });
                if (listRes.ok) {
                    const listData = await listRes.json();
                    const p = (listData.properties || []).find(p => p.uuid === propUuid);
                    if (p) {
                        await fetch('/api/properties/' + p.id, {
                            method: 'DELETE',
                            headers: { 'Authorization': 'Bearer ' + window.authToken }
                        });
                    }
                }
            } catch (_) { }
        }
        if (overlay) overlay.classList.remove('show');
        alert('Errore: ' + err.message);
    }
}

// ── Drag and drop ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('dragenter', () => {
        const dz = document.getElementById('photo-dropzone');
        if (dz && window.currentView === 'editor' && window.editorState.step === 5) dz.classList.add('dragover');
    });
    document.addEventListener('dragleave', () => {
        const dz = document.getElementById('photo-dropzone');
        if (dz) dz.classList.remove('dragover');
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        const dz = document.getElementById('photo-dropzone');
        if (dz) dz.classList.remove('dragover');
        if (window.currentView !== 'editor' || window.editorState.step !== 5) return;
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        const remaining = 10 - (window.editorState.data.photos ? window.editorState.data.photos.length : 0);
        const toAdd = files.slice(0, remaining);
        toAdd.forEach(f => {
            const url = URL.createObjectURL(f);
            window.editorState.data.photos.push({ url, file: f });
        });
        renderEditor();
    });
});

// ── Globals ──────────────────────────────────────────────────
window.renderEditor = renderEditor;
window.gotoStep = gotoStep;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.handlePhotoSelect = handlePhotoSelect;
window.removePhoto = removePhoto;
window.createAndPublish = createAndPublish;
window.searchOnMap = searchOnMap;
