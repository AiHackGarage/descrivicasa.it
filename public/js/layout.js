/**
 * layout.js — Struttura generale della pagina (principio DRY).
 *
 * UNICA fonte di verità per la topbar (menu di navigazione) e il pannello
 * profilo: genera markup + CSS e li inietta dinamicamente. Nessuna copia
 * nelle singole pagine: ogni pagina contiene solo il proprio contenuto e
 * carica questo file prima di topbar.js / init.js.
 *
 * Contesto:
 *   <body data-app="spa">    → SPA (index.html): navigazione via navigateTo()
 *   <body data-app="static"> → pagine statiche: navigazione via href
 *
 * Gestisce anche il fallback showModal/closeModal per le pagine statiche
 * senza modali auth (redirige a /?show=login).
 *
 * Caricato come script SYNC (non module) PRIMA di topbar.js / init.js.
 */
(function () {
  'use strict';

  var body = document.body;
  if (!body) return;
  var isSpa = body.getAttribute('data-app') === 'spa';

  // ── 1. CSS unico (topbar + pannello profilo + cronologia) ──
  var style = document.createElement('style');
  style.textContent = [
    '/* ── Top Bar (da layout.js — unica fonte) ── */',
    '.topbar { display: flex; align-items: center; gap: 20px; padding: 12px 24px;',
    '  background: white; border-bottom: 1px solid #e8e8ed; position: sticky; top: 0; z-index: 100; }',
    '.topbar-logo { font-size: 1.1rem; font-weight: 700; text-decoration: none; color: #1d1d1f; margin-right: auto; cursor: pointer; }',
    '.topbar-links a { color: #86868b; text-decoration: none; font-size: 0.9rem; margin: 0 10px; cursor: pointer; }',
    '.topbar-links a:hover { color: #1d1d1f; }',
    '.topbar-auth, .topbar-user { display: flex; align-items: center; gap: 8px; }',
    '.btn-auth { padding: 6px 16px; border: 1px solid #d2d2d7; border-radius: 20px; background: white;',
    '  color: #1d1d1f; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; }',
    '.btn-auth:hover { background: #f5f5f7; }',
    '.btn-auth-primary { background: #667eea; color: white; border-color: #667eea; }',
    '.btn-auth-primary:hover { background: #5a6fd6; }',
    '.user-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; cursor: pointer; }',
    '.user-trigger { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 8px; border-radius: 8px; transition: background 0.2s; }',
    '.user-trigger:hover { background: #f5f5f7; }',
    '.user-name { font-size: 0.85rem; color: #1d1d1f; font-weight: 500; cursor: pointer; }',
    '.user-arrow { font-size: 0.7rem; color: #86868b; transition: transform 0.2s; }',
    '.user-arrow.open { transform: rotate(180deg); }',
    '.user-generations { font-size: 0.75rem; color: #86868b; background: #f5f5f7; padding: 2px 10px; border-radius: 12px; }',
    '/* ── Profile Panel (da layout.js — unica fonte) ── */',
    '.profile-panel { position: fixed; top: 60px; right: 20px; width: 340px; max-height: calc(100vh - 80px);',
    '  overflow-y: auto; background: white; border-radius: 14px; box-shadow: 0 8px 40px rgba(0,0,0,0.15);',
    '  z-index: 250; display: none; overflow: hidden; }',
    '.profile-panel.open { display: block; }',
    '.profile-header { display: flex; align-items: center; gap: 14px; padding: 20px; background: #f8f8fa; }',
    '.profile-header img { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }',
    '.profile-name { font-weight: 600; font-size: 1rem; }',
    '.profile-email { font-size: 0.8rem; color: #86868b; margin-top: 2px; }',
    '.profile-body { padding: 16px 20px; }',
    '.profile-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }',
    '.profile-row:last-child { border-bottom: none; }',
    '.profile-label { font-size: 0.85rem; color: #86868b; }',
    '.profile-value { font-size: 0.85rem; font-weight: 500; color: #1d1d1f; }',
    '.profile-footer { display: flex; gap: 10px; padding: 14px 20px; border-top: 1px solid #f0f0f0; }',
    '.profile-btn { flex: 1; padding: 9px 16px; background: linear-gradient(135deg, #667eea, #764ba2); color: white;',
    '  border: none; border-radius: 10px; font-size: 0.85rem; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }',
    '.profile-btn:hover { opacity: 0.9; }',
    '.profile-btn-outline { background: white; color: #1d1d1f; border: 1px solid #d2d2d7; }',
    '.profile-btn-outline:hover { background: #f5f5f7; }',
    '/* ── Cronologia (solo SPA) ── */',
    '.history-section { margin-top: 16px; padding: 16px 20px; border-top: 1px solid #f0f0f0; }',
    '.history-title { font-size: 0.85rem; font-weight: 600; margin-bottom: 10px; color: #1d1d1f; }',
    '.history-item { padding: 10px 12px; background: #f8f8fa; border-radius: 10px; margin-bottom: 8px; cursor: pointer; transition: background 0.2s; }',
    '.history-item:hover { background: #f0f0ff; }',
    '.history-item .h-date { font-size: 0.75rem; color: #86868b; }',
    '.history-item .h-text { font-size: 0.82rem; color: #1d1d1f; margin-top: 4px; display: -webkit-box;',
    '  -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '.history-empty { font-size: 0.82rem; color: #86868b; text-align: center; padding: 20px 0; }',
    '.history-loading { font-size: 0.8rem; color: #86868b; text-align: center; padding: 10px 0; }',
    '/* ── Mobile ── */',
    '@media (max-width: 600px) {',
    '  .topbar { flex-wrap: wrap; gap: 8px; padding: 10px 16px; }',
    '  .topbar-links { display: none; }',
    '  .profile-panel { right: 10px; width: calc(100% - 20px); }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // ── 2. Markup topbar (navigazione adattata al contesto) ──
  var logoTag = isSpa
    ? '<a class="topbar-logo" onclick="navigateTo(\'landing\')">🏠 DescriviCasa.it</a>'
    : '<a class="topbar-logo" href="/">🏠 DescriviCasa.it</a>';
  var homeTag = isSpa
    ? '<a onclick="navigateTo(\'landing\')">Home</a>'
    : '<a href="/">Home</a>';

  var topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.innerHTML =
    logoTag +
    '<div class="topbar-links">' + homeTag + '<a href="/pricing">Prezzi</a></div>' +
    '<div class="topbar-auth" id="topbar-auth">' +
    '  <button class="btn-auth" onclick="showModal(\'login\')">Accedi</button>' +
    '  <button class="btn-auth btn-auth-primary" onclick="showModal(\'register\')">Registrati</button>' +
    '</div>' +
    '<div class="topbar-user" id="topbar-user" style="display:none">' +
    '  <div class="user-trigger" onclick="toggleProfile()">' +
    '    <img id="user-avatar" class="user-avatar" src="" alt="">' +
    '    <span id="user-name" class="user-name"></span>' +
    '    <span class="user-generations" id="user-generations"></span>' +
    '    <span class="user-arrow">▾</span>' +
    '  </div>' +
    '  <button class="btn-auth" onclick="logout()">Esci</button>' +
    '</div>';

  // ── 3. Markup pannello profilo (cronologia solo nella SPA) ──
  var panel = document.createElement('div');
  panel.className = 'profile-panel';
  panel.id = 'profile-panel';
  panel.innerHTML =
    '<div class="profile-header">' +
    '  <img id="profile-avatar" src="" alt="" onerror="this.src=\'/favicon.png\'">' +
    '  <div><div class="profile-name" id="profile-name"></div><div class="profile-email" id="profile-email"></div></div>' +
    '</div>' +
    '<div class="profile-body">' +
    '  <div class="profile-row"><span class="profile-label">Piano</span><span class="profile-value" id="profile-plan"></span></div>' +
    '  <div class="profile-row" id="profile-renewal-row" style="display:none"><span class="profile-label">Rinnovo</span><span class="profile-value" id="profile-renewal"></span></div>' +
    '</div>' +
    '<div class="profile-footer">' +
    '  <a href="/pricing" class="profile-btn" id="profile-btn-pricing">Vedi piani ➤</a>' +
    '  <button class="profile-btn profile-btn-outline" id="profile-btn-manage" style="display:none" onclick="openCustomerPortal()">⚙️ Gestisci abbonamento</button>' +
    '  <button class="profile-btn profile-btn-outline" onclick="logout(); toggleProfile();">Esci</button>' +
    '</div>' +
    (isSpa
      ? '<div class="history-section" id="history-section">' +
        '<div class="history-title">📜 Ultime descrizioni</div>' +
        '<div class="history-loading" id="history-loading">Caricamento...</div>' +
        '<div id="history-list"></div></div>'
      : '');

  // ── 4. Iniezione (topbar in cima al body) ──
  body.insertBefore(topbar, body.firstChild);
  body.appendChild(panel);

  // ── 5. Fallback auth modals per pagine statiche senza modali ──
  // Se la pagina non definisce showModal/closeModal (es. privacy, termini),
  // reindirizza alla home con il modal aperto (?show=login|register).
  if (typeof window.showModal !== 'function') {
    window.showModal = function (type) {
      window.location.href = '/?show=' + (type === 'register' ? 'register' : 'login');
    };
  }
  if (typeof window.closeModal !== 'function') {
    window.closeModal = function () {};
  }
})();
