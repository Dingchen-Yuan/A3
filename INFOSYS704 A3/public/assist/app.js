const STEPS = [
  [1, 'Track my order'],
  [2, 'Understand what is happening'],
  [3, 'Identify a delivery problem'],
  [4, 'Choose what to do'],
  [5, 'Track the recovery'],
  [6, 'Complete refund/replacement']
];

const view = document.querySelector('#view');
let selectedOption = null;
let selectedOptionOrder = null;
let viewToken = 0;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function money(n, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(n) || 0);
}

function orderPath(id, screen) {
  return '#/order/' + encodeURIComponent(id) + (screen ? '/' + screen : '');
}

const ICONS = {
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  right: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2L12 3zm0 6v4m0 4h.01"/>',
  lamp: '<path d="m8 3-4 10h16L16 3H8zm4 10v7m-4 1h8"/>',
  textile: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18m4-18v18m4-18v18M4 16h16"/>'
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;
}

function productIcon(name) {
  if (/lamp/i.test(name)) return 'lamp';
  return /towel|throw|cover/i.test(name) ? 'textile' : 'box';
}

async function api(path, opts) {
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Please try that again.');
  return data;
}

function progress(step, total = 6) {
  if (!step) return '';
  const label = STEPS[step - 1][1];
  return `
    <div class="progress" data-step="${step}" aria-label="Step ${step} of ${total}, ${esc(label)}">
      <div class="progress-label"><span>Step ${step} of ${total}</span><strong>${esc(label)}</strong></div>
      <div class="bar" aria-hidden="true"><i style="width:${Math.round(step / total * 100)}%"></i></div>
    </div>`;
}

function updateJourney(step) {
  const list = document.querySelector('#journeyList');
  if (!list) return;
  list.innerHTML = STEPS.map(([number, label]) => `
    <li class="${number === step ? 'current' : number < step ? 'done' : ''}" ${number === step ? 'aria-current="step"' : ''}>
      <span class="journey-number" aria-hidden="true">${number < step ? icon('check') : String(number).padStart(2, '0')}</span>
      <span>${esc(label)}</span>
    </li>`).join('');
}

function actions(html, extraClass = '') {
  return `<div class="actions${extraClass ? ' ' + esc(extraClass) : ''}">${html}</div>`;
}

