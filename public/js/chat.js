// ── Chat widget self-contained ──────────────────────────────────
// Crea il DOM della chat (CSS + markup) dinamicamente e lo inietta
// nel body. Una sola copia del codice: basta caricare questo file
// in ogni pagina (<script type="module" src="/js/chat.js">).
// Funziona anche per utenti NON loggati (/api/chat non richiede auth).
// ────────────────────────────────────────────────────────────────

(function () {
  // ── 1. CSS ──
  const style = document.createElement('style');
  style.textContent = `
    .chat-bubble {
        position: fixed; bottom: 24px; right: 24px;
        width: 56px; height: 56px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 1.5rem; cursor: pointer;
        box-shadow: 0 4px 20px rgba(102,126,234,0.4);
        z-index: 300; transition: transform 0.2s;
    }
    .chat-bubble:hover { transform: scale(1.1); }
    .chat-bubble.open { display: none; }
    .chat-panel {
        position: fixed; bottom: 24px; right: 24px;
        width: 360px; max-height: 500px;
        background: white; border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.15);
        z-index: 300; display: none;
        flex-direction: column; overflow: hidden;
    }
    .chat-panel.open { display: flex; }
    .chat-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white; font-weight: 600; font-size: 0.9rem;
    }
    .chat-close { background: none; border: none; color: white; font-size: 1.1rem; cursor: pointer; opacity: 0.8; }
    .chat-close:hover { opacity: 1; }
    .chat-messages {
        flex: 1; padding: 14px; overflow-y: auto; max-height: 340px;
        display: flex; flex-direction: column; gap: 10px;
    }
    .chat-msg {
        max-width: 85%; padding: 10px 14px;
        border-radius: 14px; font-size: 0.88rem; line-height: 1.4; white-space: pre-wrap;
    }
    .chat-msg.bot { background: #f0f0ff; color: #1d1d1f; align-self: flex-start; border-bottom-left-radius: 4px; }
    .chat-msg.user { background: #667eea; color: white; align-self: flex-end; border-bottom-right-radius: 4px; }
    .chat-msg.typing { background: #f0f0ff; color: #86868b; align-self: flex-start; font-style: italic; }
    .chat-input-area { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #e8e8ed; }
    .chat-input {
        flex: 1; padding: 10px 14px; border: 1px solid #d2d2d7;
        border-radius: 20px; font-size: 0.88rem; outline: none;
    }
    .chat-input:focus { border-color: #667eea; }
    .chat-send {
        width: 38px; height: 38px; background: #667eea;
        color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 1rem;
    }
    .chat-send:hover { background: #5a6fd6; }
    @media (max-width: 480px) {
        .chat-panel { width: calc(100vw - 32px); max-height: 60vh; }
    }
  `;
  document.head.appendChild(style);

  // ── 2. Markup ──
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.id = 'chat-bubble';
  bubble.textContent = '💬';
  bubble.setAttribute('role', 'button');
  bubble.setAttribute('aria-label', 'Apri assistente');

  const panel = document.createElement('div');
  panel.className = 'chat-panel';
  panel.id = 'chat-panel';
  panel.innerHTML = `
    <div class="chat-header">
        <span>🤖 Assistente DescriviCasa</span>
        <button class="chat-close" aria-label="Chiudi assistente">✕</button>
    </div>
    <div class="chat-messages" id="chat-messages">
        <div class="chat-msg bot">Ciao! Sono l'assistente di DescriviCasa.it. Come posso aiutarti? 🏠</div>
    </div>
    <div class="chat-input-area">
        <input type="text" class="chat-input" id="chat-input" placeholder="Scrivi un messaggio..." autocomplete="off">
        <button class="chat-send" aria-label="Invia messaggio">➤</button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  // ── 3. Stato ──
  // Inizializza lo storico (state.js lo fa solo nella SPA index.html)
  if (typeof window.chatHistory === 'undefined') {
    try {
      window.chatHistory = JSON.parse(localStorage.getItem('dc_chat') || '[]');
    } catch (e) {
      window.chatHistory = [];
    }
  }

  // ── 4. Logica ──
  function scrollChat() {
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function toggleChat() {
    const panelEl = document.getElementById('chat-panel');
    const bubbleEl = document.getElementById('chat-bubble');
    if (!panelEl || !bubbleEl) return;
    panelEl.classList.toggle('open');
    bubbleEl.classList.toggle('open');
    if (panelEl.classList.contains('open')) {
      scrollChat();
      const input = document.getElementById('chat-input');
      if (input) input.focus();
    }
  }

  function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const msgsDiv = document.getElementById('chat-messages');
    if (!msgsDiv) return;

    const userDiv = document.createElement('div');
    userDiv.className = 'chat-msg user';
    userDiv.textContent = text;
    msgsDiv.appendChild(userDiv);
    scrollChat();

    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-msg typing';
    typingDiv.textContent = '⏳ scrivendo...';
    msgsDiv.appendChild(typingDiv);
    scrollChat();

    window.chatHistory.push({ role: 'user', content: text });
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: window.chatHistory }),
    })
      .then((r) => r.json())
      .then((data) => {
        typingDiv.remove();
        if (data.reply) {
          window.chatHistory.push({ role: 'assistant', content: data.reply });
          try {
            localStorage.setItem('dc_chat', JSON.stringify(window.chatHistory.slice(-50)));
          } catch (e) { /* storage pieno: ignora */ }
          const botDiv = document.createElement('div');
          botDiv.className = 'chat-msg bot';
          botDiv.textContent = data.reply;
          msgsDiv.appendChild(botDiv);
          scrollChat();
        } else if (data.error) {
          const errDiv = document.createElement('div');
          errDiv.className = 'chat-msg bot';
          errDiv.textContent = '😕 ' + data.error;
          msgsDiv.appendChild(errDiv);
          scrollChat();
        }
      })
      .catch(() => {
        typingDiv.remove();
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-msg bot';
        errDiv.textContent = '😕 Errore di connessione. Riprova tra un momento.';
        msgsDiv.appendChild(errDiv);
        scrollChat();
      });
  }

  // Esponi globalmente (gli onclick inline nei vecchi HTML li usavano)
  window.toggleChat = toggleChat;
  window.sendChat = sendChat;

  // ── 5. Event listeners ──
  bubble.addEventListener('click', toggleChat);
  const closeBtn = panel.querySelector('.chat-close');
  if (closeBtn) closeBtn.addEventListener('click', toggleChat);
  const inputEl = panel.querySelector('.chat-input');
  if (inputEl) inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  const sendBtn = panel.querySelector('.chat-send');
  if (sendBtn) sendBtn.addEventListener('click', sendChat);
})();
