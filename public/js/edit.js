// ── Single-page property editor ───────────────────────────────
import { escapeHtml, getMaxPhotos, propertyUrl } from './utils.js';
import { navigateTo } from './navigation.js';
import { handleAuthError } from './auth.js';

// ── Entry point ───────────────────────────────────────────────

export function loadEditPage(uuid) {
    window.editState.uuid = uuid;
    navigateTo('edit');
    const content = document.getElementById('edit-content');
    content.innerHTML = '<div style="text-align:center;padding:60px"><div class="spinner"></div><p style="color:#86868b">Caricamento dati...</p></div>';

    fetch('/api/p/' + uuid)
        .then(r => r.json())
        .then(data => {
            if (data.error) { content.innerHTML = '<div class="error-msg show">' + data.error + '</div>'; return; }
            const p = data.property || data;
            window.editState.id = p.id;
            window.editState.data = {
                contract: p.contract_type === 'sell' ? 'vendita' : 'affitto',
                type: p.property_type || 'Appartamento',
                price: p.price || '',
                condominium: p.condo_fees || '',
                address: p.address || '',
                city: p.city || '',
                province: p.province || '',
                lat: parseFloat(p.latitude) || 41.9028,
                lng: parseFloat(p.longitude) || 12.4964,
                surface: p.surface || '',
                rooms: p.rooms || '',
                bedrooms: p.bedrooms || '',
                bathrooms: p.bathrooms || '',
                floor: p.floor !== null && p.floor !== undefined ? p.floor : '',
                total_floors: p.total_floors || '',
                elevator: !!p.elevator,
                condition: p.building_state || 'Nuovo',
                energy_class: p.energy_class || 'A4',
                heating: p.heating || 'Autonomo',
                air_conditioning: !!p.air_conditioning,
                exposure: p.exposure || '',
                balcony: p.balcony_sqm || '',
                garden: p.garden_sqm || '',
                parking: !!p.parking,
                basement: !!p.basement,
                furnished: p.furnished || 'no',
                year_built: p.year_built || '',
                description: p.description || '',
                title: p.title || '',
                phone: p.agent_phone || '',
                email: p.agent_email || '',
                photos: typeof p.photos === 'string' ? (() => { try { return JSON.parse(p.photos); } catch (e) { return []; } })() : (p.photos || [])
            };
            window.editState.originalType = window.editState.data.type;
            renderEditPage();
            setTimeout(initEditMap, 200);
        })
        .catch(err => {
            content.innerHTML = '<div class="error-msg show">Errore: ' + err.message + '</div>';
        });
}

