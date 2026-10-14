/* Kmart Supply Hub – front end (vanilla JS, hash routing) */
'use strict';

let CFG = { sapWriteMode: 'simulate' };
let LINES = [];
let STATE = { adjust: null, historyFilter: 'all', delFilter: 'all', delSearch: '', chosenAction: {} };
let MAPS = [];

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
async function api(path, opts = {}) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let body = null; try { body = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((body && body.error) || r.statusText);
  return body;
}
const nz = n => Number(n || 0).toLocaleString('en-NZ');
function money(n) { const v = Math.round(Number(n) || 0); return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-NZ'); }
function fmtDate(s) {
  if (!s) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(s) {
  const d = new Date(s);
  return isNaN(d) ? (s || '—') : d.toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  truck: '<path d="M1 5h13v11H1z"/><path d="M14 9h4l4 4v3h-8z"/><circle cx="5.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  reset: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  tick: '<path d="M20 6 9 17l-5-5"/>',
  ship: '<path d="M2 21c2 1 4 1 6 0s4-1 6 0 4 1 6 0"/><path d="M4 18 3 13h18l-2 5"/><path d="M6 13V8h12v5"/><path d="M12 8V4"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  right: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  left: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  pin: '<path d="M12 22s7-6.4 7-12a7 7 0 0 0-14 0c0 5.6 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  play: '<path d="m6 4 14 8-14 8z"/>'
};
function icon(name, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = icon(type === 'err' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  $('#toastRoot').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function modal({ title, body, foot = '', narrow = false }) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop" data-close="1">
    <div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close="1" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div></div>`;
  root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', e => { if (e.target === el || el.tagName === 'BUTTON') closeModal(); }));
  document.addEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() { $('#modalRoot').innerHTML = ''; document.removeEventListener('keydown', escClose); }
function confirmDialog({ title, message, confirmText = 'Confirm' }) {
  return new Promise(resolve => {
    modal({ title, narrow: true, body: `<p style="margin:0">${message}</p>`,
      foot: `<button class="btn btn-secondary" id="cdNo">Cancel</button><button class="btn" id="cdYes">${esc(confirmText)}</button>` });
    $('#cdNo').onclick = () => { closeModal(); resolve(false); };
    $('#cdYes').onclick = () => { closeModal(); resolve(true); };
    $('#cdYes').focus();
  });
}
function renderRequests(requests) {
  return requests.map((r, i) => `<div class="req">
    <div class="req-head"><span class="muted">#${i + 1}</span><span class="method ${esc(r.method)}">${esc(r.method)}</span><span class="mono">${esc(r.path)}</span></div>
    <pre class="code">${esc(JSON.stringify(r.body, null, 2))}</pre></div>`).join('');
}
async function showWrite(id) {
  try {
    const w = await api('/api/writes/' + encodeURIComponent(id));
    modal({
      title: 'SAP request',
      body: `<div class="banner ${w.mode === 'live' ? 'banner-ok' : 'banner-warn'}" style="margin-bottom:14px">${icon('db')}<div>
          <strong>${w.mode === 'live' ? 'Sent to SAP S/4HANA' : 'Simulation mode'}</strong> — ${w.mode === 'live' ? 'responses are shown below.' : 'the SAP sandbox is read-only, so these OData V4 requests were built and saved, not sent. They are ready for Kmart’s production S/4HANA system.'}</div></div>
        <div class="kv c2" style="margin-bottom:14px"><div><div class="k">Purpose</div><div class="v">${esc(w.title || w.kind)}</div></div>
        <div><div class="k">Created</div><div class="v">${fmtDateTime(w.createdAt)}</div></div>
        <div><div class="k">Purchase order</div><div class="v">${esc(w.poNumber)}</div></div>
        <div><div class="k">Requests</div><div class="v">${w.requests.length}</div></div></div>
        ${renderRequests(w.requests)}
        ${w.responses ? `<div class="section-title">SAP responses</div><pre class="code">${esc(JSON.stringify(w.responses, null, 2))}</pre>` : ''}`,
      foot: `<button class="btn btn-secondary" data-close="1">Close</button>`
    });
  } catch (e) { toast('Could not load the SAP request: ' + e.message, 'err'); }
}

function stepper(steps, active) {
  return `<div class="stepper" aria-label="Progress">${steps.map((s, i) => {
    const cls = i < active ? 'done' : i === active ? 'active' : '';
    return `<div class="st ${cls}" ${i === active ? 'aria-current="step"' : ''}><span class="n">${i < active ? icon('tick', 'i-sm') : i + 1}</span><span class="st-label">${esc(s)}</span></div>`;
  }).join('')}</div>`;
}
const MIX_STEPS = ['Select line', 'Review signal', 'Adjust mix', 'Confirm mix lock'];
const DEL_STEPS = ['Track', 'Understand', 'Identify problem', 'Choose action', 'Track recovery', 'Complete'];

function crumbs(items) {
  $('#crumbs').innerHTML = items.map((c, i) => (i ? '<span class="sep">/</span>' : '') +
    (c.href ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`)).join('');
}
function setNav(key) { $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === key)); $('#sidebar').classList.remove('open'); }
function updateSapChip(st) {
  const chip = $('#sapChip');
  if (!st) return;
  if (st.live) { chip.className = 'chip chip-green'; chip.innerHTML = '<span class="dot"></span>SAP sandbox · live'; chip.title = 'Last live read ' + fmtDateTime(st.at); }
  else { chip.className = 'chip chip-neutral'; chip.innerHTML = '<span class="dot"></span>SAP · cached snapshot'; chip.title = st.message || ''; }
}
function sourceLine(obj) {
  return obj.cached
    ? `<span class="chip chip-neutral">${icon('db', 'i-sm')} Cached SAP data${obj.cachedAt ? ' · ' + fmtDateTime(obj.cachedAt) : ''}</span>`
    : `<span class="chip chip-green">${icon('db', 'i-sm')} Live from S/4HANA sandbox</span>`;
}
function simBanner() {
  if (CFG.sapWriteMode === 'live') return '';
  return `<div class="banner banner-warn">${icon('info')}<div><strong>Simulation mode.</strong> Data is read from the SAP S/4HANA sandbox (live when reachable, otherwise the last saved snapshot). The sandbox is read-only, so write requests are built in the exact OData V4 format and saved instead of sent.</div></div>`;
}
function clearMaps() { MAPS.forEach(m => { try { m.remove(); } catch (e) {} }); MAPS = []; }
function setApp(html) { clearMaps(); $('#app').innerHTML = html; window.scrollTo(0, 0); }
function loadingView(label) { setApp(`<div class="loading"><span class="spinner"></span> ${esc(label)}</div>
  <div class="kpis">${'<div class="skel" style="height:86px"></div>'.repeat(4)}</div><div class="skel" style="height:280px"></div>`); }
function errorView(msg) { setApp(`<div class="card empty">${icon('alert')}<div><strong>Something went wrong.</strong></div><p>${esc(msg)}</p><a class="btn btn-secondary" href="#/mixlock">Back to start</a></div>`); }

// =====================================================================
// MIX-LOCK
// =====================================================================
async function loadLines() {
  const d = await api('/api/lines');
  LINES = d.lines; updateSapChip(d.sapStatus);
  return LINES;
}
function lockedAlloc(l) {
  const vars = variantList(l);
  return vars.map(v => { const f = l.lockedDetail.finalSplit.find(x => x.colour === v.colour && x.size === v.size); return Object.assign({}, v, { qty: f ? f.qty : 0 }); });
}