function paint(html, keepScroll) {
  view.innerHTML = `<div class="view">${html}</div>`;
  updateJourney(Number(view.querySelector('.progress')?.dataset.step) || 1);
  if (keepScroll) return;
  const phone = document.querySelector('#phone');
  if (phone) phone.scrollTop = 0;
  window.scrollTo(0, 0);
  const heading = view.querySelector('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function route() {
  let parts;
  try {
    parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch (err) {
    return showHome('That order link is not valid. Please search for your order again.');
  }
  const [head, id, screen] = parts;
  // Keep old Supply Hub bookmarks working after Delivery Assist becomes home.
  if (['mixlock', 'line', 'adjust', 'confirm', 'locked', 'deliveries', 'delivery', 'case', 'history'].includes(head)) {
    location.replace('/supply-hub' + location.hash);
    return;
  }
  if (head === 'order' && id && screen) return showScreen(id, screen);
  if (head === 'order' && id) return showScreen(id, 'understand');
  return showHome();
}

async function showHome(message) {
  const token = ++viewToken;
  selectedOption = null;
  selectedOptionOrder = null;
  let orders = [];
  let error = message || '';
  try {
    const data = await api('/api/assist/orders');
    orders = data.orders;
  } catch (err) {
    error = err.message;
  }
  if (token !== viewToken) return;
  const cards = orders.map(order => `
    <a class="card-link" href="${orderPath(order.id)}">
      <div class="order-card-top"><span class="product-icon">${icon(productIcon(order.item))}</span><span class="order-reference">${esc(order.customerReference || order.id)}</span>${icon('right')}</div>
      <strong>${esc(order.item)}</strong>
      ${order.source === 'sap' ? `<div class="meta">Sales order ${esc(order.salesOrder)}</div>` : ''}
      <div class="meta">Promised ${esc(order.promise)}</div>
      <div class="order-status"><span class="pill ${order.tone === 'problem' ? 'problem' : 'ok'}">${esc(order.summary)}</span>
      ${order.caseLabel ? `<span class="pill ${order.caseStatus === 'closed' ? 'ok' : 'problem'}">${esc(order.caseLabel)}</span>` : ''}</div>
    </a>`).join('');
  paint(`
    ${progress(1)}
    <p class="kicker">Your orders</p>
    <h1>Track my order</h1>
    <p class="lead">See where your order is. If it is delayed or something has gone wrong, choose what to do, then finish with a refund or a replacement.</p>
    <div class="tracking-panel">
      <label class="field-label" for="q">Find your order</label>
      <form class="search" id="find">
        <div class="search-field">${icon('search')}<input id="q" name="q" inputmode="text" autocomplete="off" aria-describedby="orderHint" placeholder="Order or sales order number" /></div>
        <button class="btn" type="submit">Track order ${icon('right')}</button>
      </form>
      <p class="field-hint" id="orderHint">Use the order number from your confirmation email, or choose an order below.</p>
    </div>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <div class="section-heading"><h2>Recent orders</h2><span>${orders.length} orders</span></div>
    <div class="cards order-grid">${cards || '<div class="empty-state">No orders are available right now. Try an order number above.</div>'}</div>`);
  document.querySelector('#find').addEventListener('submit', async event => {
    event.preventDefault();
    const q = document.querySelector('#q').value.trim();
    if (!q) return;
    try {
      const order = await api('/api/assist/orders/' + encodeURIComponent(q));
      location.hash = '#/order/' + encodeURIComponent(order.id);
    } catch (err) {
      showHome(err.message);
    }
  });
}

async function load(id) {
  return api('/api/assist/orders/' + encodeURIComponent(id));
}

async function showScreen(id, screen) {
  const token = ++viewToken;
  let order;
  try {
    order = await load(id);
  } catch (err) {
    return showHome(err.message);
  }
  if (token !== viewToken) return;
  if (screen === 'problem') return renderProblem(order);
  if (screen === 'choose') return renderChoose(order);
  if (screen === 'recovery') return renderRecovery(order);
  if (screen === 'outcome') return renderOutcome(order);
  return renderUnderstand(order);
}

function itemList(order) {
  return order.items.map(item => `
    <div class="fact">
      <span>${(item.affectedQty != null ? item.affectedQty > 0 : item.damaged) ? 'Needs attention' : 'In this order'}</span>
      <strong>${esc(item.name)}</strong>
      <span>${esc(item.qty)} ${Number(item.qty) === 1 ? 'unit' : 'units'} · ${money(item.lineTotal != null ? item.lineTotal : item.price * item.qty, order.currency)}</span>
    </div>`).join('');
}

function timeline(order) {
  return `<ol class="timeline">${order.events.map(event => `
    <li class="${esc(event.state)}">
      <strong>${esc(event.title)}</strong>
      <span class="when">${esc(event.at)}</span>
    </li>`).join('')}</ol>`;
}

function recoveryItems(items, currency, partial) {
  if (!items || !items.length) return '';
  return `<section class="detail-section recovery-scope"><h2 class="section-title">Items in this recovery</h2>
    <ul class="recovery-items">${items.map(item => `<li><div><strong>${esc(item.name)}</strong><span>${esc(item.qty)} of ${esc(item.orderedQty)} units affected</span></div><span>${money(item.amount, currency)}</span></li>`).join('')}</ul>
    ${partial ? '<p class="field-hint">Other items and units in the order stay unchanged.</p>' : ''}</section>`;
}

function renderUnderstand(order) {
  const existing = order.recoveryCase;
  const problem = order.problem;
  const closed = existing && existing.status === 'closed';
  const sourceSummary = order.source === 'sap'
    ? `${order.cached ? 'Saved SAP order snapshot' : 'Order read from SAP'}${order.sapReadAt ? ' · ' + new Date(order.sapReadAt).toLocaleString('en-AU') : ''}. Amounts are SAP net line values. Delivery milestones are not a live carrier feed.`
    : 'Demo order and delivery timeline.';
  let next = '';
  let banner = '';
  if (closed) {
    next = `<a class="btn block" href="${orderPath(order.id, 'outcome')}">View the outcome</a>`;
    banner = `<div class="banner">This recovery is finished. <a href="${orderPath(order.id, 'outcome')}">View the outcome</a>.</div>`;
  } else if (existing) {
    next = `<a class="btn block" href="${orderPath(order.id, 'recovery')}">Continue your recovery</a>`;
    banner = `<div class="banner">A recovery is already open for this order. <a href="${orderPath(order.id, 'recovery')}">Continue it</a>.</div>`;
  } else if (problem) {
    next = `<a class="btn block" href="${orderPath(order.id, 'problem')}">See the problem</a>`;
  } else {
    next = `<button class="btn secondary block" type="button" id="wrong">Something’s wrong</button>`;
  }
  paint(`
    ${progress(2)}
    <h1>${esc(order.headline)}</h1>
    <p class="lead">${esc(order.customer)}, this is home delivery to ${esc(order.address)}. Promised ${esc(order.promise)}.</p>
    ${banner}
    <section class="detail-section"><h2 class="section-title">Delivery timeline</h2>${timeline(order)}</section>
    <section class="detail-section"><h2 class="section-title">Items in this order</h2><div class="facts">${itemList(order)}</div></section>
    <section class="detail-section"><h2 class="section-title">Order details</h2><div class="facts">
      <div class="fact"><span>Order reference</span><strong>${esc(order.customerReference || order.id)}</strong></div>
      <div class="fact"><span>Sales order</span><strong>${esc(order.salesOrder)}</strong></div>
      <div class="fact"><span>Delivery</span><strong>${esc(order.outboundDelivery || '—')}</strong></div>
      <div class="fact"><span>Freight order</span><strong>${esc(order.freightOrder || '—')}</strong></div>
      <div class="fact"><span>Packed at</span><strong>${esc(order.node)}</strong></div>
    </div></section>
    <details class="integration-info"><summary>SAP connection details</summary><p class="meta">${esc(sourceSummary)}</p><p class="meta" id="sapline" data-order="${esc(order.id)}">Checking the SAP sales-order API…</p></details>
    ${actions(`${next}<a class="text-btn" href="#/">Back to my orders</a>`)}
    `);
  api('/api/assist/sap/sales-orders').then(sap => {
    const line = document.querySelector('#sapline');
    if (!line || line.dataset.order !== order.id) return;
    if (sap.ok) {
      line.textContent = `SAP ${sap.api} returned ${sap.count} sales orders ($top=${sap.top}, $expand=${sap.expand}).`;
      return;
    }
    if (!sap.configured) {
      line.textContent = `SAP ${sap.api} is called with $top=${sap.top}, $select and $expand=${sap.expand}. Add the lab API key to read the sandbox.`;
      return;
    }
    line.textContent = `SAP ${sap.api} responded ${sap.status || 'without data'}. The order on this screen stays available.`;
  }).catch(() => {
    const line = document.querySelector('#sapline');
    if (line && line.dataset.order === order.id) line.textContent = 'The SAP sales-order read could not be reached. This order is still available.';
  });
  const wrong = document.querySelector('#wrong');
  if (!wrong) return;
  wrong.addEventListener('click', () => { location.hash = orderPath(order.id, 'problem'); });
}

function renderProblem(order) {
  if (order.recoveryCase) {
    location.hash = orderPath(order.id, order.recoveryCase.status === 'closed' ? 'outcome' : 'recovery');
    return;
  }
  const initialCode = order.problem ? order.problem.code : '';
  const scoped = code => ['DAMAGED', 'MISSING'].includes(code);
  const initialItems = scoped(initialCode) ? (order.affectedItems || order.items.flatMap((item, index) =>
    initialCode === 'DAMAGED' && item.damaged ? [{ itemId: item.itemId || 'line-' + (index + 1), qty: item.qty }] : [])) : [];
  const initial = new Map(initialItems.map(item => [item.itemId, item.qty]));
  const rows = order.items.map((item, index) => {
    const id = item.itemId || 'line-' + (index + 1);
    const picked = initial.has(id);
    const qty = picked ? initial.get(id) : Math.min(1, item.qty);
    return `<div class="problem-item ${picked ? 'selected' : ''}" data-index="${index}">
      <label class="problem-item-label"><input class="affected-check" type="checkbox" value="${esc(id)}" ${picked ? 'checked' : ''}>
        <span><strong>${esc(item.name)}</strong><span class="meta">${esc(item.qty)} ordered · ${money(item.lineTotal != null ? item.lineTotal : item.price * item.qty, order.currency)}</span></span></label>
      <label class="quantity-label">Quantity affected<input class="affected-qty" type="number" min="${Number.isInteger(item.qty) ? 1 : 0}" max="${item.qty}" step="${Number.isInteger(item.qty) ? 1 : 'any'}" value="${qty}" aria-label="Quantity affected for ${esc(item.name)}" ${picked ? '' : 'disabled'}></label>
    </div>`;
  }).join('');
  paint(`
    ${progress(3)}
    <div class="issue-symbol" aria-hidden="true">${icon('alert')}</div>
    <h1>${order.problem ? 'Confirm the delivery problem' : 'What went wrong with your delivery?'}</h1>
    <p class="lead">Choose the issue. For damaged or missing items, select exactly which items and quantities need a recovery.</p>
    ${order.problem ? `<div class="banner">Current update: ${esc(order.problem.detail)}<br>Found ${esc(order.problem.foundAt)}. Order ${esc(order.customerReference || order.id)}.</div>` : ''}
    <form id="problemForm" class="problem-form">
      <label class="field-label" for="problemCode">What happened?</label>
      <select class="problem-select" id="problemCode" required>
        <option value="">Choose a delivery problem</option>
        ${[['DELAY', 'It’s delayed'], ['FAILED_ATTEMPT', 'It hasn’t arrived / delivery attempt failed'], ['DAMAGED', 'Something arrived damaged'], ['MISSING', 'An item is missing']].map(([code, label]) => `<option value="${code}" ${initialCode === code ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <fieldset class="affected-picker" id="affectedPicker"><legend>Which items are affected?</legend><p class="field-hint">Choose each affected item and enter no more than the quantity ordered. You’ll review the exact recovery value on the next screen.</p>${rows}</fieldset>
      <p class="field-hint" id="selectionHint" role="status" aria-live="polite"></p>
      <p class="error" id="problemError" role="alert" hidden></p>
      ${actions(`<button class="btn block" id="reviewProblem" type="submit">Review recovery options</button><a class="text-btn" href="${orderPath(order.id)}">Back</a>`)}
    </form>`);
  const form = document.querySelector('#problemForm');
  const codeInput = document.querySelector('#problemCode');
  const picker = document.querySelector('#affectedPicker');
  const button = document.querySelector('#reviewProblem');
  let submitting = false;
  const readSelection = () => {
    const code = codeInput.value;
    const needsItems = scoped(code);
    picker.hidden = !needsItems;
    picker.disabled = !needsItems;
    const selected = [];
    let error = code ? '' : 'Choose what went wrong.';
    form.querySelectorAll('.problem-item').forEach(row => {
      const check = row.querySelector('.affected-check');
      const input = row.querySelector('.affected-qty');
      const item = order.items[Number(row.dataset.index)];
      const qty = Number(input.value);
      input.disabled = !needsItems || !check.checked;
      row.classList.toggle('selected', check.checked);
      const invalid = needsItems && check.checked && (!input.value || !Number.isFinite(qty) || qty <= 0 || qty > item.qty || (Number.isInteger(item.qty) && !Number.isInteger(qty)));
      input.setAttribute('aria-invalid', String(Boolean(invalid)));
      if (needsItems && check.checked) selected.push({ itemId: check.value, qty });
      if (invalid) error = `Enter a valid quantity for ${item.name}, up to ${item.qty} ordered.`;
    });
    if (needsItems && !selected.length) error = 'Choose at least one affected item.';
    document.querySelector('#selectionHint').textContent = error || (needsItems ? 'Only the selected items and quantities will be included.' : 'This issue applies to the whole delivery.');
    button.disabled = submitting || Boolean(error);
    return { code, selected, valid: !error };
  };
  form.addEventListener('input', () => { document.querySelector('#problemError').hidden = true; readSelection(); });
  codeInput.addEventListener('change', () => {
    form.querySelectorAll('.problem-item').forEach(row => {
      row.querySelector('.affected-check').checked = false;
      row.querySelector('.affected-qty').value = Math.min(1, order.items[Number(row.dataset.index)].qty);
    });
    readSelection();
  });
  form.addEventListener('change', readSelection);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = readSelection();
    if (!selected.valid || submitting) return;
    const token = viewToken;
    submitting = true; readSelection();
    const body = { code: selected.code };
    if (scoped(selected.code)) body.affectedItems = selected.selected;
    try {
      await api(`/api/assist/orders/${encodeURIComponent(order.id)}/problem`, { method: 'POST', body: JSON.stringify(body) });
      if (token === viewToken) { selectedOption = null; location.hash = orderPath(order.id, 'choose'); }
    } catch (err) {
      if (token !== viewToken) return;
      submitting = false; readSelection();
      const slot = document.querySelector('#problemError');
      slot.hidden = false; slot.textContent = err.message;
    }
  });
  readSelection();
}

function renderChoose(order, keepScroll) {
  if (!order.problem) {
    location.hash = `#/order/${encodeURIComponent(order.id)}`;
    return;
  }
  if (order.recoveryCase) {
    location.hash = orderPath(order.id, order.recoveryCase.status === 'closed' ? 'outcome' : 'recovery');
    return;
  }
  if (order.requiresItemSelection || !order.options.length) {
    location.hash = orderPath(order.id, 'problem');
    return;
  }
  if (selectedOptionOrder !== order.id || !order.options.some(option => option.id === selectedOption)) {
    const recommended = order.options.find(option => option.recommended);
    selectedOption = recommended ? recommended.id : (order.options[0] && order.options[0].id);
    selectedOptionOrder = order.id;
  }
  const choices = order.options.map(option => `
    <button class="choice ${option.id === selectedOption ? 'selected' : ''}" type="button" data-option="${esc(option.id)}" aria-pressed="${option.id === selectedOption}">
      <span class="choice-indicator" aria-hidden="true">${icon('check')}</span>
      ${option.recommended ? '<span class="badge">Recommended</span>' : ''}
      <strong>${esc(option.title)}</strong>
      <div class="meta">${esc(option.detail)}</div>
    </button>`).join('');
  const current = order.options.find(option => option.id === selectedOption);
  paint(`
    ${progress(4)}
    <h1>What would you like to do?</h1>
    <p class="lead">Pick one. You can still go back before anything is confirmed.</p>
    ${recoveryItems(order.affectedItems, order.currency, order.selectionIsPartial)}
    <div class="cards choice-grid" id="choices">${choices}</div>
    <p class="error" id="err" role="alert" hidden></p>
    ${actions(`
      <button class="btn block" type="button" id="go">${current && current.id === 'refund' ? 'Continue with refund' : 'Continue'}</button>
      <a class="text-btn" href="${orderPath(order.id, 'problem')}">Back</a>`)}`, keepScroll);
  document.querySelector('#choices').addEventListener('click', event => {
    const button = event.target.closest('[data-option]');
    if (!button) return;
    selectedOption = button.dataset.option;
    renderChoose(order, true);
  });
  document.querySelector('#go').addEventListener('click', async () => {
    const button = document.querySelector('#go');
    button.disabled = true;
    try {
      await api(`/api/assist/orders/${encodeURIComponent(order.id)}/recovery`, {
        method: 'POST',
        body: JSON.stringify({ optionId: selectedOption })
      });
      selectedOption = null;
      location.hash = `#/order/${encodeURIComponent(order.id)}/recovery`;
    } catch (err) {
      button.disabled = false;
      const slot = document.querySelector('#err');
      slot.hidden = false;
      slot.textContent = err.message;
    }
  });
}

function isRecoveryReady(recoveryCase) {
  return recoveryCase.status === 'ready' && recoveryCase.stepIndex === recoveryCase.steps.length - 1 && recoveryCase.readyForCompletion !== false;
}

function recoveryTime(value, fallback = 'Not checked yet') {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : fallback;
}

function recoveryDemoControls(recoveryCase, open = false) {
  if (!recoveryCase.demoControlsAvailable || recoveryCase.status === 'closed') return '';
  return `<details class="demo-controls" id="demoControls" ${open ? 'open' : ''}>
    <summary>Demo controls · presentation only</summary>
    <div class="demo-controls-body"><p>These controls simulate a supplier or fulfilment update. They are separate from customer status checking and do not send a live carrier update.</p>
      ${recoveryCase.demoAdvanceAllowed
        ? `<button class="btn secondary" id="advanceDemo" type="button">Advance demo to “${esc(recoveryCase.steps[recoveryCase.stepIndex + 1])}”</button>`
        : '<p class="field-hint">All demo updates have been applied. You can review the outcome above.</p>'}
    </div></details>`;
}

function readRecoveryStatus(caseId) {
  return api('/api/assist/cases/' + encodeURIComponent(caseId));
}

function applyDemoRecoveryUpdate(caseId) {
  return api('/api/assist/cases/' + encodeURIComponent(caseId) + '/advance', { method: 'POST' });
}

function renderRecovery(order, { message = '', demoOpen = false, keepScroll = false } = {}) {
  const recoveryCase = order.recoveryCase;
  if (!recoveryCase) {
    location.hash = `#/order/${encodeURIComponent(order.id)}/choose`;
    return;
  }
  if (recoveryCase.status === 'closed') {
    location.hash = `#/order/${encodeURIComponent(order.id)}/outcome`;
    return;
  }
  const ready = isRecoveryReady(recoveryCase);
  const steps = recoveryCase.steps.map((label, index) => {
    const cls = index < recoveryCase.stepIndex ? 'done' : index === recoveryCase.stepIndex ? 'now' : '';
    const mark = index < recoveryCase.stepIndex ? '✓' : index + 1;
    return `<li class="${cls}"><div class="mark" aria-hidden="true">${mark}</div><p><strong>${esc(label)}</strong></p></li>`;
  }).join('');
  paint(`
    ${progress(5)}
    <h1>${esc(recoveryCase.steps[recoveryCase.stepIndex])}</h1>
    <p class="lead">Case ${esc(recoveryCase.id)}. This stays here until the recovery is finished.</p>
    <p class="field-hint">${recoveryCase.isSimulated ? 'This is a simulated recovery.' : 'Showing the saved recovery status; no live carrier feed is connected.'} Refreshing status never moves the recovery forward.</p>
    <dl class="tracking-times"><div><dt>Last updated</dt><dd id="lastUpdated">${esc(recoveryTime(recoveryCase.updatedAt || recoveryCase.createdAt, 'Not available'))}</dd></div>
      <div><dt>Last checked</dt><dd id="lastChecked">${esc(recoveryTime(order.recoveryCheckedAt))}</dd></div></dl>
    ${recoveryItems(recoveryCase.affectedItems, recoveryCase.currency || order.currency, recoveryCase.selectionIsPartial)}
    <ol class="steps">${steps}</ol>
    <p class="tracking-feedback" id="trackingFeedback" role="status" aria-live="polite" ${message ? '' : 'hidden'}>${esc(message)}</p>
    <p class="error" id="err" role="alert" hidden></p>
    ${actions(`
      ${ready ? `<a class="btn block" id="reviewOutcome" href="${orderPath(order.id, 'outcome')}">Review the outcome</a>` : ''}
      <button class="btn ${ready ? 'secondary ' : ''}block" type="button" id="refreshRecovery">Refresh status</button>
      <button class="text-btn" type="button" id="restart">Start this order again</button>`, 'tracking-actions')}
    ${recoveryDemoControls(recoveryCase, demoOpen)}`, keepScroll);
  let busy = false;
  const setBusy = value => {
    busy = value;
    ['#refreshRecovery', '#advanceDemo', '#restart'].forEach(selector => {
      const button = document.querySelector(selector);
      if (button) button.disabled = value;
    });
  };
  const refresh = async advanceDemo => {
    if (busy || (advanceDemo && !recoveryCase.demoAdvanceAllowed)) return;
    const token = viewToken;
    const demoWasOpen = Boolean(document.querySelector('#demoControls')?.open);
    setBusy(true);
    document.querySelector('#err').hidden = true;
    document.querySelector('#trackingFeedback').hidden = true;
    try {
      const latest = advanceDemo ? await applyDemoRecoveryUpdate(recoveryCase.id) : await readRecoveryStatus(recoveryCase.id);
      if (token !== viewToken) return;
      const updated = latest.recoveryCase;
      const changed = !updated || updated.id !== recoveryCase.id || updated.stepIndex !== recoveryCase.stepIndex || updated.status !== recoveryCase.status || updated.updatedAt !== recoveryCase.updatedAt;
      const feedback = advanceDemo
        ? 'Demo update applied. This was a simulated update, not a live supplier or carrier event.'
        : changed ? 'Recovery status updated.' : 'No new updates. Your recovery status has not changed.';
      renderRecovery(latest, { message: feedback, demoOpen: demoWasOpen, keepScroll: true });
      if (updated && updated.status !== 'closed') {
        document.querySelector(advanceDemo ? '#advanceDemo, #reviewOutcome, #refreshRecovery' : '#refreshRecovery')?.focus({ preventScroll: true });
      }
    } catch (err) {
      if (token !== viewToken) return;
      setBusy(false);
      const slot = document.querySelector('#err');
      slot.hidden = false;
      slot.textContent = `Could not ${advanceDemo ? 'apply the demo update' : 'refresh status'}. ${err.message} The last shown status and checked time have been kept.`;
    }
  };
  document.querySelector('#refreshRecovery').addEventListener('click', () => refresh(false));
  document.querySelector('#advanceDemo')?.addEventListener('click', () => refresh(true));
  bindRestart(order.id);
}

function outcomeText(recoveryCase, order) {
  if (recoveryCase.outcomeCopy) return recoveryCase.outcomeCopy;
  const item = (order.items.find(entry => entry.damaged) || order.items[0]).name;
  const closed = recoveryCase.status === 'closed';
  if (recoveryCase.outcome === 'refund') {
    const partial = recoveryCase.amount > 0 && recoveryCase.amount < order.total;
    const lead = recoveryCase.detail || (partial
      ? 'That item only, back to your original payment. The rest of the order stays as it is.'
      : 'Back to your original payment. This order will not be delivered.');
    return {
      heading: closed ? `${money(recoveryCase.amount, recoveryCase.currency || order.currency)} refund confirmed` : `Refund ${money(recoveryCase.amount, recoveryCase.currency || order.currency)}`,
      lead,
      confirm: 'Confirm refund'
    };
  }
  if (recoveryCase.outcome === 'replacement') {
    const damaged = order.items.some(entry => entry.damaged);
    return {
      heading: closed ? 'Replacement confirmed' : 'Replacement tomorrow, 5–8pm',
      lead: damaged
        ? `A new ${item} will go to the same address. Keep or discard the damaged one.`
        : `A new ${item} will go to the same address. You don’t need to call us.`,
      confirm: 'Confirm replacement'
    };
  }
  if (recoveryCase.outcome === 'collection') {
    return {
      heading: closed ? 'Collection confirmed' : 'Collect from Kmart Broadway',
      lead: 'Service desk, Bay Street, from 10am tomorrow. Bring this order number.',
      confirm: 'Confirm collection'
    };
  }
  return {
    heading: closed ? 'Redelivery confirmed' : 'Redelivery tomorrow, 5–8pm',
    lead: 'Same address. No extra charge.',
    confirm: 'Confirm redelivery'
  };
}

function renderOutcome(order) {
  const recoveryCase = order.recoveryCase;
  if (!recoveryCase) {
    location.hash = `#/order/${encodeURIComponent(order.id)}/choose`;
    return;
  }
  if (recoveryCase.status !== 'closed' && !isRecoveryReady(recoveryCase)) {
    location.hash = `#/order/${encodeURIComponent(order.id)}/recovery`;
    return;
  }
  const copy = outcomeText(recoveryCase, order);
  const last = recoveryCase.requests[recoveryCase.requests.length - 1];
  const closed = recoveryCase.status === 'closed';
  paint(`
    ${progress(6)}
    ${closed ? '<div class="done-mark" aria-hidden="true">✓</div>' : ''}
    <h1>${esc(copy.heading)}</h1>
    <p class="lead">${esc(copy.lead)}</p>
    ${recoveryItems(recoveryCase.affectedItems, recoveryCase.currency || order.currency, recoveryCase.selectionIsPartial)}
    <div class="facts">
      <div class="fact"><span>Case</span><strong>${esc(recoveryCase.id)}</strong></div>
      <div class="fact"><span>Sales order</span><strong>${esc(order.salesOrder)}</strong></div>
    </div>
    <details>
      <summary>SAP service request</summary>
      <pre>${esc(JSON.stringify(last.body, null, 2))}</pre>
    </details>
    <p class="error" id="err" role="alert" hidden></p>
    ${actions(closed
      ? `<a class="btn block" href="#/">Back to my orders</a><button class="text-btn" type="button" id="restart">Start this order again</button>`
      : `<button class="btn block" type="button" id="confirm">${esc(copy.confirm)}</button><a class="text-btn" href="${orderPath(order.id, 'recovery')}">Back</a>`)}`);
  const confirm = document.querySelector('#confirm');
  if (confirm) {
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        await api(`/api/assist/cases/${encodeURIComponent(recoveryCase.id)}/complete`, { method: 'POST' });
        showScreen(order.id, 'outcome');
      } catch (err) {
        confirm.disabled = false;
        const slot = document.querySelector('#err');
        slot.hidden = false;
        slot.textContent = err.message;
      }
    });
  }
  bindRestart(order.id);
}

function bindRestart(id) {
  const button = document.querySelector('#restart');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/assist/orders/${encodeURIComponent(id)}/reset`, { method: 'POST' });
    } catch (err) {
      button.disabled = false;
      return;
    }
    selectedOption = null;
    const next = `#/order/${encodeURIComponent(id)}`;
    if (location.hash === next) route();
    else location.hash = next;
  });
}

window.addEventListener('hashchange', route);
route();