export function renderEditPage() {
    const d = window.editState.data;
    const content = document.getElementById('edit-content');

    const typeOptions = ['Appartamento', 'Villa', 'Schiera', 'Attico', 'Monolocale', 'Ufficio', 'Negozio', 'Terreno', 'Magazzino', 'Box', 'Fabbricato'];
    const stateOptions = ['Nuovo', 'Ristrutturato', 'Abitabile', 'Da ristrutturare'];
    const energyOptions = ['A4', 'A3', 'A2', 'A1', 'B', 'C', 'D', 'E', 'F', 'G'];
    const heatingOptions = ['Autonomo', 'Centralizzato', 'Riscaldamento a pavimento', 'Stufa'];
    const furnishedOptions = ['no', 'yes', 'partial'];

    const photosHtml = d.photos && d.photos.length > 0
        ? '<div class="photo-preview-grid">' + d.photos.map((p, i) => {
            const src = typeof p === 'string' ? p : (p.url || '');
            return '<div class="photo-preview-item"><img src="' + src + '" alt=""><button class="photo-remove" onclick="removeEditPhoto(' + i + ')">✕</button></div>';
        }).join('') + '</div>'
        : '<p style="color:#86868b;font-size:0.85rem">Nessuna foto caricata</p>';

    let html = '';

    // Section 1: Tipo e Prezzo
    html += '<div class="edit-section">';
    html += '<h3>💰 Tipo e Prezzo</h3>';
    html += '<div class="form-group"><label>Contratto</label><div class="toggle-group">';
    html += '<button class="toggle-btn ' + (d.contract === 'vendita' ? 'active' : '') + '" onclick="window.editState.data.contract=\'vendita\';window.renderEditPage()">Vendita</button>';
    html += '<button class="toggle-btn ' + (d.contract === 'affitto' ? 'active' : '') + '" onclick="window.editState.data.contract=\'affitto\';window.renderEditPage()">Affitto</button>';
    html += '</div></div>';
    html += '<div class="form-group"><label>Tipo immobile</label><select onchange="window.editState.data.type=this.value;window.renderEditPage()">';
    typeOptions.forEach(t => html += '<option value="' + t + '"' + (d.type === t ? ' selected' : '') + '>' + t + '</option>');
    html += '</select></div>';
    html += '<div class="form-group"><label>Prezzo (€)</label><input type="number" value="' + d.price + '" onchange="window.editState.data.price=this.value" placeholder="es. 250000"></div>';
    if (d.contract === 'vendita') {
        const residentialTypes = ['Appartamento', 'appartamento', 'apartment', 'Villa', 'villa', 'Schiera', 'schiera', 'Attico', 'attico', 'Monolocale', 'monolocale'];
        const feesLabel = residentialTypes.includes(d.type) ? 'Spese condominiali mensili (€)' : 'Spese extra mensili (€)';
        html += '<div class="form-group"><label>' + feesLabel + '</label><input type="number" value="' + d.condominium + '" onchange="window.editState.data.condominium=this.value" placeholder="es. 150"></div>';
    }
    html += '</div>';

    // Section 2: Posizione
    html += '<div class="edit-section">';
    html += '<h3>📍 Posizione</h3>';
    html += '<div class="form-group"><label>Indirizzo</label><input type="text" value="' + escapeHtml(d.address) + '" onchange="window.editState.data.address=this.value" placeholder="es. Via Roma, 12"></div>';
    html += '<div class="form-row"><div class="form-group"><label>Città</label><input type="text" value="' + escapeHtml(d.city) + '" onchange="window.editState.data.city=this.value" placeholder="es. Roma"></div>';
    html += '<div class="form-group"><label>Provincia</label><input type="text" value="' + escapeHtml(d.province) + '" onchange="window.editState.data.province=this.value" placeholder="es. RM"></div></div>';
    html += '<div id="edit-map" style="height:250px;border-radius:12px;margin-top:12px"></div>';
    html += '<div class="map-coords" style="font-size:0.8rem;color:#86868b;margin-top:6px">Lat: ' + d.lat.toFixed(5) + ', Lng: ' + d.lng.toFixed(5);
    html += ' <button class="btn-secondary" onclick="searchEditMap()" style="padding:4px 12px;font-size:0.8rem">🔍 Cerca</button></div>';
    html += '</div>';

    // Section 3: Caratteristiche
    html += '<div class="edit-section">';
    html += '<h3>📐 Caratteristiche</h3>';
    html += '<div class="form-row three"><div class="form-group"><label>Superficie (mq)</label><input type="number" value="' + d.surface + '" onchange="window.editState.data.surface=this.value" placeholder="es. 100"></div>';
    html += '<div class="form-group"><label>Locali</label><input type="number" value="' + d.rooms + '" onchange="window.editState.data.rooms=this.value" placeholder="es. 5"></div>';
    html += '<div class="form-group"><label>Camere da letto</label><input type="number" value="' + d.bedrooms + '" onchange="window.editState.data.bedrooms=this.value" placeholder="es. 2"></div></div>';
    html += '<div class="form-row three"><div class="form-group"><label>Bagni</label><input type="number" value="' + d.bathrooms + '" onchange="window.editState.data.bathrooms=this.value" placeholder="es. 2"></div>';
    html += '<div class="form-group"><label>Piano</label><input type="number" value="' + d.floor + '" onchange="window.editState.data.floor=this.value" placeholder="es. 3"></div>';
    html += '<div class="form-group"><label>Totale piani</label><input type="number" value="' + d.total_floors + '" onchange="window.editState.data.total_floors=this.value" placeholder="es. 6"></div></div>';
    html += '<div class="form-row"><div class="form-group"><label class="checkbox-label"><input type="checkbox" ' + (d.elevator ? 'checked' : '') + ' onchange="window.editState.data.elevator=this.checked"><span>Ascensore</span></label></div>';
    html += '<div class="form-group"><label>Stato</label><select onchange="window.editState.data.condition=this.value">';
    stateOptions.forEach(s => html += '<option value="' + s + '"' + (d.condition === s ? ' selected' : '') + '>' + s + '</option>');
    html += '</select></div></div></div>';

    // Section 4: Dettagli
    html += '<div class="edit-section">';
    html += '<h3>🔧 Dettagli extra</h3>';
    html += '<div class="form-row"><div class="form-group"><label>Classe energetica</label><select onchange="window.editState.data.energy_class=this.value">';
    energyOptions.forEach(c => html += '<option value="' + c + '"' + (d.energy_class === c ? ' selected' : '') + '>' + c + '</option>');
    html += '</select></div><div class="form-group"><label>Riscaldamento</label><select onchange="window.editState.data.heating=this.value">';
    heatingOptions.forEach(h => html += '<option value="' + h + '"' + (d.heating === h ? ' selected' : '') + '>' + h + '</option>');
    html += '</select></div></div>';
    html += '<div class="form-row three"><div class="form-group"><label>Esposizione</label><input type="text" value="' + escapeHtml(d.exposure) + '" onchange="window.editState.data.exposure=this.value" placeholder="es. Nord"></div>';
    html += '<div class="form-group"><label>Balcone/Terrazzo (mq)</label><input type="number" value="' + d.balcony + '" onchange="window.editState.data.balcony=this.value" placeholder="es. 20"></div>';
    html += '<div class="form-group"><label>Giardino (mq)</label><input type="number" value="' + d.garden + '" onchange="window.editState.data.garden=this.value" placeholder="es. 50"></div></div>';
    html += '<div class="form-row three"><div class="form-group"><label class="checkbox-label"><input type="checkbox" ' + (d.air_conditioning ? 'checked' : '') + ' onchange="window.editState.data.air_conditioning=this.checked"><span>Aria condizionata</span></label></div>';
    html += '<div class="form-group"><label class="checkbox-label"><input type="checkbox" ' + (d.parking ? 'checked' : '') + ' onchange="window.editState.data.parking=this.checked"><span>Posto auto</span></label></div>';
    html += '<div class="form-group"><label class="checkbox-label"><input type="checkbox" ' + (d.basement ? 'checked' : '') + ' onchange="window.editState.data.basement=this.checked"><span>Cantina</span></label></div></div>';
    html += '<div class="form-row"><div class="form-group"><label>Arredato</label><select onchange="window.editState.data.furnished=this.value">';
    html += '<option value="no"' + (d.furnished === 'no' ? ' selected' : '') + '>No</option>';
    html += '<option value="yes"' + (d.furnished === 'yes' ? ' selected' : '') + '>Sì</option>';
    html += '<option value="partial"' + (d.furnished === 'partial' ? ' selected' : '') + '>Parzialmente</option>';
    html += '</select></div><div class="form-group"><label>Anno costruzione</label><input type="number" value="' + d.year_built + '" onchange="window.editState.data.year_built=this.value" placeholder="es. 2005" min="1800" max="2030"></div></div>';
    html += '</div>';

    // Section 5: Descrizione e Titolo
    html += '<div class="edit-section">';
    html += '<h3>📝 Descrizione e Titolo</h3>';
    html += '<p class="sub">Personalizza la descrizione e il titolo dell\'annuncio</p>';
    html += '<div class="form-group"><label>Titolo annuncio</label><input type="text" value="' + escapeHtml(d.title || '') + '" onchange="window.editState.data.title=this.value" placeholder="es. Appartamento luminoso in zona Prati"></div>';
    html += '<div class="form-group"><label>Descrizione</label><textarea style="width:100%;min-height:200px;padding:12px;border:1px solid #d2d2d7;border-radius:10px;font-family:inherit;font-size:0.95rem;line-height:1.7;resize:vertical" onchange="window.editState.data.description=this.value" placeholder="Scrivi o modifica la descrizione dell\'immobile...">' + escapeHtml(d.description || '') + '</textarea></div>';
    html += '</div>';

    // Section 6: Contatti
    html += '<div class="edit-section">';
    html += '<h3>📞 Contatti</h3>';
    html += '<p class="sub">Recapiti che appariranno nella pagina pubblica dell\'annuncio</p>';
    html += '<div class="form-row"><div class="form-group"><label>Telefono</label><input type="text" id="edit-phone" value="' + escapeHtml(d.phone || '') + '" onchange="window.editState.data.phone=this.value;window.validateContactField()" onblur="window.validateContactField()" placeholder="es. +39 123 456 7890"><span class="field-error" id="err-phone" style="display:none;color:#e74c3c;font-size:0.8rem"></span></div>';
    html += '<div class="form-group"><label>Email</label><input type="email" id="edit-email-contact" value="' + escapeHtml(d.email || '') + '" onchange="window.editState.data.email=this.value;window.validateContactField()" onblur="window.validateContactField()" placeholder="es. info@agenzia.it"><span class="field-error" id="err-email" style="display:none;color:#e74c3c;font-size:0.8rem"></span></div></div>';
    html += '</div>';

    // Section 7: Foto
    html += '<div class="edit-section">';
    html += '<h3>📸 Foto</h3>';
    html += '<div class="photo-dropzone" onclick="document.getElementById(\'edit-photo-input\').click()"><div class="dz-icon">📷</div><p>Clicca per aggiungere foto</p><p style="font-size:0.75rem;color:#e8a838;margin-top:4px">⚠️ No planimetrie o documenti</p></div>';
    html += '<input type="file" id="edit-photo-input" multiple accept="image/*" style="display:none" onchange="handleEditPhotoSelect(event)">';
    html += photosHtml;
    html += '</div>';

    // Save bar
    html += '<div class="edit-save-bar">';
    html += '<button class="btn-secondary" onclick="window.location.href=\'' + propertyUrl(window.editState.uuid, d.title || d.description) + '\'">Annulla</button>';
    html += '<button class="btn-primary" onclick="saveEditPage()">💾 Salva modifiche</button>';
    html += '</div>';

    content.innerHTML = html;
    window.scrollTo(0, 0);
}

