(function () {
  'use strict';
  if (document.querySelector('#kmChat')) return;
  const chatIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></svg>';
  const root = document.createElement('div');
  root.id = 'kmChat'; root.className = 'km-chat';
  root.innerHTML = `<button class="km-chat-launcher" id="kmChatLauncher" type="button" aria-controls="kmChatPanel" aria-expanded="false" aria-label="Open Kmart Assist chat">${chatIcon}<span>Need help?</span></button>
    <section class="km-chat-panel" id="kmChatPanel" role="dialog" aria-labelledby="kmChatTitle" tabindex="-1" hidden>
      <div class="km-chat-header"><div class="km-chat-avatar" aria-hidden="true">${chatIcon}</div><div class="km-chat-title"><h2 id="kmChatTitle">Kmart Assist</h2><p class="km-chat-mode" id="kmChatMode">Delivery &amp; recovery support</p></div>
        <button class="km-chat-icon-btn" id="kmChatNew" type="button" aria-label="Start a new chat" title="Start a new chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg></button>
        <button class="km-chat-icon-btn" id="kmChatClose" type="button" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
      <p class="km-chat-notice" id="kmChatNotice">Loading chat settings…</p>
      <details class="km-chat-context" id="kmChatContext"><summary id="kmChatContextLabel">Include an order (optional)</summary><div class="km-chat-context-body">
        <label for="kmChatOrder">Order or sales-order reference</label><div class="km-chat-context-row"><input id="kmChatOrder" type="text" maxlength="100" autocomplete="off" placeholder="e.g. KM185164" aria-describedby="kmChatContextHint"><button class="km-chat-current" id="kmChatCurrent" type="button" hidden>Use this order</button></div>
        <small id="kmChatContextHint">Only saved status, product quantities and amounts are included—not customer names, addresses or staff notes.</small></div></details>
      <div class="km-chat-log" id="kmChatLog" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions"></div>
      <div class="km-chat-suggestions" id="kmChatSuggestions"><button type="button">Where is my order?</button><button type="button">Damaged or missing items</button><button type="button">Refunds &amp; replacements</button></div>
      <p class="km-chat-status" id="kmChatStatus" role="status" hidden>Preparing a reply…</p>
      <p class="km-chat-error" id="kmChatError" role="alert" hidden></p><button class="km-chat-retry" id="kmChatRetry" type="button" hidden>Retry connection</button>
      <form class="km-chat-form" id="kmChatForm"><label class="km-chat-input-label" for="kmChatInput">How can we help?</label><div class="km-chat-compose"><textarea id="kmChatInput" rows="1" maxlength="1200" placeholder="Ask about a delivery or recovery…" required aria-describedby="kmChatCounter"></textarea><button class="km-chat-send" id="kmChatSend" type="submit" aria-label="Send message" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/></svg></button></div><div class="km-chat-form-meta"><span>Enter to send · Shift + Enter for a new line</span><span id="kmChatCounter">0 / 1200</span></div></form>
    </section>`;
  document.body.append(root);
  const find = id => root.querySelector('#' + id);
  const panel = find('kmChatPanel'), launcher = find('kmChatLauncher'), log = find('kmChatLog');
  const input = find('kmChatInput'), orderInput = find('kmChatOrder'), send = find('kmChatSend');
  let config = null, loading = null, history = [], conversationRef = '', busy = false, generation = 0, controller = null;

  function message(role, content, mode, actions = []) {
    const item = document.createElement('div'); item.className = 'km-chat-message' + (role === 'user' ? ' km-chat-user' : '');
    const label = document.createElement('strong'); label.textContent = role === 'user' ? 'You' : 'Kmart Assist' + (mode === 'ai' ? ' · AI' : mode === 'guided' ? ' · Guide' : '');
    const text = document.createElement('p'); text.textContent = content;
    item.append(label, text);
    const navigation = document.createElement('div'); navigation.className = 'km-chat-links';
    for (const action of Array.isArray(actions) ? actions.slice(0, 2) : []) {
      try {
        const url = new URL(action.href, location.origin);
        if (url.origin !== location.origin || !['/', '/supply-hub', '/recovery-management'].includes(url.pathname)) continue;
        const link = document.createElement('a'); link.href = url.pathname + url.search + url.hash;
        link.textContent = String(action.label || 'Open page').slice(0, 80); navigation.append(link);
      } catch (error) { /* Ignore invalid navigation; never execute model text. */ }
    }
    if (navigation.childElementCount) item.append(navigation);
    log.append(item); log.scrollTop = log.scrollHeight;
    return item;
  }
  function welcome() { message('assistant', 'Hi! I can explain delivery updates, damaged or missing items, and refund or replacement requests. I can guide you, but cannot change an order.'); }
  function update() {
    input.disabled = busy; orderInput.disabled = busy; find('kmChatCurrent').disabled = busy;
    send.disabled = busy || !config || !input.value.trim();
    find('kmChatStatus').hidden = !busy;
    find('kmChatCounter').textContent = input.value.length + ' / ' + input.maxLength;
    find('kmChatContextLabel').textContent = orderInput.value.trim() ? 'Order: ' + orderInput.value.trim() : 'Include an order (optional)';
    find('kmChatSuggestions').querySelectorAll('button').forEach(button => { button.disabled = busy || !config; });
  }
  function showMode(mode) {
    find('kmChatMode').textContent = mode === 'ai' ? 'AI assistant · Google Gemini' : 'Guided help';
    find('kmChatNotice').textContent = mode === 'ai'
      ? 'AI can make mistakes. Messages and any order status you include are sent to Google Gemini. Do not send personal or payment details.'
      : 'AI is not connected. Replies use local guided help. Do not send personal or payment details.';
  }
  async function readJson(response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Chat is unavailable. Please try again.');
    return data;
  }
  function error(message) { find('kmChatError').hidden = false; find('kmChatError').textContent = message; }
  async function loadConfig() {
    if (config) return;
    if (loading) return loading;
    find('kmChatError').hidden = true; find('kmChatRetry').hidden = true;
    loading = (async () => {
      try {
        const data = await readJson(await fetch('/api/chat/config', { signal: AbortSignal.timeout(8000) }));
        if (!['ai', 'guided'].includes(data.mode)) throw new Error('Chat settings are unavailable.');
        config = data; input.maxLength = data.maxMessageLength || 1200; showMode(data.mode);
      } catch (failure) {
        find('kmChatNotice').textContent = 'Chat is temporarily unavailable.';
        error('Could not connect to chat. Please retry.'); find('kmChatRetry').hidden = false;
      } finally { loading = null; update(); }
    })();
    return loading;
  }
  function setOpen(open) {
    panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open));
    if (open) { loadConfig(); input.focus({ preventScroll: true }); }
    else launcher.focus({ preventScroll: true });
  }
  function clearChat({ keepDraft = false, keepContext = false } = {}) {
    generation += 1; controller?.abort(); controller = null; busy = false; history = [];
    if (!keepDraft) input.value = '';
    if (!keepContext) { orderInput.value = ''; find('kmChatContext').open = false; }
    conversationRef = orderInput.value.trim(); log.replaceChildren(); welcome();
    find('kmChatError').hidden = true; find('kmChatSuggestions').hidden = false; update();
  }
  function currentOrder() {
    const match = location.hash.match(/^#\/order\/([^/]+)/);
    try { return match ? decodeURIComponent(match[1]) : ''; } catch (error) { return ''; }
  }
  function updateCurrentOrder() {
    const id = currentOrder(); find('kmChatCurrent').hidden = !id;
    find('kmChatCurrent').textContent = id ? 'Use ' + id : 'Use this order';
  }
  find('kmChatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const draft = input.value.trim(), orderRef = orderInput.value.trim();
    if (busy || !config || !draft || draft.length > input.maxLength) return;
    if (history.length && conversationRef !== orderRef) clearChat({ keepDraft: true, keepContext: true });
    conversationRef = orderRef;
    const userMessage = { role: 'user', content: draft };
    const messages = [...history.slice(-8), userMessage];
    while (messages.reduce((sum, entry) => sum + entry.content.length, 0) > 12000 && messages.length > 1) messages.splice(0, 2);
    const request = ++generation; controller = new AbortController(); const pendingController = controller;
    const timeout = setTimeout(() => pendingController.abort(), 20000);
    busy = true; find('kmChatError').hidden = true; find('kmChatSuggestions').hidden = true;
    const bubble = message('user', draft); input.value = ''; update();
    try {
      const data = await readJson(await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: pendingController.signal,
        body: JSON.stringify({ messages, ...(orderRef ? { orderRef } : {}) }) }));
      if (request !== generation) return;
      if (typeof data.message !== 'string' || !data.message.trim() || !['ai', 'guided'].includes(data.mode)) throw new Error('Chat returned an invalid reply. Please try again.');
      config.mode = data.mode; showMode(data.mode);
      message('assistant', data.message, data.mode, data.actions);
      history = [...messages, { role: 'assistant', content: data.message }].slice(-8);
    } catch (failure) {
      if (request !== generation) return;
      bubble.remove(); input.value = draft;
      error(failure.name === 'AbortError' ? 'The reply took too long. Your message is ready to retry.' : failure.message);
    } finally {
      clearTimeout(timeout);
      if (request === generation) { controller = null; busy = false; update(); if (!panel.hidden) input.focus({ preventScroll: true }); }
    }
  });
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  find('kmChatClose').addEventListener('click', () => setOpen(false));
  find('kmChatNew').addEventListener('click', () => { clearChat(); input.focus(); });
  find('kmChatRetry').addEventListener('click', loadConfig);
  find('kmChatCurrent').addEventListener('click', () => { orderInput.value = currentOrder(); if (history.length) clearChat({ keepDraft: true, keepContext: true }); update(); });
  input.addEventListener('input', update); orderInput.addEventListener('input', update);
  orderInput.addEventListener('change', () => { if (history.length && conversationRef !== orderInput.value.trim()) clearChat({ keepDraft: true, keepContext: true }); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); find('kmChatForm').requestSubmit(); } });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } });
  find('kmChatSuggestions').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { input.value = button.textContent; update(); find('kmChatForm').requestSubmit(); }));
  window.addEventListener('hashchange', updateCurrentOrder);
  window.addEventListener('kmart:demo-reset', () => clearChat());
  welcome(); updateCurrentOrder(); update();
})();