async function viewMixDashboard() {
  setNav('mixlock'); crumbs([{ label: 'Buying' }, { label: 'Mix-Lock' }]);
  loadingView('Loading Anko lines from SAP…');
  try { await loadLines(); } catch (e) { return errorView(e.message); }
  const lines = LINES;
  const locked = lines.filter(l => l.status === 'Mix locked');
  const committed = lines.reduce((s, l) => s + (l.sap ? l.sap.committedQuantity : 0), 0);
  let projected = 0, even = 0;
  for (const l of lines) {
    const c = l.sap ? l.sap.committedQuantity : 0; if (!c) continue;
    const ev = evenAlloc(l, c);
    even += riskAmount(ev, c, l);
    projected += riskAmount(l.lockedDetail ? lockedAlloc(l) : ev, c, l);
  }
  const saved = even - projected;
  const rows = lines.map(l => {
    const sap = l.sap || {};
    const isLocked = l.status === 'Mix locked';
    return `<tr>
      <td><a class="row-title" href="#/${isLocked ? 'locked' : 'line'}/${l.id}">${esc(l.name)}</a><div class="row-sub">${esc(l.category)} · ${l.colours.length * l.sizes.length} variants</div></td>
      <td class="num">${esc(sap.PurchaseOrder || l.poNumber)}</td>
      <td>${esc(sap.Supplier || '—')}</td>
      <td>${fmtDate(sap.PurchaseOrderDate)}</td>
      <td class="r num">${nz(sap.committedQuantity)}</td>
      <td>${isLocked ? `<span class="chip chip-green">${icon('lock', 'i-sm')} Mix locked</span>` : '<span class="chip chip-blue"><span class="dot"></span>G1 committed</span>'}
</td>
      <td class="r">${isLocked ? `<a class="btn btn-secondary btn-sm" href="#/locked/${l.id}">View lock</a>` : `<a class="btn btn-sm" href="#/line/${l.id}">Review ${icon('right', 'i-sm')}</a>`}</td>
    </tr>`;
  }).join('');
  setApp(`
    ${stepper(MIX_STEPS, 0)}
    <div class="page-head"><div><h1 class="page-title">Anko Mix-Lock</h1>
      <p class="page-sub">Deferred mix allocation: total volume is committed at Gate 1; the colour and size split is locked later, once early sell-through is known.</p></div></div>
    ${simBanner()}
    <div class="kpis">
      <div class="kpi"><div class="kpi-ico red">${icon('clock')}</div><div><div class="label">Lines awaiting mix lock</div><div class="value">${lines.length - locked.length}</div><div class="hint">of ${lines.length} Anko lines</div></div></div>
      <div class="kpi"><div class="kpi-ico">${icon('box')}</div><div><div class="label">Committed units</div><div class="value">${nz(committed)}</div><div class="hint">from SAP purchase orders</div></div></div>
      <div class="kpi"><div class="kpi-ico green">${icon('lock')}</div><div><div class="label">Lines locked</div><div class="value">${lines.length ? Math.round(locked.length / lines.length * 100) : 0}%</div><div class="hint">${locked.length} locked</div></div></div>
      <div class="kpi"><div class="kpi-ico amber">${icon('trend')}</div><div><div class="label">Projected markdown risk</div><div class="value">${money(projected)}</div><div class="hint">was ${money(even)} at even split${saved > 0 ? ` · <span class="good">saved ${money(saved)}</span>` : ''}</div></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2 class="section-title">Anko lines</h2>${sourceLine({ cached: lines.some(l => l.cached), cachedAt: (lines.find(l => l.cached) || {}).cachedAt })}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Anko line</th><th>SAP PO</th><th>Supplier</th><th>PO date</th><th class="r">Committed qty</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`);
}

async function getLine(id) {
  const line = await api('/api/lines/' + encodeURIComponent(id));
  const i = LINES.findIndex(l => l.id === id); if (i >= 0) LINES[i] = line; else LINES.push(line);
  return line;
}