// ── Photo management ──────────────────────────────────────────

export function handleEditPhotoSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const remaining = getMaxPhotos() - (window.editState.data.photos ? window.editState.data.photos.length : 0);
    files.slice(0, remaining).forEach(f => {
        window.editState.data.photos.push({ url: URL.createObjectURL(f), file: f, isNew: true });
    });
    renderEditPage();
    setTimeout(initEditMap, 200);
}

export function removeEditPhoto(idx) {
    window.editState.data.photos.splice(idx, 1);
    renderEditPage();
    setTimeout(initEditMap, 200);
}

// ── Map ──────────────────────────────────────────────────────

export function initEditMap() {
    const mapDiv = document.getElementById('edit-map');
    if (!mapDiv) return;
    if (window.editMap) { try { window.editMap.remove(); } catch (e) { } window.editMap = null; window.editMarker = null; }
    const d = window.editState.data;
    window.editMap = L.map('edit-map').setView([d.lat, d.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(window.editMap);
    window.editMarker = L.marker([d.lat, d.lng], { draggable: true }).addTo(window.editMap);
    window.editMarker.on('dragend', (e) => {
        window.editState.data.lat = e.target.getLatLng().lat;
        window.editState.data.lng = e.target.getLatLng().lng;
        updateEditCoords();
    });
    window.editMap.on('click', (e) => {
        window.editState.data.lat = e.latlng.lat;
        window.editState.data.lng = e.latlng.lng;
        window.editMarker.setLatLng(e.latlng);
        updateEditCoords();
    });
}

function updateEditCoords() {
    const d = window.editState.data;
    const mc = document.querySelector('#view-edit .map-coords');
    if (mc) mc.innerHTML = 'Lat: ' + d.lat.toFixed(5) + ', Lng: ' + d.lng.toFixed(5) + ' <button class="btn-secondary" onclick="searchEditMap()" style="padding:4px 12px;font-size:0.8rem">🔍 Cerca</button>';
}

export function searchEditMap() {
    const d = window.editState.data;
    const query = (d.address + ', ' + d.city + ', ' + d.province).trim();
    if (!query || query === ', , ') { alert('Inserisci un indirizzo prima di cercare'); return; }
    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&limit=1&accept-language=it')
        .then(r => r.json())
        .then(data => {
            if (data && data.length > 0) {
                window.editState.data.lat = parseFloat(data[0].lat);
                window.editState.data.lng = parseFloat(data[0].lon);
                if (window.editMarker) window.editMarker.setLatLng([window.editState.data.lat, window.editState.data.lng]);
                if (window.editMap) window.editMap.setView([window.editState.data.lat, window.editState.data.lng], 15);
                updateEditCoords();
            } else { alert('Nessun risultato trovato'); }
        })
        .catch(err => alert('Errore: ' + err.message));
}

// ── Validation ────────────────────────────────────────────────

export function validateContactField() {
    const phoneEl = document.getElementById('edit-phone');
    const emailEl = document.getElementById('edit-email-contact');
    let valid = true;

    if (phoneEl && phoneEl.value.trim()) {
        const phoneVal = phoneEl.value.trim();
        const errEl = document.getElementById('err-phone');
        const phoneRegex = /^\+?(\d[\s.-]?){6,15}$/;
        if (!phoneRegex.test(phoneVal)) {
            if (errEl) { errEl.textContent = 'Numero non valido (es. +39 123 456 7890)'; errEl.style.display = 'block'; }
            phoneEl.style.borderColor = '#e74c3c';
            valid = false;
        } else {
            if (errEl) errEl.style.display = 'none';
            phoneEl.style.borderColor = '';
        }
    } else {
        if (phoneEl) { phoneEl.style.borderColor = ''; const errEl = document.getElementById('err-phone'); if (errEl) errEl.style.display = 'none'; }
    }

    if (emailEl && emailEl.value.trim()) {
        const emailVal = emailEl.value.trim();
        const errEl = document.getElementById('err-email');
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!emailRegex.test(emailVal)) {
            if (errEl) { errEl.textContent = 'Email non valida (es. nome@dominio.it)'; errEl.style.display = 'block'; }
            emailEl.style.borderColor = '#e74c3c';
            valid = false;
        } else {
            if (errEl) errEl.style.display = 'none';
            emailEl.style.borderColor = '';
        }
    } else {
        if (emailEl) { emailEl.style.borderColor = ''; const errEl = document.getElementById('err-email'); if (errEl) errEl.style.display = 'none'; }
    }

    return valid;
}

// ── Save ─────────────────────────────────────────────────────

export async function saveEditPage() {
    const d = window.editState.data;
    const btn = document.querySelector('#view-edit .btn-primary');

    if (!validateContactField()) {
        alert('Correggi i campi contatti (telefono o email non validi) prima di salvare.');
        return;
    }

    const typeChanged = (d.type || '').toLowerCase() !== (window.editState.originalType || '').toLowerCase();
    if (typeChanged) {
        const confirmed = confirm('🔄 Hai cambiato il tipo di immobile.\n\nQuesta modifica comporta la creazione di una nuova descrizione AI (consuma 1 credito).\n\nProcedere?');
        if (!confirmed) {
            d.type = window.editState.originalType;
            renderEditPage();
            return;
        }
    }

    btn.textContent = '⏳ Salvataggio...';
    btn.disabled = true;

    try {
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
            furnished: d.furnished || 'no',
            year_built: d.year_built || null,
            price: d.price || null,
            condo_fees: d.condominium || null,
            title: d.title || null,
            description: d.description || null,
            agent_phone: d.phone || null,
            agent_email: d.email || null,
        }));

        if (d.photos) {
            d.photos.forEach(ph => {
                if (ph.isNew && ph.file) formData.append('files', ph.file);
            });
        }

        const res = await fetch('/api/properties/' + window.editState.id, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + window.authToken },
            body: formData
        });
        const data = await res.json();
        if (data.error) { alert(data.error); btn.textContent = '💾 Salva modifiche'; btn.disabled = false; return; }

        if (typeChanged) {
            btn.textContent = '🤖 Generazione nuova descrizione...';
            const genRes = await fetch('/api/properties/' + window.editState.id + '/generate', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + window.authToken }
            });
            const genData = await genRes.json();
            if (genData.error) {
                if (genRes.status === 403) {
                    alert('⚠️ Crediti insufficienti!\n\n' + genData.error + '\n\n💡 Vai alla pagina Piani per ricaricare o passare a un piano superiore.');
                } else {
                    alert('Errore nella generazione della descrizione: ' + genData.error);
                }
                btn.textContent = '💾 Salva modifiche';
                btn.disabled = false;
                return;
            }
            if (genData.title) d.title = genData.title;
            if (genData.description) d.description = genData.description;
        }

        window.location.href = propertyUrl(window.editState.uuid, d.title || d.description);
    } catch (err) {
        alert('Errore: ' + err.message);
        btn.textContent = '💾 Salva modifiche';
        btn.disabled = false;
    }
}

// ── Globals ──────────────────────────────────────────────────
window.loadEditPage = loadEditPage;
window.renderEditPage = renderEditPage;
window.handleEditPhotoSelect = handleEditPhotoSelect;
window.removeEditPhoto = removeEditPhoto;
window.initEditMap = initEditMap;
window.searchEditMap = searchEditMap;
window.saveEditPage = saveEditPage;
window.validateContactField = validateContactField;
