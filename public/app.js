const STEPS = [
  [1, 'Track my order'],
  [2, 'Understand what is happening'],
  [3, 'Identify a delivery problem'],
  [4, 'Choose what to do'],
  [5, 'Track the recovery'],
  [6, 'Complete refund or replacement']
];

const view = document.querySelector('#view');
let selectedOption = null;
let busy = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function money(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n) || 0);
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
    <div class="progress" aria-label="Step ${step} of ${total}, ${esc(label)}">
      <div class="progress-label"><span>${step} of ${total}</span> ${esc(label)}</div>
      <div class="bar" aria-hidden="true"><i style="width:${Math.round(step / total * 100)}%"></i></div>
    </div>`;
}

function actions(html) {
  return `<div class="actions">${html}</div>`;
}

function paint(html, keepScroll) {
  view.innerHTML = `<div class="view">${html}</div>`;
  if (keepScroll) return;
  const phone = document.querySelector('#phone');
  if (phone) phone.scrollTop = 0;
  window.scrollTo(0, 0);
}

function route() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, id, screen] = parts;
  if (head === 'order' && id && screen) return showScreen(id, screen);
  if (head === 'order' && id) return showScreen(id, 'understand');
  return showHome();
}

async function showHome(message) {
  selectedOption = null;
  let orders = [];
  let error = message || '';
  try {
    const data = await api('/api/orders');
    orders = data.orders;
  } catch (err) {
    error = err.message;
  }
  const cards = orders.map(order => `
    <a class="card-link" href="#/order/${esc(order.id)}">
      <strong>${esc(order.item)}</strong>
      <div class="meta">${esc(order.id)} · ${esc(order.promise)}</div>
      <span class="pill ${order.tone === 'problem' ? 'problem' : 'ok'}">${esc(order.summary)}</span>
    </a>`).join('');
  paint(`
    <p class="kicker">Your orders</p>
    <h1>Track my order</h1>
    <p class="lead">See where it is. If delivery goes wrong, choose what happens next.</p>
    <form class="search" id="find">
      <label class="sr" for="q" style="position:absolute;left:-999px">Order number</label>
      <input id="q" name="q" inputmode="text" autocomplete="off" placeholder="Order or sales order number" />
      <button class="btn" type="submit">Track</button>
    </form>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <h2 class="section-title">Recent orders</h2>
    <div class="cards">${cards}</div>`);
  document.querySelector('#find').addEventListener('submit', async event => {
    event.preventDefault();
    const q = document.querySelector('#q').value.trim();
    if (!q) return;
    try {
      const order = await api('/api/orders/' + encodeURIComponent(q));
      location.hash = '#/order/' + encodeURIComponent(order.id);
    } catch (err) {
      showHome(err.message);
    }
  });
}

async function load(id) {
  return api('/api/orders/' + encodeURIComponent(id));
}

async function showScreen(id, screen) {
  let order;
  try {
    order = await load(id);
  } catch (err) {
    return showHome(err.message);
  }
  if (screen === 'problem') return renderProblem(order);
  if (screen === 'choose') return renderChoose(order);
  if (screen === 'recovery') return renderRecovery(order);
  if (screen === 'outcome') return renderOutcome(order);
  return renderUnderstand(order);
}

function itemList(order) {
  return order.items.map(item => `
    <div class="fact">
      <span>${item.damaged ? 'Needs attention' : 'In this order'}</span>
      <strong>${esc(item.name)}</strong>
      <span>${money(item.price * item.qty)}</span>
    </div>`).join('');
}

function timeline(order) {
  return `<ol class="timeline">${order.events.map(event => `
    <li class="${esc(event.state)}">
      <strong>${esc(event.title)}</strong>
      <span class="when">${esc(event.at)}</span>
    </li>`).join('')}</ol>`;
}

function renderUnderstand(order) {
  const existing = order.recoveryCase;
  const problem = order.problem;
  let next = '';
  if (existing && existing.status === 'closed') {
    next = `<a class="btn block" href="#/order/${esc(order.id)}/outcome">View the outcome</a>`;
  } else if (existing) {
    next = `<a class="btn block" href="#/order/${esc(order.id)}/recovery">Continue your recovery</a>`;
  } else if (problem) {
    next = `<a class="btn block" href="#/order/${esc(order.id)}/problem">See the problem</a>`;
  } else {
    next = `<button class="btn secondary block" type="button" id="wrong">Something’s wrong</button>`;
  }
  paint(`
    ${progress(2)}
    <h1>${esc(order.headline)}</h1>
    <p class="lead">${esc(order.customer)}, this is home delivery to ${esc(order.address)}. Promised ${esc(order.promise)}.</p>
    ${existing ? `<div class="banner">A recovery is already open for this order. <a href="#/order/${esc(order.id)}/recovery">Continue it</a>.</div>` : ''}
    ${timeline(order)}
    <div class="facts">${itemList(order)}</div>
    <div class="facts">
      <div class="fact"><span>Sales order</span><strong>${esc(order.salesOrder)}</strong></div>
      <div class="fact"><span>Delivery</span><strong>${esc(order.outboundDelivery || '—')}</strong></div>
      <div class="fact"><span>Freight order</span><strong>${esc(order.freightOrder || '—')}</strong></div>
      <div class="fact"><span>Packed at</span><strong>${esc(order.node)}</strong></div>
    </div>
    ${actions(`${next}<a class="text-btn" href="#/">Back to my orders</a>`)}
    <div id="report"></div>`);
  const wrong = document.querySelector('#wrong');
  if (!wrong) return;
  wrong.addEventListener('click', () => {
    document.querySelector('#report').innerHTML = `
      <h2 class="section-title">What went wrong?</h2>
      <div class="report">
        <button class="btn secondary" type="button" data-code="FAILED_ATTEMPT">It hasn’t arrived</button>
        <button class="btn secondary" type="button" data-code="DAMAGED">Something arrived damaged</button>
        <button class="btn secondary" type="button" data-code="MISSING">An item is missing</button>
      </div>`;
    document.querySelector('#report').addEventListener('click', async event => {
      const code = event.target.dataset && event.target.dataset.code;
      if (!code) return;
      event.target.disabled = true;
      try {
        await api(`/api/orders/${encodeURIComponent(order.id)}/problem`, {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        location.hash = `#/order/${encodeURIComponent(order.id)}/problem`;
      } catch (err) {
        document.querySelector('#report').insertAdjacentHTML('beforeend', `<p class="error" role="alert">${esc(err.message)}</p>`);
      }
    });
  });
}

