const assert = require('node:assert/strict');
const { harness } = require('./customerAssist.test');

async function create(app, optionId = 'refund') {
  const response = await app.request('/api/assist/orders/KM185002/recovery', { optionId });
  assert.equal(response.status, 200);
  return response.body.recoveryCase;
}
async function action(app, id, type, extra = {}) {
  const response = await app.staffRequest(`/api/assist/staff/cases/${id}`, {}, 'GET');
  return app.staffRequest(`/api/assist/staff/cases/${id}/actions`, {
    action: type, version: response.body.case.version, message: 'Customer-visible staff update.', ...extra
  });
}

async function run() {
  const app = harness();
  const entry = await create(app);
  const path = `/api/assist/staff/cases/${entry.id}`;
  assert.equal((await app.request('/api/assist/staff/cases', {}, 'GET')).status, 401);
  assert.equal((await app.request(path + '/actions', { action: 'approve' })).status, 401);
  assert.equal((await app.staffLogin('Reviewer', 'WRONG')).status, 401);
  const loggedIn = await app.staffLogin('Recovery reviewer');
  assert.equal(loggedIn.status, 200);
  assert.match(loggedIn.headers['set-cookie'], /HttpOnly/);
  assert.match(loggedIn.headers['set-cookie'], /SameSite=Strict/);
  assert.match(loggedIn.headers['set-cookie'], /Path=\/api\/assist\/staff/);
  assert.doesNotMatch(JSON.stringify(loggedIn.body), /TEST-STAFF-CODE/);
  const before = app.state();
  assert.equal((await action(app, entry.id, 'record_outcome', { reference: 'FIN-1', occurredAt: new Date().toISOString() })).status, 409);
  assert.equal((await app.staffRequest(path + '/actions', { action: 'start_review', version: 9, message: 'Reviewing this request.' })).status, 409);
  assert.equal((await app.staffRequest(path + '/actions', { action: 'start_review', version: 0, message: 'Reviewing this request.', amount: 999 })).status, 400);
  assert.equal((await app.staffRequest(path + '/actions', { action: 'start_review', version: 0, message: 'Reviewing this request.' }, 'POST', { origin: 'https://other.example' })).status, 403);
  assert.deepEqual(app.state(), before);
  const review = await action(app, entry.id, 'start_review', { internalNote: 'PRIVATE-STAFF-NOTE' });
  assert.equal(review.status, 200);
  assert.equal(review.body.case.operations.stage, 'reviewing');
  const publicRead = await app.request('/api/assist/orders/KM185002', {}, 'GET');
  assert.doesNotMatch(JSON.stringify(publicRead.body), /PRIVATE-STAFF-NOTE/);
  assert.equal((await app.staffRequest(path, {}, 'GET')).body.case.audit[0].actor.name, 'Recovery reviewer');
  assert.equal((await action(app, entry.id, 'approve')).status, 200);
  assert.equal((await app.request(`/api/assist/cases/${entry.id}/complete`)).status, 409);
  const approved = app.state();
  for (const extra of [
    { reference: '', occurredAt: new Date().toISOString() },
    { reference: 'FIN-1', occurredAt: 'invalid' },
    { reference: 'FIN-1', occurredAt: new Date(Date.now() + 86400000).toISOString() },
    { reference: '<script>', occurredAt: new Date().toISOString() },
    { reference: 'FIN-1', occurredAt: new Date().toISOString(), externallyVerified: true }
  ]) {
    assert.equal((await action(app, entry.id, 'record_outcome', extra)).status, 400);
    assert.deepEqual(app.state(), approved);
  }
  const recorded = await action(app, entry.id, 'record_outcome', {
    reference: 'FIN-TEST-1001', occurredAt: new Date().toISOString(), message: 'Finance supplied a confirmation reference.'
  });
  assert.equal(recorded.status, 200);
  const customer = await app.request(`/api/assist/cases/${entry.id}`, {}, 'GET');
  assert.equal(customer.body.recoveryCase.readyForCompletion, true);
  assert.equal(customer.body.recoveryCase.operations.outcome.source, 'staff_recorded');
  assert.equal(customer.body.recoveryCase.operations.outcome.externallyVerified, false);
  assert.match(customer.body.recoveryCase.outcomeCopy.heading, /confirmation recorded/);
  assert.doesNotMatch(customer.body.recoveryCase.outcomeCopy.heading, /paid|issued/i);
  assert.equal(customer.body.recoveryCase.requests.length, 1);
  assert.equal((await app.request(`/api/assist/cases/${entry.id}/advance`)).status, 410);
  const done = await app.request(`/api/assist/cases/${entry.id}/complete`);
  assert.equal(done.body.recoveryCase.status, 'closed');
  assert.equal(done.body.recoveryCase.requests.at(-1).body.RequestedAmount, 18);
  assert.match(done.body.recoveryCase.requests.at(-1).body.settlement, /does not process payments/);
  assert.ok(done.body.recoveryCase.customerAcknowledgedAt);
  const closed = app.state();
  assert.equal((await action(app, entry.id, 'approve')).status, 409);
  assert.equal((await app.request('/api/assist/orders/KM185002/reset')).status, 409);
  assert.equal((await app.request('/api/assist/reset')).status, 409);
  assert.deepEqual(app.state(), closed);
  await app.staffRequest('/api/assist/staff/logout', {});
  assert.equal((await app.staffRequest('/api/assist/staff/cases', {}, 'GET')).status, 401);

  // Rejection requires review and a customer-visible reason. Acknowledgement
  // closes the decision without creating any refund/fulfilment write.
  const declined = harness();
  const rejectedCase = await create(declined);
  await action(declined, rejectedCase.id, 'start_review');
  assert.equal((await action(declined, rejectedCase.id, 'reject', { message: '' })).status, 400);
  const rejection = await action(declined, rejectedCase.id, 'reject', { message: 'The supplied evidence could not be confirmed. Please contact customer care.' });
  assert.equal(rejection.body.case.operations.stage, 'rejected');
  const rejectionRead = await declined.request(`/api/assist/cases/${rejectedCase.id}`, {}, 'GET');
  assert.equal(rejectionRead.body.recoveryCase.outcomeCopy.heading, 'Recovery request declined');
  const acknowledged = await declined.request(`/api/assist/cases/${rejectedCase.id}/complete`);
  assert.equal(acknowledged.body.recoveryCase.status, 'closed');
  assert.equal(acknowledged.body.recoveryCase.requests.length, 1);
  assert.equal(acknowledged.body.recoveryCase.outcomeCopy.heading, 'Decision acknowledged');
  assert.equal(declined.calls.length, 0);

  const replacement = harness();
  const replaceCase = await create(replacement, 'replace');
  await action(replacement, replaceCase.id, 'start_review'); await action(replacement, replaceCase.id, 'approve');
  assert.equal((await action(replacement, replaceCase.id, 'record_outcome', { reference: 'BOOK-1', occurredAt: new Date().toISOString() })).status, 400);
  const arranged = await action(replacement, replaceCase.id, 'record_outcome', { reference: 'BOOK-1', occurredAt: new Date().toISOString(), scheduledDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
  assert.equal(arranged.status, 200);
  assert.equal(arranged.body.case.amount, 0);
  assert.equal(arranged.body.case.affectedValueMinor, 1800);

  // Two stale forms cannot record the same decision twice.
  const concurrent = harness();
  const simultaneous = await create(concurrent);
  await concurrent.staffLogin();
  const body = { action: 'start_review', version: 0, message: 'Reviewing this customer request.' };
  const responses = await Promise.all([concurrent.staffRequest(`/api/assist/staff/cases/${simultaneous.id}/actions`, body), concurrent.staffRequest(`/api/assist/staff/cases/${simultaneous.id}/actions`, body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(concurrent.state().cases.KM185002.operations.audit.length, 1);
  const locked = harness();
  for (let index = 0; index < 5; index += 1) assert.equal((await locked.staffLogin('Reviewer', 'WRONG')).status, 401);
  assert.equal((await locked.staffLogin()).status, 429);

  console.log('Recovery Management passed: authenticated staff actions, audited decisions, evidence validation, privacy, rejection and frozen amounts.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