function sapPoCard(line) {
  const sap = line.sap || {};
  const items = (sap.items || []).slice().sort((a, b) => Number(a.PurchaseOrderItem) - Number(b.PurchaseOrderItem));
  return `<div class="card">
    <div class="card-head"><h2 class="section-title">${icon('db')} G1 commitment in SAP</h2>${sourceLine(line)}</div>
    <div class="kv">
      <div><div class="k">Purchase order</div><div class="v">${esc(sap.PurchaseOrder || line.poNumber)}</div></div>
      <div><div class="k">Supplier</div><div class="v">${esc(sap.Supplier || '—')}</div></div>
      <div><div class="k">PO date</div><div class="v">${fmtDate(sap.PurchaseOrderDate)}</div></div>
      <div><div class="k">Committed quantity</div><div class="v">${nz(sap.committedQuantity)} ${esc((items[0] && items[0].PurchaseOrderQuantityUnit) || 'PC')}</div></div>
      <div><div class="k">Company code / currency</div><div class="v">${esc(sap.CompanyCode || '—')} · ${esc(sap.DocumentCurrency || '—')}</div></div>
      <div><div class="k">Status</div><div class="v">${line.status === 'Mix locked' ? '<span class="chip chip-green">Mix locked</span>' : '<span class="chip chip-blue">G1 committed</span>'}</div></div>
    </div>
    ${items.length ? `<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Show ${items.length} SAP order items <span class="tag">sandbox demo data</span></summary>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Item</th><th>Text</th><th>Material</th><th>Plant</th><th class="r">Qty</th></tr></thead><tbody>
      ${items.map(it => `<tr><td>${esc(it.PurchaseOrderItem)}</td><td>${esc(it.PurchaseOrderItemText)}</td><td class="mono">${esc(it.Material)}</td><td>${esc(it.Plant)}</td><td class="r num">${nz(it.OrderQuantity)}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}
  </div>`;
}

async function viewLine(id) {
  setNav('mixlock');
  loadingView('Loading line…');
  let line; try { line = await getLine(id); } catch (e) { return errorView(e.message); }
  if (line.status === 'Mix locked') { location.hash = '#/locked/' + id; return; }
  crumbs([{ label: 'Mix-Lock', href: '#/mixlock' }, { label: line.name }, { label: 'Review signal' }]);
  const vars = variantList(line);
  const max = Math.max(...vars.map(v => v.signal), 1);
  const total = vars.reduce((s, v) => s + v.signal, 0);
  const colourTotals = line.colours.map((c, ci) => ({ c, v: line.sizes.reduce((s, _, si) => s + line.signal[ci][si], 0) }));
  const maxC = Math.max(...colourTotals.map(x => x.v), 1);
  const heat = `<table class="heat"><thead><tr><th>Colour</th>${line.sizes.map(s => `<th>${esc(s)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
    ${line.colours.map((c, ci) => `<tr><td><strong>${esc(c)}</strong></td>${line.sizes.map((s, si) => {
      const v = line.signal[ci][si]; const t = v / max;
      return `<td style="background:rgba(228,0,43,${(0.08 + t * 0.82).toFixed(2)});color:${t > 0.55 ? '#fff' : 'var(--ink)'}">${nz(v)}</td>`;
    }).join('')}<td class="r num"><strong>${nz(colourTotals[ci].v)}</strong></td></tr>`).join('')}
    </tbody></table>`;
  setApp(`
    ${stepper(MIX_STEPS, 1)}
    <div class="page-head"><div><h1 class="page-title">${esc(line.name)}</h1><p class="page-sub">Review the early demand signal before splitting the committed volume.</p></div>
      <div class="btn-row"><a class="btn btn-secondary" href="#/mixlock">${icon('left', 'i-sm')} Back</a><a class="btn" href="#/adjust/${line.id}">Adjust mix ${icon('right', 'i-sm')}</a></div></div>
    <div class="grid g-main">
      <div class="card"><div class="card-head"><h2 class="section-title">${icon('trend')} Early demand signal</h2><span class="muted small">3 weeks of trial-store sell-through · ${nz(total)} units</span></div>
        ${heat}<p class="small muted" style="margin:10px 0 0">Darker cells sold faster. The suggested split follows this signal.</p></div>
      <div class="card"><h2 class="section-title">Sell-through by colour</h2>
        <div class="bars">${colourTotals.map(x => `<div class="bar-row"><span>${esc(x.c)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.v / maxC * 100).toFixed(0)}%"></div></div><span class="r num">${Math.round(x.v / total * 100)}%</span></div>`).join('')}</div></div>
    </div>
    <div style="margin-top:16px">${sapPoCard(line)}</div>`);
}

async function viewAdjust(id) {
  setNav('mixlock');
  let line = LINES.find(l => l.id === id);
  if (!line || !line.sap) { loadingView('Loading line…'); try { line = await getLine(id); } catch (e) { return errorView(e.message); } }
  if (line.status === 'Mix locked') { location.hash = '#/locked/' + id; return; }
  crumbs([{ label: 'Mix-Lock', href: '#/mixlock' }, { label: line.name, href: '#/line/' + id }, { label: 'Adjust mix' }]);
  const committed = line.sap ? line.sap.committedQuantity : 0;
  if (!STATE.adjust || STATE.adjust.lineId !== id) {
    const sug = suggestAlloc(line, committed);
    STATE.adjust = { lineId: id, committed, split: sug.map(v => Object.assign({}, v)), suggested: sug.map(v => v.qty), original: evenAlloc(line, committed) };
  }
  const adj = STATE.adjust; const pack = line.casePack || 12;
  const rows = adj.split.map((v, i) => `<tr>
    <td>${esc(v.colour)}</td><td>${esc(v.size)}</td>
    <td class="r num muted">${nz(v.signal)}</td>
    <td class="r num muted">${nz(adj.original[i].qty)}</td>
    <td class="r num"><strong>${nz(adj.suggested[i])}</strong></td>
    <td class="r"><input class="qty ${v.qty !== adj.suggested[i] ? 'changed' : ''}" type="number" min="0" step="${pack}" value="${v.qty}" data-idx="${i}" aria-label="Quantity for ${esc(v.colour)} ${esc(v.size)}"></td>
  </tr>`).join('');
  const origRisk = riskAmount(adj.original, committed, line);
  setApp(`
    ${stepper(MIX_STEPS, 2)}
    <div class="page-head"><div><h1 class="page-title">Adjust mix · ${esc(line.name)}</h1>
      <p class="page-sub">Split <strong>${nz(committed)} committed units</strong>. Each variant gets at least 5%, in case packs of ${pack}, and the total must match exactly.</p></div></div>
    <div class="grid g-main">
      <div class="card">
        <div class="card-head"><h2 class="section-title">Variant split</h2>${sourceLine(line)}</div>
        <div class="table-wrap"><table><thead><tr><th>Colour</th><th>Size</th><th class="r">3-wk signal</th><th class="r">Even split</th><th class="r">Suggested</th><th class="r">Final quantity</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="totalbar" id="totalBar"></div>
        <div class="btn-row" style="margin-top:14px;justify-content:space-between">
          <div class="btn-row"><a class="btn btn-secondary" href="#/line/${id}">${icon('left', 'i-sm')} Back</a><button class="btn btn-ghost" id="resetSug">${icon('reset', 'i-sm')} Reset to suggestion</button></div>
          <button class="btn" id="continueBtn">Continue to confirm ${icon('right', 'i-sm')}</button></div>
      </div>
      <div class="card">
        <h2 class="section-title">${icon('trend')} Projected markdown risk</h2>
        <div class="risk-row"><span>Even split (today)</span><strong class="num">${money(origRisk)}</strong></div>
        <div class="risk-row"><span>This split</span><strong class="num" id="newRisk"></strong></div>
        <div style="margin-top:14px" class="muted small">Risk reduction</div>
        <div class="risk-big num" id="riskRed"></div>
        <p class="small muted" style="margin-top:12px">Risk = units above the demand-based ideal × unit price ($${line.unitPrice}) × expected markdown (${Math.round(line.markdownPct * 100)}%).</p>
      </div>
    </div>`);
  const update = () => {
    const total = adj.split.reduce((s, v) => s + v.qty, 0);
    const diff = total - committed;
    const badPack = adj.split.filter(v => v.qty % pack !== 0).length;
    const ok = diff === 0 && !badPack;
    const bar = $('#totalBar');
    bar.className = 'totalbar ' + (ok ? 'ok' : 'bad');
    bar.innerHTML = `<span>${ok ? icon('check') : icon('alert')} Total ${nz(total)} of ${nz(committed)} units</span><span>${
      diff > 0 ? `${nz(diff)} over committed volume` : diff < 0 ? `${nz(-diff)} short of committed volume` : badPack ? `${badPack} variant(s) not in case packs of ${pack}` : 'Matches committed volume'}</span>`;
    $('#continueBtn').disabled = !ok;
    const nr = riskAmount(adj.split, committed, line);
    $('#newRisk').textContent = money(nr);
    $('#riskRed').textContent = money(origRisk - nr);
    $$('.qty').forEach((inp, i) => inp.classList.toggle('changed', adj.split[i].qty !== adj.suggested[i]));
  };
  $$('.qty').forEach(inp => inp.addEventListener('input', () => { adj.split[Number(inp.dataset.idx)].qty = Math.max(0, Number(inp.value) || 0); update(); }));
  $('#resetSug').onclick = () => { adj.split.forEach((v, i) => { v.qty = adj.suggested[i]; }); $$('.qty').forEach((inp, i) => { inp.value = adj.split[i].qty; }); update(); toast('Reset to the suggested split'); };
  $('#continueBtn').onclick = () => { location.hash = '#/confirm/' + id; };
  update();
}

async function viewConfirm(id) {
  setNav('mixlock');
  const line = LINES.find(l => l.id === id);
  const adj = STATE.adjust;
  if (!line || !adj || adj.lineId !== id) { location.hash = '#/adjust/' + id; return; }
  crumbs([{ label: 'Mix-Lock', href: '#/mixlock' }, { label: line.name, href: '#/line/' + id }, { label: 'Confirm' }]);
  const committed = adj.committed;
  const before = riskAmount(adj.original, committed, line);
  const after = riskAmount(adj.split, committed, line);
  setApp(`
    ${stepper(MIX_STEPS, 3)}
    <div class="page-head"><div><h1 class="page-title">Confirm mix lock · ${esc(line.name)}</h1><p class="page-sub">Check the final split. Locking writes one order line per variant to SAP purchase order ${esc(line.sap.PurchaseOrder)}.</p></div></div>
    ${simBanner()}
    <div class="grid g-main">
      <div class="card"><h2 class="section-title">Final split</h2>
        <div class="table-wrap"><table><thead><tr><th>Colour</th><th>Size</th><th class="r">Units</th><th class="r">Share</th></tr></thead><tbody>
        ${adj.split.map(v => `<tr><td>${esc(v.colour)}</td><td>${esc(v.size)}</td><td class="r num">${nz(v.qty)}</td><td class="r num">${(v.qty / committed * 100).toFixed(1)}%</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2">Total</td><td class="r num">${nz(committed)}</td><td class="r">100%</td></tr></tfoot></table></div></div>
      <div class="stack">
        <div class="card"><h2 class="section-title">${icon('trend')} Impact</h2>
          <div class="risk-row"><span>Markdown risk at even split</span><strong class="num">${money(before)}</strong></div>
          <div class="risk-row"><span>Markdown risk with this split</span><strong class="num">${money(after)}</strong></div>
          <div class="muted small" style="margin-top:12px">Saving</div><div class="risk-big num">${money(before - after)}</div></div>
        <div class="card"><h2 class="section-title">${icon('db')} What goes to SAP</h2>
          <p class="small muted" style="margin:0 0 6px">${adj.split.length} × <span class="mono">POST …/_PurchaseOrderItem</span> (one per variant)<br>1 × <span class="mono">POST …/_PurchaseOrderNote</span> (audit note)</p></div>
      </div>
    </div>
    <div class="btn-row" style="margin-top:16px;justify-content:space-between">
      <a class="btn btn-secondary" href="#/adjust/${id}">${icon('left', 'i-sm')} Back to adjust</a>
      <button class="btn" id="lockBtn">${icon('lock', 'i-sm')} Confirm mix lock</button></div>`);
  $('#lockBtn').onclick = async () => {
    const ok = await confirmDialog({ title: 'Lock this mix?', message: `This sends ${adj.split.length} variant lines for <strong>${esc(line.name)}</strong> to SAP purchase order ${esc(line.sap.PurchaseOrder)}. A locked line can't be changed here.`, confirmText: 'Lock mix' });
    if (!ok) return;
    const btn = $('#lockBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const w = await api('/api/mixlock', { method: 'POST', body: JSON.stringify({
        lineId: id, poNumber: line.sap.PurchaseOrder, committedQty: committed, riskBefore: before, riskAfter: after,
        finalSplit: adj.split.map(v => ({ colour: v.colour, size: v.size, qty: v.qty })) }) });
      STATE.adjust = null;
      toast('Mix locked – ' + line.name);
      setApp(`${stepper(MIX_STEPS, 4)}
        <div class="card success"><div class="ok-ico">${icon('tick')}</div><h2>Mix locked</h2>
          <p class="muted">${esc(line.name)} · ${nz(committed)} units across ${adj.split.length} variants · markdown risk down ${money(before - after)}</p>
          <p class="small muted">${w.mode === 'live' ? 'Sent to SAP S/4HANA.' : 'Simulation mode: ' + w.requests.length + ' SAP requests built and saved, ready for production S/4HANA.'}</p>
          <div class="btn-row" style="justify-content:center;margin:18px 0 12px"><button class="btn btn-secondary" onclick="showWrite('${w.id}')">${icon('code', 'i-sm')} View SAP request</button><a class="btn" href="#/mixlock">Back to Mix-Lock</a></div></div>`);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = icon('lock', 'i-sm') + ' Confirm mix lock'; }
  };
}

