'use strict';
const view = document.querySelector('#staffView');
let actor = null, cases = [], selected = null, token = 0;
let accessHintAvailable = false;
const labels = { submitted: 'Awaiting review', reviewing: 'Under review', approved: 'Approved — awaiting confirmation', outcome_recorded: 'Confirmation recorded', rejected: 'Declined', historical: 'Historical saved case' };
const actionLabels = { start_review: 'Begin review', approve: 'Approve request', reject: 'Decline request', record_outcome: 'Record confirmation' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value) || 0);
const time = value => value ? new Date(value).toLocaleString('en-AU') : 'Not recorded';
async function api(path, body) {
  const response = await fetch('/api/assist/staff' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'The action could not be completed.'); error.status = response.status; throw error; }
  return data;
}
function login(message = '') {
  token += 1;
  actor = null; cases = []; selected = null;
  view.innerHTML = `<p class="kicker">Staff access</p><h1>Recovery Management</h1><p class="lead">Review customer requests and record operational decisions with an audit trail.</p>
    <form class="staff-form staff-login" id="login"><label>Your staff name<input name="name" autocomplete="username" required minlength="2" maxlength="80"></label>
    <label>Staff access code<input name="accessCode" type="password" autocomplete="current-password" required></label>
    ${accessHintAvailable ? '<button class="btn secondary staff-hint-toggle" id="staffHintToggle" type="button" aria-controls="staffAccessHint" aria-expanded="false">Staff access code hint</button><div class="staff-code-hint" id="staffAccessHint" role="status" aria-live="polite" hidden><code id="revealedCode"></code><p class="field-hint">This is a public classroom code, not secure staff protection.</p></div>' : ''}
    <button class="btn" id="staffSignIn" type="submit">Sign in</button>
    <p class="field-hint">Shared-code prototype access, not Kmart SSO.${accessHintAvailable ? ' The hint is provided for local classroom use only.' : ' Use the private code configured by the project owner.'}</p>
    <p class="error" id="loginError" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p></form>`;
  document.querySelector('#login').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const data = await api('/login', { name: form.elements.name.value, accessCode: form.elements.accessCode.value });
      form.elements.accessCode.value = ''; actor = data.actor; await refresh();
    } catch (error) { button.disabled = false; const slot = document.querySelector('#loginError'); slot.hidden = false; slot.textContent = error.message; }
  });
  document.querySelector('#staffHintToggle')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const hint = document.querySelector('#staffAccessHint');
    if (!hint.hidden) { hint.hidden = true; button.setAttribute('aria-expanded', 'false'); button.textContent = 'Staff access code hint'; return; }
    const current = token;
    button.disabled = true;
    try {
      const data = await api('/access-hint');
      if (current !== token || !button.isConnected) return;
      document.querySelector('#revealedCode').textContent = data.accessCode;
      hint.hidden = false; button.setAttribute('aria-expanded', 'true'); button.textContent = 'Hide staff access code';
    } catch (error) {
      if (current !== token || !button.isConnected) return;
      const slot = document.querySelector('#loginError'); slot.hidden = false; slot.textContent = error.message;
    } finally { button.disabled = false; }
  });
}
function scope(items, currency) {
  return items && items.length ? `<ul class="recovery-items">${items.map(item => `<li><div><strong>${esc(item.name)}</strong><span>${esc(item.qty)} of ${esc(item.orderedQty)} units</span></div><span>${money(item.amount, currency)}</span></li>`).join('')}</ul>` : '<p class="meta">This older case has no item-level snapshot. Verify its original scope before making a decision.</p>';
}
function render(message = '') {
  const entry = cases.find(item => item.id === selected);
  view.innerHTML = `<div class="staff-heading"><div><p class="kicker">Operations</p><h1>Recovery Management</h1><p class="meta">Signed in as ${esc(actor.name)} · Staff-recorded updates</p></div>
    <div><button class="btn secondary" id="refresh">Refresh queue</button> <button class="btn secondary" id="logout">Sign out</button></div></div>
    <p class="field-hint">Approve genuine requests and record confirmation references from the relevant team. This app does not send money, reserve inventory or independently verify references.</p>
    ${message ? `<p class="staff-feedback" role="status">${esc(message)}</p>` : ''}
    <div class="staff-layout"><section><h2 class="section-title">Customer recovery queue</h2><div class="staff-queue">${cases.length ? cases.map(item => `<button class="staff-case ${item.id === selected ? 'selected' : ''}" data-case="${esc(item.id)}"><strong>${esc(item.customerReference)}</strong><span class="meta">${esc(item.customer)} · ${esc(item.id)}</span><span class="meta">${esc(item.title)} · ${money(item.amount, item.currency)}</span><span class="staff-stage">${esc(item.status === 'closed' ? 'Closed · ' + (labels[item.operations.stage] || 'Recorded') : labels[item.operations.stage])}</span></button>`).join('') : '<p class="meta">No customer requests yet. A customer must submit a recovery first.</p>'}</div></section>
    <section class="staff-detail">${entry ? detail(entry) : '<h2>Select a case</h2><p class="meta">Review the original customer choice and frozen quantities before recording an action.</p>'}</section></div>`;
  document.querySelector('#refresh').onclick = () => refresh().catch(handleError);
  document.querySelector('#logout').onclick = async () => { try { await api('/logout', {}); } finally { login(); } };
  view.querySelectorAll('[data-case]').forEach(button => button.onclick = () => { selected = button.dataset.case; render(); });
  bindAction(entry);
}
function detail(entry) {
  return `<h2>${esc(entry.id)}</h2><p class="meta">${esc(entry.customer)} · Order ${esc(entry.customerReference)} · Sales order ${esc(entry.salesOrder)}</p>
    <p>${esc(entry.problemTitle || entry.problemCode)}</p>${scope(entry.affectedItems, entry.currency)}
    <div class="facts"><div class="fact"><span>Frozen requested amount</span><strong>${money(entry.amount, entry.currency)}</strong></div><div class="fact"><span>Last updated</span><strong>${esc(time(entry.updatedAt))}</strong></div></div>
    ${entry.operations.outcome ? `<div class="banner">Staff-recorded reference: <strong>${esc(entry.operations.outcome.reference)}</strong><br>Not independently verified with the bank or carrier.</div>` : ''}
    <div class="staff-actions">${entry.allowedActions.length ? `<h3 class="section-title">Record a staff action</h3><form class="staff-form" id="actionForm"><label>Action<select name="action" id="actionType">${entry.allowedActions.map(action => `<option value="${action}">${action === 'record_outcome' ? (entry.outcome === 'refund' ? 'Record finance confirmation' : 'Record fulfilment arrangement') : actionLabels[action]}</option>`).join('')}</select></label>
      <label>Update / reason shown to the customer<textarea name="message" required minlength="5" maxlength="1000"></textarea></label>
      <label>Internal note (staff only)<textarea name="internalNote" maxlength="1000"></textarea></label>
      <div id="outcomeFields"><label>Finance or booking reference<input name="reference" minlength="3" maxlength="80"></label><label>Confirmation received at<input name="occurredAt" type="datetime-local"></label>
        ${entry.outcome !== 'refund' ? '<label>Arranged delivery / collection date<input name="scheduledDate" type="date"></label>' : ''}
        <p class="field-hint">Record only a reference supplied by the responsible team. Entering it here does not process or verify the external transaction.</p></div>
      <button class="btn" type="submit">Record action</button><p class="error" id="actionError" role="alert" hidden></p></form>` : '<p class="meta">No further staff action is available. Closed and historical decisions are retained.</p>'}</div>
    <h3 class="section-title">Audit trail</h3><ol class="staff-audit">${entry.audit.length ? entry.audit.map(event => `<li><strong>${esc(actionLabels[event.action] || event.action)} · ${esc(event.actor.name || event.actor.role)}</strong><span class="meta">${esc(time(event.at))}</span><p>${esc(event.message)}</p>${event.internalNote ? `<p class="meta">Internal note: ${esc(event.internalNote)}</p>` : ''}${event.reference ? `<p>Reference: ${esc(event.reference)}</p>` : ''}</li>`).join('') : '<li>No staff action has been recorded yet.</li>'}</ol>`;
}
function bindAction(entry) {
  const form = document.querySelector('#actionForm'); if (!form || !entry) return;
  let submitting = false;
  const update = () => {
    const recording = form.elements.action.value === 'record_outcome';
    document.querySelector('#outcomeFields').hidden = !recording;
    ['reference', 'occurredAt', 'scheduledDate'].forEach(name => { if (form.elements[name]) { form.elements[name].disabled = !recording; form.elements[name].required = recording; } });
  };
  form.elements.action.addEventListener('change', update); update();
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submitting) return; submitting = true; const button = form.querySelector('button'); button.disabled = true;
    const body = { action: form.elements.action.value, version: entry.version, message: form.elements.message.value };
    if (form.elements.internalNote.value.trim()) body.internalNote = form.elements.internalNote.value;
    if (body.action === 'record_outcome') {
      body.reference = form.elements.reference.value;
      const date = new Date(form.elements.occurredAt.value);
      body.occurredAt = Number.isFinite(date.getTime()) ? date.toISOString() : '';
      if (form.elements.scheduledDate) body.scheduledDate = form.elements.scheduledDate.value;
    }
    try { await api('/cases/' + encodeURIComponent(entry.id) + '/actions', body); await refresh(`Case ${entry.id}: staff update recorded. The customer can refresh their status.`); }
    catch (error) { if (error.status === 401) return login('Your staff session expired. Sign in again.'); submitting = false; if (!form.isConnected) return handleError(error); button.disabled = false; const slot = document.querySelector('#actionError'); slot.hidden = false; slot.textContent = error.message; }
  });
}
function handleError(error) { if (error.status === 401) login('Sign in to continue.'); else { view.insertAdjacentHTML('afterbegin', `<p class="error" role="alert">${esc(error.message)}</p>`); } }
async function refresh(message = '') {
  const request = ++token; const data = await api('/cases'); if (request !== token) return;
  cases = data.cases.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!selected && cases.length) selected = cases[0].id;
  render(message);
}
(async () => { try { const session = await api('/session'); accessHintAvailable = session.hintAvailable === true; if (!session.authenticated) return login(); actor = session.actor; await refresh(); } catch (error) { login(error.message); } })();
window.addEventListener('kmart:demo-reset', () => {
  location.reload();
});
