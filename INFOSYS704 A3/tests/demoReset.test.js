const assert = require('node:assert/strict');
const { serverFixture } = require('./helpers/serverFixture');
const { findOrder } = require('../data/customerOrders');
const { LINES } = require('../data/mockLines');

async function withApp(options, run) {
  const app = serverFixture(options);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  app.request = async (route, body, headers = {}) => {
    const options = body === undefined ? { headers } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    };
    const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try { await run(app); }
  finally {
    const closed = new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    app.server.closeAllConnections?.(); await closed;
  }
}

async function run() {
  await withApp({}, async app => {
    const snapshotOrder = { ...findOrder('KM184920'), id: 'SAP-990001', salesOrder: '990001', customerReference: 'SAP-TEST', source: 'sap', currency: 'USD', problem: null };
    app.seedJson('customer_state.json', { cases: {}, problems: {}, orders: { [snapshotOrder.id]: snapshotOrder } });
    app.seedJson('app_state.json', { locked: { 'fixture-line': { at: new Date().toISOString() } } });
    app.seedJson('recovery_cases.json', [{ id: 'RC-TEST', status: 'Request received' }]);
    app.seedJson('sap_write_store.json', [{ id: 'wr_test', mode: 'simulate', requests: [] }]);
    assert.equal((await app.request('/api/assist/orders/KM184920/problem', { code: 'DELAY' })).status, 200);
    const created = await app.request('/api/assist/orders/KM184920/recovery', { optionId: 'refund' });
    assert.equal(created.status, 200);
    const caseId = created.body.recoveryCase.id;
    const login = await app.request('/api/assist/staff/login', { name: 'Reset test reviewer', accessCode: 'INFOSYS_704' });
    assert.equal(login.status, 200);
    const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
    assert.equal((await app.request(`/api/assist/staff/cases/${caseId}/actions`, { action: 'start_review', version: 0, message: 'Reviewing the customer request.', internalNote: 'Test staff audit note.' }, headers)).status, 200);
    assert.equal(app.json('customer_state.json').cases.KM184920.operations.audit.length, 1);
    const before = app.snapshot(), writes = app.writes.length;
    for (const invalid of [undefined, {}, { confirmAll: false }, { confirmAll: 'true' }]) {
      const result = await app.request('/api/reset-state', invalid);
      assert.ok([400, 404].includes(result.status));
      assert.deepEqual(app.snapshot(), before);
    }
    assert.equal((await app.request('/api/reset-state', { confirmAll: true }, { origin: 'https://other.example' })).status, 403);
    assert.deepEqual(app.snapshot(), before);
    assert.equal(app.writes.length, writes);
    const cleared = await app.request('/api/reset-state', { confirmAll: true });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.resetModules, ['mixlock', 'deliveryTracker', 'deliveryAssist', 'recoveryManagement']);
    assert.deepEqual(app.json('app_state.json'), { locked: {} });
    assert.deepEqual(app.json('sap_write_store.json'), []);
    assert.deepEqual(app.json('recovery_cases.json'), []);
    assert.deepEqual(app.json('customer_state.json'), { cases: {}, problems: {}, orders: { [snapshotOrder.id]: snapshotOrder } });
    assert.equal(app.snapshot()['sap_cache.json'], before['sap_cache.json']);
    const session = await app.request('/api/assist/staff/session', undefined, headers);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.actor.name, 'Reset test reviewer');
    assert.equal((await app.request('/api/assist/staff/access-hint')).body.accessCode, 'INFOSYS_704');
    assert.deepEqual((await app.request('/api/assist/staff/cases', undefined, headers)).body.cases, []);
    assert.equal((await app.request(`/api/assist/cases/${caseId}`)).status, 404);
    assert.equal((await app.request(`/api/assist/staff/cases/${caseId}/actions`, { action: 'approve', version: 1, message: 'Stale screen.' }, headers)).status, 404);
    const healthy = await app.request('/api/assist/orders/KM184920');
    assert.equal(healthy.body.problem, null); assert.equal(healthy.body.recoveryCase, null);
    assert.equal((await app.request('/api/assist/orders/SAP-TEST')).body.id, snapshotOrder.id);
    const fresh = await app.request('/api/assist/orders/KM185002/recovery', { optionId: 'refund' });
    assert.equal(fresh.status, 200); assert.equal(fresh.body.recoveryCase.operations.stage, 'submitted');
    assert.notEqual(fresh.body.recoveryCase.id, caseId);
    assert.equal(app.sapCalls.length, 0);
  });

  // A demonstration reset must not delete records of external/live actions.
  for (const target of ['live-server', 'buyer-live-write', 'customer-live-write']) {
    await withApp({ mode: target === 'live-server' ? 'live' : 'simulate' }, async app => {
      app.seedJson('app_state.json', { locked: { KEEP: {} } });
      if (target === 'buyer-live-write') app.seedJson('sap_write_store.json', [{ mode: 'live', requests: [] }]);
      if (target === 'customer-live-write') app.seedJson('customer_state.json', { cases: { KEEP: { requests: [{ mode: 'live' }] } }, problems: {}, orders: {} });
      const before = app.snapshot();
      const result = await app.request('/api/reset-state', { confirmAll: true });
      assert.equal(result.status, target === 'live-server' ? 403 : 409);
      assert.deepEqual(app.snapshot(), before);
      assert.equal(app.writes.length, 0); assert.equal(app.sapCalls.length, 0);
    });
  }

  // A slow earlier buyer write finishes before the reset; it cannot reintroduce
  // locks or history after all modules have been cleared.
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  await withApp({ key: 'mock-key', fetchImpl: async () => {
    started(); await gate;
    return { ok: true, status: 200, text: async () => JSON.stringify({ PurchaseOrder: LINES[0].poNumber, DocumentCurrency: 'AUD', _PurchaseOrderItem: [{ PurchaseOrderItem: '10', OrderQuantity: '10', Material: 'TEST', Plant: 'TEST', NetPriceAmount: '1', NetPriceQuantity: '1' }] }) };
  } }, async app => {
    const pending = app.request('/api/mixlock', { lineId: LINES[0].id, finalSplit: [{ colour: 'Test', size: 'Test', qty: 10 }] });
    await reading;
    const received = new Promise(resolve => {
      function onRequest(req) { if (req.url === '/api/reset-state') { app.server.off('request', onRequest); resolve(); } }
      app.server.on('request', onRequest);
    });
    const reset = app.request('/api/reset-state', { confirmAll: true });
    await received; release();
    assert.equal((await pending).status, 200); assert.equal((await reset).status, 200);
    assert.deepEqual(app.json('app_state.json'), { locked: {} });
    assert.deepEqual(app.json('sap_write_store.json'), []);
    assert.deepEqual(app.json('customer_state.json').cases, {});
  });
  console.log('Demo reset passed: all four modules, confirmation, live-data guards, retained snapshots/sign-ins and in-flight writes (memory-only).');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
