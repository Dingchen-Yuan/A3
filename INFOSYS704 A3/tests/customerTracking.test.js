const assert = require('node:assert/strict');
const { harness, ready } = require('./customerAssist.test');
const { readyCase } = require('./helpers/workflowFixture');

async function create(app) {
  const response = await app.request('/api/assist/orders/KM185002/recovery', { optionId: 'refund' });
  assert.equal(response.status, 200);
  return response.body.recoveryCase;
}

async function run() {
  const app = harness();
  const recoveryCase = await create(app);
  const path = '/api/assist/cases/' + recoveryCase.id;
  const before = app.state();
  const writes = app.writes;
  for (let index = 0; index < 20; index += 1) {
    const response = await app.request(path, {}, 'GET');
    assert.equal(response.status, 200);
    assert.equal(response.body.recoveryCase.status, 'open');
    assert.equal(response.body.recoveryCase.stepIndex, 0);
    assert.equal(response.body.recoveryCase.updatedAt, recoveryCase.updatedAt);
    assert.equal(response.body.recoveryCase.requests.length, 1);
    assert.equal(response.body.recoveryCase.readyForCompletion, false);
    assert.equal(response.body.recoveryCase.operations.stage, 'submitted');
    assert.equal(response.body.recoveryCase.demoControlsAvailable, undefined);
    assert.ok(Number.isFinite(Date.parse(response.body.recoveryCheckedAt)));
  }
  assert.deepEqual(app.state(), before);
  assert.equal(app.writes, writes);
  assert.equal(app.calls.length, 0);
  assert.equal((await app.request(path + '/complete')).status, 409);
  assert.equal((await app.request(path + '/advance', {}, 'GET')).status, 404);

  // Only authenticated staff decisions progress a case; the old endpoint is gone.
  assert.equal((await app.request(path + '/advance')).status, 410);
  const first = await app.staffRequest(`/api/assist/staff/cases/${recoveryCase.id}/actions`, { action: 'start_review', version: 0, message: 'Reviewing the selected items.' });
  assert.equal(first.body.case.stepIndex, 1);
  const afterAdvance = app.state();
  await app.request(path, {}, 'GET');
  assert.deepEqual(app.state(), afterAdvance);
  await ready(app, recoveryCase.id);
  const recorded = await app.request(path, {}, 'GET');
  assert.equal(recorded.body.recoveryCase.status, 'ready');
  assert.equal(recorded.body.recoveryCase.readyForCompletion, true);
  assert.equal(recorded.body.recoveryCase.operations.outcome.externallyVerified, false);
  const readyState = app.state();
  const readyWrites = app.writes;
  await app.request(path, {}, 'GET');
  assert.equal((await app.request(path + '/advance')).status, 410);
  assert.deepEqual(app.state(), readyState);
  assert.equal(app.writes, readyWrites);
  assert.equal((await app.request(path + '/complete')).body.recoveryCase.status, 'closed');
  const closedState = app.state();
  const closedWrites = app.writes;
  const closed = await app.request(path, {}, 'GET');
  assert.equal(closed.body.recoveryCase.status, 'closed');
  assert.equal(closed.body.recoveryCase.demoControlsAvailable, undefined);
  assert.equal(closed.body.recoveryCase.readyForCompletion, false);
  assert.deepEqual(app.state(), closedState);
  assert.equal(app.writes, closedWrites);

  // Live cases cannot be artificially advanced, even by directly calling the
  // old endpoint or by sending an explicit demo flag from a modified client.
  const live = harness({ mode: 'live', key: 'test-key', fetchImpl: () => ({ ok: true, status: 201, text: async () => '{}' }) });
  const liveCase = await create(live);
  const livePath = '/api/assist/cases/' + liveCase.id;
  const liveState = live.state();
  const liveWrites = live.writes;
  const liveCalls = live.calls.length;
  const liveRead = await live.request(livePath, {}, 'GET');
  assert.equal(liveRead.body.recoveryCase.operations.stage, 'submitted');
  assert.equal(liveRead.body.recoveryCase.demoControlsAvailable, undefined);
  assert.equal((await live.request(livePath + '/advance', { demo: true })).status, 410);
  assert.deepEqual(live.state(), liveState);
  assert.equal(live.writes, liveWrites);
  assert.equal(live.calls.length, liveCalls);
  // Switching the server to simulation mode does not turn a live case into a demo.
  const switched = harness({ initialState: liveState });
  assert.equal((await switched.request(livePath + '/advance')).status, 410);
  assert.equal(switched.writes, 0);
  // Nor are demo controls available on a live-mode server for an older demo case.
  const liveMode = harness({ mode: 'live', initialState: before });
  assert.equal((await liveMode.request(path + '/advance')).status, 410);
  assert.equal(liveMode.writes, 0);

  // A real service update can be read without the customer causing it.
  const updated = live.state();
  readyCase(updated.cases.KM185002);
  live.seedState(updated);
  const serviceUpdate = await live.request(livePath, {}, 'GET');
  assert.equal(serviceUpdate.body.recoveryCase.readyForCompletion, true);
  assert.equal(serviceUpdate.body.recoveryCase.demoControlsAvailable, undefined);
  assert.deepEqual(live.state(), updated);

  // Even an old case missing its SAP order snapshot must not populate caches
  // or call SAP merely because the customer refreshes its status.
  const orphan = harness({ key: 'test-key', initialState: {
    cases: { 'SAP-UNKNOWN': { ...recoveryCase, orderId: 'SAP-UNKNOWN' } }, problems: {}, orders: {}
  } });
  const orphanState = orphan.state();
  assert.equal((await orphan.request(path, {}, 'GET')).status, 404);
  assert.deepEqual(orphan.state(), orphanState);
  assert.equal(orphan.writes, 0);
  assert.equal(orphan.calls.length, 0);
  assert.equal((await app.request('/api/assist/cases/NOT-FOUND', {}, 'GET')).status, 404);

  console.log('Recovery tracking passed: read-only refresh, staff-controlled decisions and explicit customer acknowledgement.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
