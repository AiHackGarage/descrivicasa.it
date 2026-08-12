/**
 * Standalone topbar — shared across all pages (pricing, property, privacy, termini).
 * NOT an ES module; loaded via <script src="/js/topbar.js">.
 * Provides: auth UI update, profile dropdown toggle, logout.
 *
 * Prerequisites (must exist in the page HTML):
 *   #topbar-auth      — auth buttons (Accedi / Registrati)
 *   #topbar-user      — user info (name, avatar, generations)
 *   #user-name, #user-avatar, #user-generations
 *   #profile-panel    — dropdown panel (optional, hidden if absent)
 *   #profile-avatar, #profile-name, #profile-email
 *   #profile-plan, #profile-remaining, #profile-since
 *   #profile-renewal-row (optional)
 *   #profile-btn-pricing, #profile-btn-manage (optional)
 *   #modal-overlay, #modal-login, #modal-register (optional, for auth modals)
 *
 * Also requires global functions: showModal(), closeModal() if modals are used.
 */

(function () {
  'use strict';

  var authToken = localStorage.getItem('dc_token');
  var currentUser = null;

  // ── Init: check auth on load ─────────────────────────────
  if (authToken) {
    fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + authToken } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.user) {
          currentUser = data.user;
          updateUI();
        } else {
          localStorage.removeItem('dc_token');
          authToken = null;
        }
      })
      .catch(function () {
        localStorage.removeItem('dc_token');
        authToken = null;
      });
  }

  // ── UI update ────────────────────────────────────────────
  function updateUI() {
    var authDiv = document.getElementById('topbar-auth');
    var userDiv = document.getElementById('topbar-user');
    if (!authDiv || !userDiv) return;

    if (authToken && currentUser) {
      authDiv.style.display = 'none';
      userDiv.style.display = 'flex';

      // Change Home → I miei immobili
      var homeLink = document.querySelector('.topbar-links a[href="/"], .topbar-links a[onclick*="landing"]');
      if (homeLink && !homeLink._renamed) {
        homeLink._originalText = homeLink.textContent;
        homeLink._renamed = true;
      }
      if (homeLink) homeLink.textContent = 'I miei immobili';

      var nameEl = document.getElementById('user-name');
      if (nameEl) nameEl.textContent = currentUser.name;

      var avatarEl = document.getElementById('user-avatar');
      if (avatarEl) {
        avatarEl.src = currentUser.avatar || '/favicon.png';
      }

      var genEl = document.getElementById('user-generations');
      if (genEl) {
        var remaining = currentUser.remaining !== undefined ? currentUser.remaining : '?';
        genEl.textContent = remaining + '/' + (currentUser.monthly_limit || 3);
      }
    } else {
      authDiv.style.display = 'flex';
      userDiv.style.display = 'none';
      // Restore original Home text
      var homeLink = document.querySelector('.topbar-links a[href="/"], .topbar-links a[onclick*="landing"]');
      if (homeLink && homeLink._renamed) {
        homeLink.textContent = 'Home';
      }
    }
  }

  // ── Profile toggle ───────────────────────────────────────
  window.toggleProfile = function () {
    var panel = document.getElementById('profile-panel');
    if (!panel) return;
    var arrow = document.querySelector('.user-arrow');
    panel.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
    if (panel.classList.contains('open') && currentUser) {
      loadProfile();
    }
  };

  function loadProfile() {
    if (!currentUser) return;
    var avatar = document.getElementById('profile-avatar');
    if (avatar) avatar.src = currentUser.avatar || '';
    var name = document.getElementById('profile-name');
    if (name) name.textContent = currentUser.name;
    var email = document.getElementById('profile-email');
    if (email) email.textContent = currentUser.email;

    var planNames = { free: 'Free', base: 'Base \u2014 \u20AC9/mese', pro: 'Pro \u2014 \u20AC29/mese' };
    var planEl = document.getElementById('profile-plan');
    if (planEl) planEl.textContent = planNames[currentUser.plan] || 'Free';

    // Renewal row: visible only for paid plans
    var renewalRow = document.getElementById('profile-renewal-row');
    if (renewalRow) {
      if (currentUser.plan === 'base' || currentUser.plan === 'pro') {
        renewalRow.style.display = '';
        var now = new Date();
        var endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        var renewalEl = document.getElementById('profile-renewal');
        if (renewalEl) renewalEl.textContent = endMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      } else {
        renewalRow.style.display = 'none';
      }
    }

    // Manage subscription button: only for paid plans
    var manageBtn = document.getElementById('profile-btn-manage');
    var pricingBtn = document.getElementById('profile-btn-pricing');
    if (currentUser.plan === 'base' || currentUser.plan === 'pro') {
      if (manageBtn) manageBtn.style.display = '';
      if (pricingBtn) pricingBtn.textContent = '\uD83D\uDD01 Cambia piano';
    } else {
      if (manageBtn) manageBtn.style.display = 'none';
      if (pricingBtn) pricingBtn.textContent = 'Vedi piani \u27A4';
    }
  }

  // ── Customer portal ──────────────────────────────────────
  window.openCustomerPortal = function () {
    var btn = document.getElementById('profile-btn-manage');
    if (btn) btn.textContent = '\u23F3 Apertura...';
    fetch('/api/stripe/customer-portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ returnUrl: window.location.href })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.url) {
          window.location.href = data.url;
        } else {
          alert(data.error || 'Errore apertura portale');
          if (btn) btn.textContent = '\u2699\uFE0F Gestisci abbonamento';
        }
      })
      .catch(function (err) {
        alert('Errore: ' + err.message);
        if (btn) btn.textContent = '\u2699\uFE0F Gestisci abbonamento';
      });
  };

  // ── Logout ───────────────────────────────────────────────
  window.logout = function () {
    localStorage.removeItem('dc_token');
    authToken = null;
    currentUser = null;
    window.location.href = '/';
  };

  // ── Close profile on outside click ───────────────────────
  document.addEventListener('click', function (e) {
    var panel = document.getElementById('profile-panel');
    var trigger = document.querySelector('.user-trigger');
    if (panel && panel.classList.contains('open') && trigger &&
        !trigger.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
      var arrow = document.querySelector('.user-arrow');
      if (arrow) arrow.classList.remove('open');
    }
  });

  // ── Expose ───────────────────────────────────────────────
  window.topbarUpdateUI = updateUI;
})();