async function viewLocked(id) {
  setNav('mixlock');
  loadingView('Loading lock…');
  let line; try { line = await getLine(id); } catch (e) { return errorView(e.message); }
  if (!line.lockedDetail) { location.hash = '#/line/' + id; return; }
  crumbs([{ label: 'Mix-Lock', href: '#/mixlock' }, { label: line.name }, { label: 'Locked split' }]);
  const c = line.sap.committedQuantity;
  const alloc = lockedAlloc(line);
  const before = riskAmount(evenAlloc(line, c), c, line), after = riskAmount(alloc, c, line);
  setApp(`
    <div class="page-head"><div><h1 class="page-title">${esc(line.name)}</h1><p class="page-sub">Read-only view of the locked colour and size split.</p></div>
      <div class="btn-row"><a class="btn btn-secondary" href="#/mixlock">${icon('left', 'i-sm')} Back</a><button class="btn" onclick="showWrite('${esc(line.lockedDetail.writeId)}')">${icon('code', 'i-sm')} View SAP request</button></div></div>
    <div class="banner banner-ok">${icon('lock')}<div><strong>Mix locked</strong> on ${fmtDateTime(line.lockedDetail.at)}. Markdown risk reduced from ${money(before)} to ${money(after)}.</div></div>
    <div class="grid g-main">
      <div class="card"><h2 class="section-title">Locked split</h2><div class="table-wrap"><table><thead><tr><th>Colour</th><th>Size</th><th class="r">3-wk signal</th><th class="r">Units</th></tr></thead><tbody>
      ${alloc.map(v => `<tr><td>${esc(v.colour)}</td><td>${esc(v.size)}</td><td class="r num muted">${nz(v.signal)}</td><td class="r num">${nz(v.qty)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">Total</td><td class="r num">${nz(c)}</td></tr></tfoot></table></div></div>
      ${sapPoCard(line)}
    </div>`);
}

// =====================================================================
// DELIVERY TRACKER
// =====================================================================
const STATUS_CHIP = {
  'On track': 'chip-green', 'Delayed': 'chip-warn', 'At risk': 'chip-warn', 'Problem': 'chip-danger',
  'Recovery in progress': 'chip-blue', 'Resolved': 'chip-green'
};
const STATUS_COLOR = { 'On track': '#0E7A43', 'Delayed': '#D97706', 'At risk': '#D97706', 'Problem': '#B42318', 'Recovery in progress': '#1D4ED8', 'Resolved': '#0E7A43' };
function statusChip(s) { return `<span class="chip ${STATUS_CHIP[s] || 'chip-neutral'}"><span class="dot"></span>${esc(s)}</span>`; }
function sevChip(s) { return `<span class="chip ${s === 'High' ? 'chip-danger' : s === 'Medium' ? 'chip-warn' : 'chip-neutral'}">${icon('alert', 'i-sm')} ${esc(s)} severity</span>`; }
function updateNavCount(list) {
  const open = list.filter(d => d.problems.length && !d.case).length;
  const a = $('.nav a[data-nav="deliveries"] .count');
  if (a) { a.textContent = open; a.hidden = !open; }
}

function makeMap(el) {
  if (!window.L) { el.innerHTML = `<div class="map-fallback">${icon('pin', 'i-lg')}<br>Map unavailable (no internet connection to load map tiles).</div>`; return null; }
  const m = L.map(el, { scrollWheelZoom: false, worldCopyJump: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
  MAPS.push(m);
  setTimeout(() => m.invalidateSize(), 60);
  return m;
}
function splitLane(points, frac) {
  if (!points.length) return [[], []];
  const seg = []; let total = 0;
  for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); seg.push(d); total += d; }
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i]) {
      const t = seg[i] ? target / seg[i] : 0;
      const p = [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
      return [points.slice(0, i + 1).concat([p]), [p].concat(points.slice(i + 1))];
    }
    target -= seg[i];
  }
  return [points, []];
}
function pinIcon(color) { return L.divIcon({ className: '', html: `<div class="pin-marker" style="background:${color}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }); }
function shipIcon(color) { return L.divIcon({ className: '', html: `<div class="ship-marker" style="background:${color}">${icon('ship')}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }); }

function drawShipmentMap(el, d) {
  const m = makeMap(el); if (!m) return;
  const [done, todo] = splitLane(d.lane, d.progress);
  if (todo.length > 1) L.polyline(todo, { color: '#6B7280', weight: 3, dashArray: '6 8', opacity: .8 }).addTo(m);
  if (done.length > 1) L.polyline(done, { color: '#E4002B', weight: 4 }).addTo(m);
  const pts = [
    [d.origin, '#1F2937', 'Origin'], [d.portDischarge, '#1D4ED8', 'Port of discharge'], [d.dc, '#0E7A43', 'Destination DC']
  ];
  pts.forEach(([p, c, role]) => { if (p) L.marker([p.lat, p.lng], { icon: pinIcon(c) }).addTo(m).bindPopup(`<strong>${esc(p.name)}</strong><br>${role}`); });
  if (d.currentPos && d.progress > 0 && d.progress < 1) {
    L.marker(d.currentPos, { icon: shipIcon(STATUS_COLOR[d.status] || '#E4002B'), zIndexOffset: 1000 }).addTo(m)
      .bindPopup(`<strong>${esc(d.vessel)}</strong><br>${esc(d.stage)}<br>ETA DC ${fmtDate(d.eta)}`);
  }
  m.fitBounds(L.latLngBounds(d.lane.concat([[d.dc.lat, d.dc.lng]])), { padding: [30, 30] });
}

function drawNetworkMap(el, list) {
  const m = makeMap(el); if (!m) return;
  const all = [];
  list.forEach(d => {
    const color = STATUS_COLOR[d.status] || '#6B7280';
    L.polyline(d.lane, { color, weight: 2, opacity: .55, dashArray: d.progress >= 1 ? null : '4 6' }).addTo(m);
    const pos = d.progress >= 1 ? [d.dc.lat, d.dc.lng] : d.progress <= 0 ? [d.origin.lat, d.origin.lng] : d.currentPos;
    const mk = L.marker(pos, { icon: shipIcon(color) }).addTo(m)
      .bindTooltip(`<strong>${esc(d.product)}</strong><br>${esc(d.status)} · ETA ${fmtDate(d.eta)}`, { direction: 'top', offset: [0, -14] });
    mk.on('click', () => { location.hash = '#/delivery/' + d.id; });
    all.push(...d.lane);
  });
  if (all.length) m.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
}

async function viewDeliveries() {
  setNav('deliveries'); crumbs([{ label: 'Inbound' }, { label: 'Delivery Tracker' }]);
  loadingView('Loading inbound purchase orders…');
  let list; try { const d = await api('/api/deliveries'); list = d.deliveries; updateSapChip(d.sapStatus); } catch (e) { return errorView(e.message); }
  updateNavCount(list);
  const inTransit = list.filter(d => d.progress > 0 && d.progress < 1);
  const kp = {
    units: inTransit.reduce((s, d) => s + d.units, 0),
    ontrack: list.filter(d => d.status === 'On track').length,
    risk: list.filter(d => ['Delayed', 'At risk'].includes(d.status)).length,
    problems: list.filter(d => d.problems.length && !d.case).length,
    recovery: list.filter(d => d.case && d.case.status !== 'Resolved').length,
    value: list.filter(d => d.problems.length && !d.case).reduce((s, d) => s + d.problems.reduce((a, p) => a + (p.impact.value || 0), 0), 0)
  };
  setApp(`
    ${stepper(DEL_STEPS, 0)}
    <div class="page-head"><div><h1 class="page-title">Delivery Tracker</h1><p class="page-sub">Inbound Anko purchase orders from supplier to Kmart distribution centre. Problems are flagged automatically.</p></div></div>
    <div class="kpis k5">
      <div class="kpi"><div class="kpi-ico">${icon('ship')}</div><div><div class="label">Units at sea</div><div class="value">${nz(kp.units)}</div><div class="hint">${inTransit.length} shipments in transit</div></div></div>
      <div class="kpi"><div class="kpi-ico green">${icon('check')}</div><div><div class="label">On track</div><div class="value">${kp.ontrack}</div><div class="hint">of ${list.length} purchase orders</div></div></div>
      <div class="kpi"><div class="kpi-ico amber">${icon('clock')}</div><div><div class="label">Delayed / at risk</div><div class="value">${kp.risk}</div><div class="hint">need watching</div></div></div>
      <div class="kpi"><div class="kpi-ico danger">${icon('alert')}</div><div><div class="label">Problems to action</div><div class="value">${kp.problems}</div><div class="hint">${money(kp.value)} of stock at risk</div></div></div>
      <div class="kpi"><div class="kpi-ico red">${icon('reset')}</div><div><div class="label">Recoveries open</div><div class="value">${kp.recovery}</div><div class="hint">being tracked</div></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2 class="section-title">${icon('pin')} Inbound network</h2><span class="tag">Carrier feed (simulated)</span></div>
      <div class="map sm" id="netMap"></div>
      <div class="legend"><span><i class="lg-dot" style="background:#0E7A43"></i>On track / resolved</span><span><i class="lg-dot" style="background:#D97706"></i>Delayed</span><span><i class="lg-dot" style="background:#B42318"></i>Problem</span><span><i class="lg-dot" style="background:#1D4ED8"></i>Recovery in progress</span><span>Click a ship to open it</span></div>
    </div>
    <div class="card">
      <div class="card-head"><h2 class="section-title">Purchase orders</h2>
        <div class="toolbar"><div class="seg" id="delSeg">
          ${['all:All', 'problems:Needs action', 'delayed:Delayed', 'ontrack:On track', 'recovery:In recovery'].map(x => { const [k, l] = x.split(':'); return `<button data-f="${k}" class="${STATE.delFilter === k ? 'on' : ''}">${l}</button>`; }).join('')}
        </div><label class="search">${icon('search', 'i-sm')}<input id="delSearch" placeholder="Search product, PO, supplier" value="${esc(STATE.delSearch)}"></label></div></div>
      <div class="table-wrap"><table><thead><tr><th>Product</th><th>Supplier</th><th>Route</th><th>Stage</th><th>ETA at DC</th><th>Status</th><th></th></tr></thead><tbody id="delRows"></tbody></table></div>
    </div>`);
  const renderRows = () => {
    const q = STATE.delSearch.toLowerCase();
    const f = STATE.delFilter;
    const rows = list.filter(d => {
      if (f === 'problems' && !(d.problems.length && !d.case)) return false;
      if (f === 'delayed' && !['Delayed', 'At risk'].includes(d.status) && !d.problems.some(p => p.type === 'delay')) return false;
      if (f === 'ontrack' && d.status !== 'On track') return false;
      if (f === 'recovery' && !d.case) return false;
      return !q || [d.product, d.poNumber, d.supplierName, d.supplierId].join(' ').toLowerCase().includes(q);
    });
    $('#delRows').innerHTML = rows.length ? rows.map(d => {
      const late = d.problems.find(p => p.type === 'delay');
      return `<tr>
        <td><a class="row-title" href="#/delivery/${d.id}">${esc(d.product)}</a><div class="row-sub">PO ${esc(d.poNumber)} · item ${esc(d.poItem)} · ${nz(d.units)} ${esc(d.unit)}</div></td>
        <td>${esc(d.supplierName)}<div class="row-sub">${esc(d.supplierId)}</div></td>
        <td>${esc(d.origin.name.split(',')[0])} → ${esc(d.dc.name.replace('Kmart DC – ', ''))}</td>
        <td>${esc(d.stage)}</td>
        <td class="num">${d.case && d.case.newEta ? `${fmtDate(d.case.newEta)}<div class="row-sub">recovery plan</div>` : `${fmtDate(d.eta)}${late ? `<div class="row-sub" style="color:var(--danger)">+${late.impact.daysLate} days</div>` : ''}`}</td>
        <td>${statusChip(d.status)}</td>
        <td class="r"><a class="btn ${d.problems.length && !d.case ? '' : 'btn-secondary'} btn-sm" href="#/${d.case ? 'case/' + d.case.id : 'delivery/' + d.id}">${d.case ? 'View recovery' : d.problems.length ? 'Investigate' : 'Track'}</a></td></tr>`;
    }).join('') : `<tr><td colspan="7"><div class="empty">${icon('search')}<div>No purchase orders match this filter.</div></div></td></tr>`;
  };
  $$('#delSeg button').forEach(b => b.onclick = () => { STATE.delFilter = b.dataset.f; $$('#delSeg button').forEach(x => x.classList.toggle('on', x === b)); renderRows(); });
  $('#delSearch').addEventListener('input', e => { STATE.delSearch = e.target.value; renderRows(); });
  renderRows();
  drawNetworkMap($('#netMap'), list);
}

async function loadDelivery(id) {
  const d = await api('/api/deliveries/' + encodeURIComponent(id));
  return d;
}
function deliveryHeader(d, sub) {
  return `<div class="page-head"><div><h1 class="page-title">${esc(d.product)}</h1>
    <p class="page-sub">${sub || `PO ${esc(d.poNumber)} · ${esc(d.supplierName)} · ${esc(d.origin.name)} → ${esc(d.dc.name)}`}</p></div>
    <div class="btn-row">${statusChip(d.status)}</div></div>`;
}

async function viewDelivery(id) {
  setNav('deliveries');
  loadingView('Loading shipment…');
  let d; try { d = await loadDelivery(id); } catch (e) { return errorView(e.message); }
  crumbs([{ label: 'Delivery Tracker', href: '#/deliveries' }, { label: d.product }, { label: 'Understand' }]);
  const item = d.sap && d.sap.item;
  const sl = item && item.scheduleLines && item.scheduleLines[0];
  const late = d.problems.find(p => p.type === 'delay');
  const tl = d.milestones.map((m, i) => {
    const isCurrent = !m.done && (i === 0 || d.milestones[i - 1].done);
    const slip = !m.done && late && i >= 3;
    return `<li class="${m.done ? 'done' : ''} ${isCurrent ? 'current' : ''} ${slip ? 'late' : ''}">
      <span class="tl-dot">${m.done ? icon('tick', 'i-sm') : ''}</span>
      <div class="tl-title">${esc(m.label)}</div>
      <div class="tl-meta">${m.place ? esc(m.place.name) + ' · ' : ''}${m.done ? 'Done ' + fmtDate(m.actual) : 'Planned ' + fmtDate(m.planned)}${slip ? ' · <span class="late">now later</span>' : ''}</div></li>`;
  }).join('');
  const cta = d.case
    ? `<a class="btn" href="#/case/${d.case.id}">View recovery case ${icon('right', 'i-sm')}</a>`
    : d.problems.length ? `<a class="btn" href="#/delivery/${d.id}/problem">Identify the problem ${icon('right', 'i-sm')}</a>` : '';
  setApp(`
    ${stepper(DEL_STEPS, 1)}
    ${deliveryHeader(d)}
    ${d.problems.length && !d.case ? `<div class="banner banner-danger">${icon('alert')}<div><strong>${d.problems.length} problem${d.problems.length > 1 ? 's' : ''} detected:</strong> ${d.problems.map(p => esc(p.title)).join(' · ')}</div></div>` : ''}
    ${!d.problems.length ? `<div class="banner banner-ok">${icon('check')}<div><strong>No issues detected.</strong> This order is on schedule for ${fmtDate(d.eta)}.</div></div>` : ''}
    <div class="grid g-map">
      <div class="card"><div class="card-head"><h2 class="section-title">${icon('pin')} Where it is now</h2><span class="tag">Carrier feed (simulated)</span></div>
        <div class="map" id="shipMap"></div>
        <div class="legend"><span><i class="lg-dot" style="background:#E4002B"></i>Travelled</span><span><i class="lg-dot" style="background:#6B7280"></i>Remaining route</span><span><i class="lg-dot" style="background:#1F2937"></i>Origin</span><span><i class="lg-dot" style="background:#1D4ED8"></i>Port</span><span><i class="lg-dot" style="background:#0E7A43"></i>Kmart DC</span></div></div>
      <div class="card"><h2 class="section-title">${icon('clock')} Journey</h2><ul class="timeline">${tl}</ul>
        <p class="small muted" style="margin:0">Latest carrier event: ${esc(d.feedEvent)}</p></div>
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><h2 class="section-title">${icon('box')} Shipment</h2>
        <div class="kv">
          <div><div class="k">Expected at DC</div><div class="v">${fmtDate(d.eta)}</div></div>
          <div><div class="k">Promised</div><div class="v">${fmtDate(d.promised)}</div></div>
          <div><div class="k">In-store launch</div><div class="v">${fmtDate(d.launch)}</div></div>
          <div><div class="k">Units</div><div class="v">${nz(d.units)} ${esc(d.unit)}</div></div>
          <div><div class="k">Stock value</div><div class="v">${money(d.value)}</div></div>
          <div><div class="k">Stores</div><div class="v">${nz(d.storesAffected)}</div></div>
          <div><div class="k">Vessel</div><div class="v">${esc(d.vessel)}</div></div>
          <div><div class="k">Container</div><div class="v">${esc(d.container)}</div></div>
          <div><div class="k">Stage</div><div class="v">${esc(d.stage)}</div></div>
        </div></div>
      <div class="card"><div class="card-head"><h2 class="section-title">${icon('db')} SAP purchase order</h2>${sourceLine(d)}</div>
        <div class="kv">
          <div><div class="k">Purchase order</div><div class="v">${esc(d.poNumber)}</div></div>
          <div><div class="k">Item</div><div class="v">${esc(d.poItem)}</div></div>
          <div><div class="k">Supplier</div><div class="v">${esc(d.supplierId)}</div></div>
          <div><div class="k">Material</div><div class="v mono">${esc(item ? item.Material : '—')}</div></div>
          <div><div class="k">Plant</div><div class="v">${esc(item ? item.Plant : '—')}</div></div>
          <div><div class="k">Order quantity</div><div class="v">${item ? nz(item.OrderQuantity) + ' ' + esc(item.PurchaseOrderQuantityUnit) : '—'}</div></div>
          ${sl ? `<div><div class="k">SAP delivery date</div><div class="v">${fmtDate(sl.ScheduleLineDeliveryDate)}</div></div>
                  <div><div class="k">Originally promised (SAP)</div><div class="v">${fmtDate(sl.SchedLineStscDeliveryDate)}</div></div>
                  <div><div class="k">Open quantity</div><div class="v">${sl.OpenPurchaseOrderQuantity != null ? nz(sl.OpenPurchaseOrderQuantity) : '—'}</div></div>` : ''}
        </div>
        <p class="source">${icon('info', 'i-sm')} ${sl ? 'Schedule line read from SAP (_PurchaseOrderScheduleLineTP).' : 'Schedule lines load when SAP is reachable; carrier dates are shown meanwhile.'} Item text in the sandbox: “${esc(item ? item.PurchaseOrderItemText : '—')}”.</p></div>
    </div>
    <div class="btn-row" style="margin-top:16px;justify-content:space-between"><a class="btn btn-secondary" href="#/deliveries">${icon('left', 'i-sm')} All deliveries</a>${cta}</div>`);
  drawShipmentMap($('#shipMap'), d);
}

async function viewProblem(id) {
  setNav('deliveries');
  loadingView('Diagnosing…');
  let d; try { d = await loadDelivery(id); } catch (e) { return errorView(e.message); }
  if (d.case) { location.hash = '#/case/' + d.case.id; return; }
  crumbs([{ label: 'Delivery Tracker', href: '#/deliveries' }, { label: d.product, href: '#/delivery/' + id }, { label: 'Identify problem' }]);
  if (!d.problems.length) {
    setApp(`${stepper(DEL_STEPS, 2)}<div class="card empty">${icon('check')}<div><strong>No problem found.</strong></div><p>This order is on track.</p><a class="btn btn-secondary" href="#/delivery/${id}">Back</a></div>`);
    return;
  }
  const cards = d.problems.map((p, i) => `<div class="problem ${p.severity}">
    <div class="btn-row">${sevChip(p.severity)}${i === 0 && d.problems.length > 1 ? '<span class="chip chip-red">Primary issue</span>' : ''}</div>
    <h3>${esc(p.title)}</h3>
    <p style="margin:0">${esc(p.explanation)}</p>
    <div class="impact">
      <div><div class="k">Units affected</div><div class="v num">${nz(p.impact.units)}</div></div>
      <div><div class="k">Stock value at risk</div><div class="v num">${money(p.impact.value)}</div></div>
      <div><div class="k">${p.type === 'delay' ? 'Days late' : 'Stores affected'}</div><div class="v num">${p.type === 'delay' ? p.impact.daysLate : nz(p.impact.storesAffected)}</div></div>
      <div><div class="k">${p.type === 'delay' ? 'Stores affected' : 'Share of order'}</div><div class="v num">${p.type === 'delay' ? nz(p.impact.storesAffected) : (d.units ? Math.round(p.impact.units / d.units * 100) + '%' : '—')}</div></div>
    </div>
    <p class="small" style="margin:12px 0 0"><strong>Why it matters:</strong> ${esc(p.impact.note)}</p>
    <p class="source">${icon('db', 'i-sm')} Detected from: ${esc(p.source)}</p></div>`).join('');
  setApp(`
    ${stepper(DEL_STEPS, 2)}
    ${deliveryHeader(d, `PO ${esc(d.poNumber)} · item ${esc(d.poItem)} · ${esc(d.supplierName)}`)}
    <div class="grid g-main">
      <div>${cards}</div>
      <div class="card"><h2 class="section-title">${icon('info')} How problems are detected</h2>
        <ul class="small" style="margin:0;padding-left:18px;line-height:1.7">
          <li><strong>Delay:</strong> SAP delivery date is later than the originally promised date (schedule line), or the carrier ETA has slipped.</li>
          <li><strong>Short delivery:</strong> DC goods receipt is less than the SAP order quantity.</li>
          <li><strong>Damage:</strong> cartons rejected at DC inbound inspection.</li>
          <li><strong>Supplier rejection / block:</strong> SAP item flags <span class="mono">ItemIsRejectedBySupplier</span> and <span class="mono">PurgItemIsBlockedForDelivery</span>.</li>
        </ul></div>
    </div>
    <div class="btn-row" style="margin-top:16px;justify-content:space-between"><a class="btn btn-secondary" href="#/delivery/${id}">${icon('left', 'i-sm')} Back</a>
      <a class="btn" href="#/delivery/${id}/action">Choose what to do ${icon('right', 'i-sm')}</a></div>`);
}

async function viewAction(id) {
  setNav('deliveries');
  loadingView('Preparing options…');
  let d; try { d = await loadDelivery(id); } catch (e) { return errorView(e.message); }
  if (d.case) { location.hash = '#/case/' + d.case.id; return; }
  if (!d.options || !d.options.length) { location.hash = '#/delivery/' + id; return; }
  crumbs([{ label: 'Delivery Tracker', href: '#/deliveries' }, { label: d.product, href: '#/delivery/' + id }, { label: 'Choose action' }]);
  const p = d.problems[0];
  let chosen = STATE.chosenAction[id] || (d.options.find(o => o.recommended) || d.options[0]).id;
  const fmtCost = c => c == null ? '—' : c < 0 ? `${money(-c)} back` : c === 0 ? 'No extra cost' : money(c);
  const opts = d.options.map(o => `<label class="option ${o.id === chosen ? 'selected' : ''}" data-id="${o.id}">
    <div class="btn-row" style="justify-content:space-between"><input type="radio" name="act" value="${o.id}" ${o.id === chosen ? 'checked' : ''}>${o.recommended ? '<span class="chip chip-green">Recommended</span>' : ''}</div>
    <h3>${esc(o.title)}</h3><p class="small muted" style="margin:0">${esc(o.summary)}</p>
    <div class="metrics"><div><div class="k">Cost</div><div class="v">${fmtCost(o.cost)}</div></div>
      <div><div class="k">On shelf</div><div class="v">${o.daysToShelf == null ? 'Not restocked' : o.daysToShelf <= 0 ? 'Now' : o.daysToShelf + ' days'}</div></div>
      <div><div class="k">Stock-out risk</div><div class="v">${esc(o.stockOutRisk)}</div></div></div></label>`).join('');
  setApp(`
    ${stepper(DEL_STEPS, 3)}
    ${deliveryHeader(d, `${esc(p.title)} · ${money(p.impact.value)} at risk`)}
    <div class="card"><h2 class="section-title">Choose what to do</h2><div class="options" id="opts">${opts}</div></div>
    <div class="grid g-main" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 class="section-title">${icon('db')} SAP changes for this action</h2><span class="muted small">plus an audit note on the PO</span></div><div id="preview"></div></div>
      <div class="card"><h2 class="section-title">Note to supplier & team</h2>
        <textarea class="input" id="comment" placeholder="Optional – e.g. agreed with supplier rep on the phone">${esc(STATE.commentDraft || '')}</textarea>
        <p class="small muted">Saved in the SAP purchase order note and the recovery case.</p></div>
    </div>
    <div class="btn-row" style="margin-top:16px;justify-content:space-between"><a class="btn btn-secondary" href="#/delivery/${id}/problem">${icon('left', 'i-sm')} Back</a>
      <button class="btn" id="goBtn">Start recovery ${icon('right', 'i-sm')}</button></div>`);
  const renderPreview = () => {
    const o = d.options.find(x => x.id === chosen);
    $('#preview').innerHTML = renderRequests(o.requests);
  };
  $$('#opts .option').forEach(el => el.addEventListener('click', () => {
    chosen = el.dataset.id; STATE.chosenAction[id] = chosen;
    $$('#opts .option').forEach(x => { x.classList.toggle('selected', x === el); x.querySelector('input').checked = x === el; });
    renderPreview();
  }));
  $('#comment').addEventListener('input', e => { STATE.commentDraft = e.target.value; });
  renderPreview();
  $('#goBtn').onclick = async () => {
    const o = d.options.find(x => x.id === chosen);
    const ok = await confirmDialog({ title: 'Start this recovery?', message: `<strong>${esc(o.title)}</strong> for ${esc(d.product)}. ${o.requests.length + 1} SAP request(s) will be ${CFG.sapWriteMode === 'live' ? 'sent' : 'built (simulation mode)'} and a recovery case opened.`, confirmText: 'Start recovery' });
    if (!ok) return;
    const btn = $('#goBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…';
    try {
      const r = await api(`/api/deliveries/${id}/recovery`, { method: 'POST', body: JSON.stringify({ actionId: chosen, comment: $('#comment').value }) });
      STATE.commentDraft = ''; delete STATE.chosenAction[id];
      toast(`Recovery ${r.case.id} opened`); refreshNavCount();
      location.hash = '#/case/' + r.case.id;
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = 'Start recovery ' + icon('right', 'i-sm'); }
  };
}

async function viewCase(caseId) {
  setNav('deliveries');
  loadingView('Loading recovery case…');
  let r; try { r = await api('/api/cases/' + encodeURIComponent(caseId)); } catch (e) { return errorView(e.message); }
  const c = r.case, d = r.shipment;
  crumbs([{ label: 'Delivery Tracker', href: '#/deliveries' }, { label: d.product, href: '#/delivery/' + d.id }, { label: 'Recovery ' + c.id }]);
  const resolved = c.status === 'Resolved';
  const steps = c.steps.map((s, i) => {
    const h = c.history.find(x => x.step === s);
    const cls = i < c.stepIndex || resolved ? 'done' : i === c.stepIndex ? 'current' : 'pending';
    return `<div class="case-step ${cls}"><span class="n">${cls === 'done' ? icon('tick', 'i-sm') : i + 1}</span><span class="t">${esc(s)}</span><span class="small muted">${h ? fmtDateTime(h.at) : 'Pending'}</span></div>`;
  }).join('');
  setApp(`
    ${stepper(DEL_STEPS, resolved ? 5 : 4)}
    <div class="page-head"><div><h1 class="page-title">Recovery ${esc(c.id)} · ${esc(d.product)}</h1>
      <p class="page-sub">${esc(c.problem.title)} → ${esc(c.action.title)}</p></div>
      <div class="btn-row">${statusChip(resolved ? 'Resolved' : 'Recovery in progress')}</div></div>
    ${simBanner()}
    <div class="grid g-main">
      <div class="card"><div class="card-head"><h2 class="section-title">${icon('reset')} Recovery progress</h2><span class="muted small">Owner: ${esc(c.owner)}</span></div>
        <div class="case-steps">${steps}</div>
        <div class="btn-row" style="margin-top:14px;justify-content:space-between">
          <span class="small muted">${resolved ? 'All steps complete.' : 'In production these updates come from the supplier and carrier. For the demo, advance them here.'}</span>
          ${resolved ? `<a class="btn" href="#/case/${c.id}/complete">Complete ${icon('right', 'i-sm')}</a>` : `<button class="btn" id="advBtn">${icon('play', 'i-sm')} Mark “${esc(c.steps[c.stepIndex + 1])}”</button>`}
        </div></div>
      <div class="stack">
        <div class="card"><h2 class="section-title">Plan</h2>
          <div class="kv c2">
            <div><div class="k">Problem</div><div class="v">${esc(c.problem.title)}</div></div>
            <div><div class="k">Severity</div><div class="v">${esc(c.problem.severity)}</div></div>
            <div><div class="k">Action</div><div class="v">${esc(c.action.title)}</div></div>
            <div><div class="k">Units</div><div class="v">${nz(c.problem.units)}</div></div>
            <div><div class="k">New on-shelf date</div><div class="v">${c.newEta ? fmtDate(c.newEta) : 'Not restocked'}</div></div>
            <div><div class="k">Cost impact</div><div class="v">${c.action.cost < 0 ? money(-c.action.cost) + ' credit' : c.action.cost ? money(c.action.cost) : 'None'}</div></div>
          </div>
          ${c.comment ? `<p class="small" style="margin:12px 0 0"><strong>Note:</strong> ${esc(c.comment)}</p>` : ''}
          <div class="btn-row" style="margin-top:14px"><button class="btn btn-secondary btn-sm" onclick="showWrite('${esc(c.writeId)}')">${icon('code', 'i-sm')} View SAP requests</button><a class="btn btn-ghost btn-sm" href="#/delivery/${d.id}">Shipment details</a></div></div>
        <div class="card"><h2 class="section-title">${icon('pin')} Route</h2><div class="map sm" id="caseMap"></div></div>
      </div>
    </div>`);
  const adv = $('#advBtn');
  if (adv) adv.onclick = async () => {
    adv.disabled = true;
    try { const x = await api(`/api/cases/${c.id}/advance`, { method: 'POST' }); toast(`${c.id}: ${x.case.status}`); viewCase(c.id); }
    catch (e) { toast(e.message, 'err'); adv.disabled = false; }
  };
  const full = await loadDelivery(d.id).catch(() => null);
  if (full) drawShipmentMap($('#caseMap'), full);
}

async function viewComplete(caseId) {
  setNav('deliveries');
  loadingView('Loading…');
  let r; try { r = await api('/api/cases/' + encodeURIComponent(caseId)); } catch (e) { return errorView(e.message); }
  const c = r.case, d = r.shipment;
  if (c.status !== 'Resolved') { location.hash = '#/case/' + caseId; return; }
  crumbs([{ label: 'Delivery Tracker', href: '#/deliveries' }, { label: d.product }, { label: 'Complete' }]);
  const isCredit = c.action.id === 'refund';
  const hours = Math.max(1, Math.round((new Date(c.resolvedAt) - new Date(c.createdAt)) / 3600000));
  setApp(`
    ${stepper(DEL_STEPS, 6)}
    <div class="card success"><div class="ok-ico">${icon('tick')}</div>
      <h2>${isCredit ? 'Refund complete' : c.action.id === 'replacement' ? 'Replacement complete' : 'Recovery complete'}</h2>
      <p class="muted">${esc(d.product)} · case ${esc(c.id)} · PO ${esc(c.poNumber)}</p></div>
    <div class="card"><h2 class="section-title">Summary</h2>
      <div class="kv">
        <div><div class="k">Problem</div><div class="v">${esc(c.problem.title)}</div></div>
        <div><div class="k">Action taken</div><div class="v">${esc(c.action.title)}</div></div>
        <div><div class="k">Units recovered</div><div class="v">${nz(c.problem.units)}</div></div>
        <div><div class="k">${isCredit ? 'Credit received' : 'Stock value protected'}</div><div class="v">${money(c.problem.value)}</div></div>
        <div><div class="k">${c.newEta ? 'Back on shelf' : 'Outcome'}</div><div class="v">${c.newEta ? fmtDate(c.newEta) : 'Line closed'}</div></div>
        <div><div class="k">Time to resolve</div><div class="v">${hours < 48 ? hours + ' h' : Math.round(hours / 24) + ' days'}</div></div>
      </div>
      <div class="btn-row" style="margin-top:18px;justify-content:space-between">
        <button class="btn btn-secondary" onclick="showWrite('${esc(c.writeId)}')">${icon('code', 'i-sm')} View SAP requests</button>
        <a class="btn" href="#/deliveries">Back to Delivery Tracker</a></div></div>`);
}

// =====================================================================
// HISTORY
// =====================================================================
async function viewHistory() {
  setNav('history'); crumbs([{ label: 'Audit' }, { label: 'History' }]);
  loadingView('Loading history…');
  let writes, cases;
  try { [writes, cases] = await Promise.all([api('/api/writes').then(x => x.writes), api('/api/cases').then(x => x.cases)]); }
  catch (e) { return errorView(e.message); }
  setApp(`
    <div class="page-head"><div><h1 class="page-title">History</h1><p class="page-sub">Every mix lock and delivery recovery, with the exact SAP requests behind it.</p></div>
      <div class="seg" id="hSeg">${['all:All', 'mixlock:Mix-lock', 'recovery:Delivery recovery'].map(x => { const [k, l] = x.split(':'); return `<button data-f="${k}" class="${STATE.historyFilter === k ? 'on' : ''}">${l}</button>`; }).join('')}</div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Type</th><th>Item</th><th>SAP PO</th><th>Outcome</th><th>When</th><th>Mode</th><th></th></tr></thead><tbody id="hRows"></tbody></table></div></div>`);
  const render = () => {
    const rows = writes.filter(w => STATE.historyFilter === 'all' || w.kind === STATE.historyFilter);
    $('#hRows').innerHTML = rows.length ? rows.map(w => {
      const m = w.meta || {};
      const kase = w.kind === 'recovery' ? cases.find(c => c.writeId === w.id) : null;
      const outcome = w.kind === 'mixlock'
        ? `${nz(m.units)} units locked${m.riskBefore != null ? ` · risk saved ${money(m.riskBefore - m.riskAfter)}` : ''}`
        : `${esc(m.action || '')} · ${nz(m.units)} units${kase ? ` · ${statusChip(kase.status === 'Resolved' ? 'Resolved' : 'Recovery in progress')}` : ''}`;
      return `<tr>
        <td>${w.kind === 'mixlock' ? `<span class="chip chip-blue">${icon('grid', 'i-sm')} Mix-lock</span>` : `<span class="chip chip-neutral">${icon('truck', 'i-sm')} Recovery</span>`}</td>
        <td><span class="row-title">${esc(m.lineName || m.product || w.title)}</span>${kase ? `<div class="row-sub"><a href="#/case/${kase.id}">${esc(kase.id)}</a> · ${esc(m.problem || '')}</div>` : ''}</td>
        <td class="num">${esc(w.poNumber)}</td>
        <td>${outcome}</td>
        <td>${fmtDateTime(w.createdAt)}</td>
        <td>${w.mode === 'live' ? '<span class="chip chip-green">Live</span>' : '<span class="chip chip-warn">Simulated</span>'}</td>
        <td class="r"><button class="btn btn-secondary btn-sm" onclick="showWrite('${esc(w.id)}')">${icon('code', 'i-sm')} SAP request</button></td></tr>`;
    }).join('') : `<tr><td colspan="7"><div class="empty">${icon('history')}<div>Nothing here yet. Lock a mix or start a delivery recovery and it will appear here.</div></div></td></tr>`;
  };
  $$('#hSeg button').forEach(b => b.onclick = () => { STATE.historyFilter = b.dataset.f; $$('#hSeg button').forEach(x => x.classList.toggle('on', x === b)); render(); });
  render();
}

// =====================================================================
// ROUTER & SHELL
// =====================================================================
async function router() {
  closeModal();
  const parts = (location.hash || '#/mixlock').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [a, b, c] = parts;
  if (a === 'line' && b) return viewLine(b);
  if (a === 'adjust' && b) return viewAdjust(b);
  if (a === 'confirm' && b) return viewConfirm(b);
  if (a === 'locked' && b) return viewLocked(b);
  if (a === 'deliveries') return viewDeliveries();
  if (a === 'delivery' && b && c === 'problem') return viewProblem(b);
  if (a === 'delivery' && b && c === 'action') return viewAction(b);
  if (a === 'delivery' && b) return viewDelivery(b);
  if (a === 'case' && b && c === 'complete') return viewComplete(b);
  if (a === 'case' && b) return viewCase(b);
  if (a === 'history') return viewHistory();
  return viewMixDashboard();
}
function refreshNavCount() { api('/api/deliveries').then(d => { updateNavCount(d.deliveries); updateSapChip(d.sapStatus); }).catch(() => {}); }

function initShell() {
  $('#navToggle').innerHTML = icon('menu');
  $('#navToggle').onclick = () => $('#sidebar').classList.toggle('open');
  $('.nav a[data-nav="mixlock"]').innerHTML = icon('grid') + 'Mix-Lock';
  $('.nav a[data-nav="deliveries"]').innerHTML = icon('truck') + 'Delivery Tracker<span class="count" hidden></span>';
  $('.nav a[data-nav="history"]').innerHTML = icon('history') + 'History';
  $('#resetDemo').innerHTML = icon('reset', 'i-sm') + 'Reset demo';
  $('#resetDemo').onclick = async () => {
    const ok = await confirmDialog({ title: 'Reset the demo?', message: 'This clears all mix locks, recovery cases and saved SAP requests so every line starts fresh. Cached SAP data is kept.', confirmText: 'Reset demo' });
    if (!ok) return;
    try { await api('/api/reset-state', { method: 'POST' }); STATE.adjust = null; STATE.chosenAction = {}; toast('Demo reset'); router(); refreshNavCount(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

async function init() {
  initShell();
  try {
    CFG = await api('/api/config');
    $('#modeChip').className = CFG.sapWriteMode === 'live' ? 'chip chip-green' : 'chip chip-warn';
    $('#modeChip').textContent = CFG.sapWriteMode === 'live' ? 'Writes live' : 'Writes simulated';
    updateSapChip(CFG.sapStatus);
  } catch (e) {}
  window.addEventListener('hashchange', router);
  router();
  refreshNavCount();
}
init();