function renderProblem(order) {
  if (!order.problem) {
    location.hash = `#/order/${encodeURIComponent(order.id)}`;
    return;
  }
  paint(`
    ${progress(3)}
    <h1>${esc(order.problem.title)}</h1>
    <p class="lead">${esc(order.problem.detail)}</p>
    <div class="banner">Found ${esc(order.problem.foundAt)}. Order ${esc(order.id)}.</div>
    ${actions(`
      <a class="btn block" href="#/order/${esc(order.id)}/choose">This is the problem</a>
      <a class="text-btn" href="#/order/${esc(order.id)}">Back</a>`)}`);
}

function renderChoose(order, keepScroll) {
  if (!order.problem) {
    location.hash = `#/order/${encodeURIComponent(order.id)}`;
    return;
  }
  if (!selectedOption) {
    const recommended = order.options.find(option => option.recommended);
    selectedOption = recommended ? recommended.id : (order.options[0] && order.options[0].id);
  }
  const choices = order.options.map(option => `
    <button class="choice ${option.id === selectedOption ? 'selected' : ''}" type="button" data-option="${esc(option.id)}" aria-pressed="${option.id === selectedOption}">
      ${option.recommended ? '<span class="badge">Recommended</span>' : ''}
      <strong>${esc(option.title)}</strong>
      <div class="meta">${esc(option.detail)}</div>
    </button>`).join('');
  const current = order.options.find(option => option.id === selectedOption);
  paint(`
    ${progress(4)}
    <h1>What would you like to do?</h1>
    <p class="lead">Pick one. You can still go back before anything is confirmed.</p>
    <div class="cards" id="choices">${choices}</div>
    <p class="error" id="err" role="alert" hidden></p>
    ${actions(`
      <button class="btn block" type="button" id="go">${current && current.id === 'refund' ? 'Continue with refund' : 'Continue'}</button>
      <a class="text-btn" href="#/order/${esc(order.id)}/problem">Back</a>`)}`, keepScroll);
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
      await api(`/api/orders/${encodeURIComponent(order.id)}/recovery`, {
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

function renderRecovery(order) {
  const recoveryCase = order.recoveryCase;
  if (!recoveryCase) {
    location.hash = `#/order/${encodeURIComponent(order.id)}/choose`;
    return;
  }
  if (recoveryCase.status === 'closed') {
    location.hash = `#/order/${encodeURIComponent(order.id)}/outcome`;
    return;
  }
  const ready = recoveryCase.status === 'ready';
  const steps = recoveryCase.steps.map((label, index) => {
    const cls = index < recoveryCase.stepIndex ? 'done' : index === recoveryCase.stepIndex ? 'now' : '';
    const mark = index < recoveryCase.stepIndex ? '✓' : index + 1;
    return `<li class="${cls}"><div class="mark" aria-hidden="true">${mark}</div><p><strong>${esc(label)}</strong></p></li>`;
  }).join('');
  paint(`
    ${progress(5)}
    <h1>${esc(recoveryCase.steps[recoveryCase.stepIndex])}</h1>
    <p class="lead">Case ${esc(recoveryCase.id)}. This stays here until the recovery is finished.</p>
    <ol class="steps">${steps}</ol>
    <p class="error" id="err" role="alert" hidden></p>
    ${actions(`
      <button class="btn block" type="button" id="next">${ready ? 'Review the outcome' : 'Check for an update'}</button>
      <button class="text-btn" type="button" id="restart">Start this order again</button>`)}`);
  document.querySelector('#next').addEventListener('click', async () => {
    if (ready) {
      location.hash = `#/order/${encodeURIComponent(order.id)}/outcome`;
      return;
    }
    const button = document.querySelector('#next');
    button.disabled = true;
    try {
      await api(`/api/cases/${encodeURIComponent(recoveryCase.id)}/advance`, { method: 'POST' });
      showScreen(order.id, 'recovery');
    } catch (err) {
      button.disabled = false;
      const slot = document.querySelector('#err');
      slot.hidden = false;
      slot.textContent = err.message;
    }
  });
  bindRestart(order.id);
}

function outcomeText(recoveryCase, order) {
  const item = (order.items.find(entry => entry.damaged) || order.items[0]).name;
  const closed = recoveryCase.status === 'closed';
  if (recoveryCase.outcome === 'refund') {
    return {
      heading: closed ? `${money(recoveryCase.amount)} refund confirmed` : `Refund ${money(recoveryCase.amount)}`,
      lead: 'It goes back to your original payment. This will not be delivered again.',
      confirm: 'Confirm refund'
    };
  }
  if (recoveryCase.outcome === 'replacement') {
    return {
      heading: closed ? 'Replacement confirmed' : 'Replacement tomorrow, 5–8pm',
      lead: `A new ${item} will go to the same address. You don’t need to call us.`,
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
  if (recoveryCase.status === 'open') {
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
      : `<button class="btn block" type="button" id="confirm">${esc(copy.confirm)}</button><a class="text-btn" href="#/order/${esc(order.id)}/recovery">Back</a>`)}`);
  const confirm = document.querySelector('#confirm');
  if (confirm) {
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        await api(`/api/cases/${encodeURIComponent(recoveryCase.id)}/complete`, { method: 'POST' });
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
    await api(`/api/orders/${encodeURIComponent(id)}/reset`, { method: 'POST' });
    selectedOption = null;
    const next = `#/order/${encodeURIComponent(id)}`;
    if (location.hash === next) route();
    else location.hash = next;
  });
}

window.addEventListener('hashchange', route);
route();
