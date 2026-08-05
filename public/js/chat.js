// ── Chat widget ───────────────────────────────────────────────

export function toggleChat() {
    const panel = document.getElementById('chat-panel');
    const bubble = document.getElementById('chat-bubble');
    panel.classList.toggle('open');
    bubble.classList.toggle('open');
    if (panel.classList.contains('open')) {
        scrollChat();
        document.getElementById('chat-input').focus();
    }
}

function scrollChat() {
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
}

export function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const msgsDiv = document.getElementById('chat-messages');
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
    .then(r => r.json())
    .then(data => {
        typingDiv.remove();
        if (data.reply) {
            window.chatHistory.push({ role: 'assistant', content: data.reply });
            localStorage.setItem('dc_chat', JSON.stringify(window.chatHistory.slice(-50)));
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
        errDiv.textContent = '😕 Errore di connessione';
        msgsDiv.appendChild(errDiv);
        scrollChat();
    });
}

window.toggleChat = toggleChat;
window.sendChat = sendChat;
