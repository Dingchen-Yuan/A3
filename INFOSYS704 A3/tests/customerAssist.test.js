// Route-level regression tests. All customer state is in memory, and SAP is
// mocked: these tests never touch saved demos or send requests to a real system.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createStaffAccess, DEMO_ACCESS_CODE } = require('../lib/staffAccess');
const { readyCase } = require('./helpers/workflowFixture');

const filename = path.resolve(__dirname, '../customerAssist.js');
const source = fs.readFileSync(filename, 'utf8');
const localRequire = createRequire(filename);

function sapResponse(status = 201) {
  return { ok: status >= 200 && status < 300, status, text: async () => '{}' };
}

function harness({ mode = 'simulate', key = '', fetchImpl, initialState = { cases: {}, problems: {} }, staffKey = 'TEST-STAFF-CODE' } = {}) {
  let saved = JSON.stringify(initialState);
  let writes = 0;
  let fetcher = fetchImpl || (() => { throw new Error('Unexpected SAP call'); });
  const calls = [];
  const staffAccess = createStaffAccess(staffKey);
  let cookie = '';
  const memoryFs = {
    readFileSync(file) {
      assert.equal(path.basename(file), 'customer_state.json');
      return saved;
    },
    writeFileSync(file, value) {
      assert.equal(path.basename(file), 'customer_state.json');
      saved = value;
      writes += 1;
    }
  };
  const sandbox = {
    module: { exports: {} },
    require: name => name === 'fs' ? memoryFs : localRequire(name),
    __dirname: path.dirname(filename), URL, URLSearchParams, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher(url, options);
    }
  };
  vm.runInNewContext(source, sandbox, { filename });
  const app = {
    calls,
    get writes() { return writes; },
    state: () => JSON.parse(saved),
    // Test-only fixture for updates received from a trusted external service.
    seedState(state) { saved = JSON.stringify(state); },
    setFetch(fn) { fetcher = fn; },
    async request(url, body = {}, method = 'POST', headers = {}) {
      const response = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
      response.handled = await sandbox.module.exports.tryHandle({ url, method, headers: { host: 'localhost', ...headers }, socket: { remoteAddress: '127.0.0.1' } }, response, {
        sapBase: 'https://sap.example.invalid/sap/opu/odata4/sap/purchaseorder',
        sapKey: key,
        sapMode: mode,
        staffAccess,
        jsonBody: async () => body,
        sendJson(res, status, data) {
          res.status = status;
          res.body = JSON.parse(JSON.stringify(data));
        }
      });
      return response;
    },
    async staffLogin(name = 'Test recovery reviewer', accessCode = staffKey || DEMO_ACCESS_CODE) {
      const response = await app.request('/api/assist/staff/login', { name, accessCode });
      if (response.status === 200) cookie = response.headers['set-cookie'].split(';')[0];
      return response;
    },
    async staffRequest(url, body = {}, method = 'POST', headers = {}) {
      if (!cookie) assert.equal((await app.staffLogin()).status, 200);
      return app.request(url, body, method, { cookie, ...headers });
    }
  };
  return app;
}

async function open(app, id = 'KM185002', optionId = 'refund') {
  return app.request(`/api/assist/orders/${id}/recovery`, { optionId });
}

async function ready(app, caseId) {
  for (const action of ['start_review', 'approve', 'record_outcome']) {
    const response = await app.staffRequest(`/api/assist/staff/cases/${caseId}`, {}, 'GET');
    assert.equal(response.status, 200);
    const entry = response.body.case;
    if (!entry.allowedActions.includes(action)) continue;
    const body = { action, version: entry.version, message: 'Staff test fixture update.' };
    if (action === 'record_outcome') {
      body.reference = 'TEST-' + caseId; body.occurredAt = new Date().toISOString();
      if (entry.outcome !== 'refund') body.scheduledDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    }
    assert.equal((await app.staffRequest(`/api/assist/staff/cases/${caseId}/actions`, body)).status, 200);
  }
  assert.equal((await app.request(`/api/assist/cases/${caseId}`, {}, 'GET')).body.recoveryCase.status, 'ready');
}

function serviceReady(app, caseId) {
  const state = app.state();
  const recoveryCase = Object.values(state.cases).find(entry => entry.id === caseId);
  readyCase(recoveryCase);
  app.seedState(state);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function sapOrder(overrides = {}) {
  return {
    SalesOrder: '990001', PurchaseOrderByCustomer: 'KM-SAP-100', SoldToParty: '1001',
    TransactionCurrency: 'USD', RequestedDeliveryDate: '2026-10-21',
    to_Item: { results: [
      { SalesOrderItem: '10', Material: 'BOX', SalesOrderItemText: 'Storage boxes', RequestedQuantity: '2.000', NetAmount: '20.00' },
      { SalesOrderItem: '20', Material: 'COVER', SalesOrderItemText: 'Covers', RequestedQuantity: '3.000', NetAmount: '5.55' }
    ] },
    ...overrides
  };
}

function sapRead(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) };
}

async function run() {
  // Every preset outcome still follows open -> ready -> closed.
  for (const [id, optionId, amount] of [
    ['KM185002', 'refund', 18], ['KM185002', 'replace', 0],
    ['KM184866', 'refund', 16], ['KM184866', 'replace', 0],
    ['KM184773', 'redeliver', 0], ['KM184773', 'collect', 0], ['KM184773', 'refund', 32]
  ]) {
    const app = harness();
    const opened = await open(app, id, optionId);
    assert.equal(opened.status, 200);
    const caseId = opened.body.recoveryCase.id;
    assert.equal(opened.body.recoveryCase.status, 'open');
    const unchanged = app.state();
    const writes = app.writes;
    const early = await app.request(`/api/assist/cases/${caseId}/complete`);
    assert.equal(early.status, 409);
    assert.deepEqual(app.state(), unchanged);
    assert.equal(app.writes, writes);
    await ready(app, caseId);
    const done = await app.request(`/api/assist/cases/${caseId}/complete`);
    assert.equal(done.status, 200);
    assert.equal(done.body.recoveryCase.status, 'closed');
    assert.equal(done.body.recoveryCase.amount, amount);
    assert.equal(done.body.recoveryCase.requests.length, 2);
    assert.equal(done.body.recoveryCase.requests.at(-1).mode, 'simulate');
    const closedState = app.state();
    const closedWrites = app.writes;
    const duplicate = await app.request(`/api/assist/cases/${caseId}/complete`);
    assert.equal(duplicate.status, 200);
    await app.request(`/api/assist/cases/${caseId}/advance`);
    assert.deepEqual(app.state(), closedState);
    assert.equal(app.writes, closedWrites);
    const reread = await app.request(`/api/assist/orders/${id}`, {}, 'GET');
    assert.equal(reread.body.recoveryCase.status, 'closed');
    assert.equal(app.calls.length, 0);
  }

  // Healthy orders cannot get a recovery until a problem is reported.
  const healthy = harness();
  assert.equal((await open(healthy, 'KM184920')).status, 400);
  assert.equal((await healthy.request('/api/assist/orders/KM184920/problem', { code: 'DELAY' })).status, 200);
  assert.equal((await open(healthy, 'KM184920')).status, 200);

  // Reporting a second problem or changing options must not erase a case.
  const protectedCase = harness();
  const existing = await open(protectedCase);
  const protectedState = protectedCase.state();
  assert.equal((await protectedCase.request('/api/assist/orders/KM185002/problem', { code: 'MISSING' })).status, 409);
  assert.equal((await open(protectedCase, 'KM185002', 'replace')).status, 409);
  assert.deepEqual(protectedCase.state(), protectedState);
  assert.equal((await open(protectedCase)).body.recoveryCase.id, existing.body.recoveryCase.id);
  // Customer controls cannot erase staff-managed decisions or history.
  assert.equal((await protectedCase.request('/api/assist/orders/KM185002/reset')).status, 409);
  assert.ok(protectedCase.state().cases.KM185002);

  // A missing cushion cover is $12, not the $18 carrier-flagged box or $30 order.
  const itemRecovery = harness();
  const missingCover = await itemRecovery.request('/api/assist/orders/KM185002/problem', {
    code: 'MISSING', affectedItems: [{ itemId: 'line-2', qty: 1 }]
  });
  assert.equal(missingCover.status, 200);
  assert.equal(missingCover.body.options.find(option => option.id === 'refund').amount, 12);
  assert.equal(missingCover.body.items[0].affectedQty, 0);
  assert.equal(missingCover.body.items[1].affectedQty, 1);
  assert.equal(missingCover.body.affectedItems[0].sku, 'ANKO-CUSH-45');
  const coverCase = await open(itemRecovery);
  const coverId = coverCase.body.recoveryCase.id;
  assert.equal(coverCase.body.recoveryCase.amountMinor, 1200);
  assert.equal(coverCase.body.recoveryCase.affectedItems[0].itemId, 'line-2');
  assert.equal(coverCase.body.recoveryCase.selectionIsPartial, true);
  assert.match(coverCase.body.recoveryCase.detail, /rest of the order/);
  assert.match(coverCase.body.recoveryCase.requests[0].body.ServiceRequestDescription, /Cushion Cover/);
  const coverRestart = harness({ initialState: itemRecovery.state() });
  await ready(coverRestart, coverId);
  const coverDone = await coverRestart.request(`/api/assist/cases/${coverId}/complete`);
  assert.equal(coverDone.body.recoveryCase.requests.at(-1).body.RequestedAmount, 12);
  assert.equal(coverDone.body.recoveryCase.outcomeCopy.heading, 'Resolution update acknowledged');
  assert.equal(coverDone.body.recoveryCase.affectedItems[0].qty, 1);
  const coverClosed = coverRestart.state();
  assert.equal((await coverRestart.request('/api/assist/orders/KM185002/problem', {
    code: 'DAMAGED', affectedItems: [{ itemId: 'line-1', qty: 1 }]
  })).status, 409);
  assert.deepEqual(coverRestart.state(), coverClosed);

  // Scope is validated before saving anything; supplied prices are never used.
  for (const affectedItems of [
    undefined, [], [{ itemId: 'line-9', qty: 1 }],
    [{ itemId: 'line-2', qty: 2 }], [{ itemId: 'line-2', qty: 0 }],
    [{ itemId: 'line-2', qty: -1 }], [{ itemId: 'line-2', qty: 0.5 }],
    [{ itemId: 'line-2', qty: '1' }],
    [{ itemId: 'line-2', qty: 1 }, { itemId: 'line-2', qty: 1 }],
    [{ itemId: 'line-2', qty: 1, amount: 999 }]
  ]) {
    const app = harness();
    const bad = await app.request('/api/assist/orders/KM185002/problem', { code: 'MISSING', affectedItems });
    assert.equal(bad.status, 400);
    assert.equal(app.writes, 0);
  }
  const wholeDelivery = harness();
  assert.equal((await wholeDelivery.request('/api/assist/orders/KM185002/problem', {
    code: 'DELAY', affectedItems: [{ itemId: 'line-2', qty: 1 }]
  })).status, 400);
  assert.equal((await wholeDelivery.request('/api/assist/orders/KM185002/problem', { code: '__proto__' })).status, 400);
  const whole = await wholeDelivery.request('/api/assist/orders/KM185002/problem', { code: 'DELAY' });
  assert.equal(whole.body.options.find(option => option.id === 'refund').amount, 30);

  // Live writes never silently fall back to simulation on an error.
  for (const fail of [() => sapResponse(405), () => sapResponse(500), () => { throw new Error('SAP timeout'); }]) {
    const app = harness({ mode: 'live', key: 'test-key', fetchImpl: fail });
    const failed = await open(app);
    assert.equal(failed.status, 502);
    assert.match(failed.body.error, /Nothing has been confirmed/);
    assert.deepEqual(app.state(), { cases: {}, problems: {} });
    assert.equal(app.writes, 0);
    app.setFetch(() => sapResponse());
    assert.equal((await open(app)).status, 200);
  }
  const unconfigured = harness({ mode: 'live' });
  assert.equal((await open(unconfigured)).status, 502);
  assert.equal(unconfigured.calls.length, 0);
  assert.equal(unconfigured.writes, 0);

  // A failed live completion leaves the case ready and safe to retry.
  const live = harness({ mode: 'live', key: 'test-key', fetchImpl: () => sapResponse() });
  const liveId = (await open(live)).body.recoveryCase.id;
  serviceReady(live, liveId);
  const beforeFailure = live.state();
  const writesBeforeFailure = live.writes;
  for (const fail of [() => sapResponse(405), () => { throw new Error('Connection lost'); }]) {
    live.setFetch(fail);
    const failed = await live.request(`/api/assist/cases/${liveId}/complete`);
    assert.equal(failed.status, 502);
    assert.match(failed.body.error, /still ready/);
    assert.deepEqual(live.state(), beforeFailure);
    assert.equal(live.writes, writesBeforeFailure);
  }
  live.setFetch(() => sapResponse(204));
  const confirmed = await live.request(`/api/assist/cases/${liveId}/complete`);
  assert.equal(confirmed.body.recoveryCase.status, 'closed');
  assert.equal(confirmed.body.recoveryCase.requests.at(-1).mode, 'live');
  assert.equal(confirmed.body.recoveryCase.requests.at(-1).status, 204);
  const postsAfterSuccess = live.calls.length;
  await live.request(`/api/assist/cases/${liveId}/complete`);
  assert.equal(live.calls.length, postsAfterSuccess);

  // Two concurrent clicks create one case and send one completion request.
  const concurrent = harness({ mode: 'live', key: 'test-key' });
  const createStarted = deferred();
  const releaseCreate = deferred();
  concurrent.setFetch(async () => {
    createStarted.resolve();
    await releaseCreate.promise;
    return sapResponse();
  });
  const createOne = open(concurrent);
  const createTwo = open(concurrent);
  await createStarted.promise;
  assert.equal(concurrent.calls.length, 1);
  releaseCreate.resolve();
  const created = await Promise.all([createOne, createTwo]);
  assert.equal(created[0].status, 200);
  assert.equal(created[1].status, 200);
  assert.equal(created[0].body.recoveryCase.id, created[1].body.recoveryCase.id);
  assert.equal(concurrent.calls.length, 1);
  const concurrentId = created[0].body.recoveryCase.id;
  serviceReady(concurrent, concurrentId);
  const completeStarted = deferred();
  const releaseComplete = deferred();
  concurrent.setFetch(async () => {
    completeStarted.resolve();
    await releaseComplete.promise;
    return sapResponse(204);
  });
  const completeOne = concurrent.request(`/api/assist/cases/${concurrentId}/complete`);
  const completeTwo = concurrent.request(`/api/assist/cases/${concurrentId}/complete`);
  await completeStarted.promise;
  assert.equal(concurrent.calls.length, 2);
  releaseComplete.resolve();
  const completed = await Promise.all([completeOne, completeTwo]);
  assert.ok(completed.every(result => result.status === 200));
  assert.equal(concurrent.calls.length, 2);
  assert.equal(concurrent.state().cases.KM185002.requests.length, 2);

  // Queued writes for different orders preserve both cases in the shared file.
  const differentOrders = harness({ mode: 'live', key: 'test-key', fetchImpl: () => sapResponse() });
  await Promise.all([open(differentOrders, 'KM185002'), open(differentOrders, 'KM184866')]);
  assert.equal(Object.keys(differentOrders.state().cases).length, 2);

  // A SAP-only order keeps one identity across both customer/sales aliases,
  // reporting, recovery, process restarts and reopening without a working SAP key.
  const sap = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: sapOrder() }) });
  const found = await sap.request('/api/assist/orders/990001', {}, 'GET');
  assert.equal(found.status, 200);
  const sapId = found.body.id;
  assert.equal(sapId, 'SAP-990001');
  assert.equal(found.body.customerReference, 'KM-SAP-100');
  assert.equal(found.body.currency, 'USD');
  assert.equal(found.body.total, 25.55);
  assert.equal(found.body.items[0].lineTotal, 20);
  assert.equal(found.body.items[0].lineTotalMinor, 2000);
  assert.equal(found.body.items[0].price, 10);
  assert.equal(found.body.source, 'sap');
  assert.equal(found.body.cached, false);
  assert.ok(found.body.sapReadAt);
  assert.doesNotMatch(JSON.stringify(sap.state()), /test-key/);
  for (const alias of [sapId, '990001', '0000990001', 'SAP-0000990001', 'KM-SAP-100', 'km-sap-100']) {
    const reopened = await sap.request('/api/assist/orders/' + encodeURIComponent(alias), {}, 'GET');
    assert.equal(reopened.status, 200, alias);
    assert.equal(reopened.body.id, sapId);
    assert.equal(reopened.body.cached, true);
  }
  assert.equal(sap.calls.length, 1);
  const reported = await sap.request('/api/assist/orders/KM-SAP-100/problem', { code: 'DELAY' });
  assert.equal(reported.status, 200);
  assert.equal(reported.body.problem.code, 'DELAY');
  assert.equal(reported.body.headline, reported.body.problem.title);
  assert.equal(reported.body.options.find(option => option.id === 'refund').amount, 25.55);
  const sapCase = await open(sap, '990001');
  assert.equal(sapCase.status, 200);
  const sapCaseId = sapCase.body.recoveryCase.id;
  assert.equal(sapCase.body.recoveryCase.orderId, sapId);
  assert.equal(sapCase.body.recoveryCase.salesOrder, '990001');
  assert.equal(sapCase.body.recoveryCase.amountMinor, 2555);
  assert.equal(sapCase.body.recoveryCase.requests[0].body.TransactionCurrency, 'USD');
  const restarted = harness({ initialState: sap.state() });
  const afterRestart = await restarted.request('/api/assist/orders/KM-SAP-100', {}, 'GET');
  assert.equal(afterRestart.body.recoveryCase.id, sapCaseId);
  await ready(restarted, sapCaseId);
  const next = await restarted.request(`/api/assist/cases/${sapCaseId}`, {}, 'GET');
  assert.equal(next.body.recoveryCase.status, 'ready');
  const sapDone = await restarted.request(`/api/assist/cases/${sapCaseId}/complete`);
  assert.equal(sapDone.status, 200);
  assert.equal(sapDone.body.recoveryCase.status, 'closed');
  assert.equal(sapDone.body.recoveryCase.requests.at(-1).body.RequestedAmount, 25.55);
  assert.equal(sapDone.body.recoveryCase.requests.at(-1).body.TransactionCurrency, 'USD');
  const cards = await restarted.request('/api/assist/orders', {}, 'GET');
  assert.equal(cards.body.orders.length, 5);
  assert.equal(cards.body.orders.find(order => order.id === sapId).caseLabel, 'Resolution update acknowledged');
  assert.equal(restarted.calls.length, 0);
  assert.equal((await restarted.request(`/api/assist/orders/${sapId}/reset`)).status, 409);
  assert.equal((await restarted.request('/api/assist/reset')).status, 409);
  assert.ok(restarted.state().orders[sapId]);

  // First lookup by customer reference queries SAP safely, including apostrophes.
  const reference = "KM-O'NEIL & 2";
  const byReference = harness({ key: 'test-key', fetchImpl: url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('$filter'), "(SalesOrder eq 'KM-O''NEIL & 2' or PurchaseOrderByCustomer eq 'KM-O''NEIL & 2')");
    assert.equal(params.get('$top'), '2');
    assert.equal(params.get('$expand'), 'to_Item');
    return sapRead({ d: { results: [sapOrder({ PurchaseOrderByCustomer: reference })] } });
  } });
  const referenceResult = await byReference.request('/api/assist/orders/' + encodeURIComponent(reference), {}, 'GET');
  assert.equal(referenceResult.status, 200);
  assert.equal(referenceResult.body.id, sapId);
  assert.equal((await byReference.request('/api/assist/orders/' + sapId, {}, 'GET')).status, 200);
  assert.equal(byReference.calls.length, 1);

  // A numeric customer reference can fall back from the entity-key lookup.
  const numericReference = harness({ key: 'test-key', fetchImpl: url =>
    url.includes("A_SalesOrder('1234')") ? sapRead({}, 404) : sapRead({ d: { results: [sapOrder({ PurchaseOrderByCustomer: '1234' })] } })
  });
  assert.equal((await numericReference.request('/api/assist/orders/1234', {}, 'GET')).body.id, sapId);

  // Ambiguous customer references must not choose an arbitrary financial order.
  const ambiguous = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: { results: [sapOrder(), sapOrder({ SalesOrder: '990002' })] } }) });
  assert.equal((await ambiguous.request('/api/assist/orders/SHARED', {}, 'GET')).status, 409);
  assert.equal(ambiguous.writes, 0);
  const shared = harness({ key: 'test-key', fetchImpl: url => sapRead({ d: sapOrder({
    SalesOrder: url.includes('990002') ? '990002' : '990001', PurchaseOrderByCustomer: 'SHARED'
  }) }) });
  await shared.request('/api/assist/orders/990001', {}, 'GET');
  await shared.request('/api/assist/orders/990002', {}, 'GET');
  assert.equal((await shared.request('/api/assist/orders/SHARED', {}, 'GET')).status, 409);
  assert.equal((await shared.request('/api/assist/orders/SAP-990002', {}, 'GET')).body.salesOrder, '990002');

  // Missing/invalid upstream amounts never become a zero-valued refund order.
  const invalidRows = [
    sapOrder({ TransactionCurrency: '' }),
    sapOrder({ to_Item: { results: [] } }),
    ...[undefined, '', 'invalid', '-1', '1e99'].map(NetAmount => sapOrder({ to_Item: { results: [{ RequestedQuantity: '2', NetAmount }] } })),
    ...['0', '-2', 'invalid', true].map(RequestedQuantity => sapOrder({ to_Item: { results: [{ RequestedQuantity, NetAmount: '20' }] } })),
    sapOrder({ to_Item: { results: [{ RequestedQuantity: '1', NetAmount: '20', TransactionCurrency: 'EUR' }] } })
  ];
  for (const row of invalidRows) {
    const invalid = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: row }) });
    assert.equal((await invalid.request('/api/assist/orders/990001', {}, 'GET')).status, 502);
    assert.equal(invalid.writes, 0);
  }
  const unavailable = harness({ key: 'test-key', fetchImpl: () => { throw new Error('SAP unavailable'); } });
  assert.equal((await unavailable.request('/api/assist/orders/990001', {}, 'GET')).status, 502);
  unavailable.setFetch(() => sapRead({ d: sapOrder() }));
  assert.equal((await unavailable.request('/api/assist/orders/990001', {}, 'GET')).status, 200);
  const missing = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: { results: [] } }) });
  assert.equal((await missing.request('/api/assist/orders/MISSING', {}, 'GET')).status, 404);
  const interruptedRead = harness({ key: 'test-key', fetchImpl: () => ({
    ok: true, status: 200, text: async () => { throw new Error('Connection lost while reading'); }
  }) });
  assert.equal((await interruptedRead.request('/api/assist/orders/990001', {}, 'GET')).status, 502);
  assert.equal(interruptedRead.writes, 0);

  // Source currencies and non-two-decimal amounts survive lookup and recovery.
  for (const [currency, net, total, minor] of [['JPY', '995', 995, 995], ['KWD', '1.234', 1.234, 1234], ['AUD', '0.30', 0.3, 30]]) {
    const app = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: sapOrder({
      TransactionCurrency: currency,
      RequestedDeliveryDate: '/Date(' + Date.UTC(2026, 9, 21) + ')/',
      to_Item: { results: [{ RequestedQuantity: '2', NetAmount: net }] }
    }) }) });
    const found = await app.request('/api/assist/orders/990001', {}, 'GET');
    assert.equal(found.body.total, total);
    assert.equal(found.body.items[0].lineTotalMinor, minor);
    assert.equal(found.body.promise, '2026-10-21');
    await app.request('/api/assist/orders/SAP-990001/problem', { code: 'DELAY' });
    const opened = await open(app, 'SAP-990001');
    assert.equal(opened.body.recoveryCase.amountMinor, minor);
    assert.equal(opened.body.recoveryCase.requests[0].body.RequestedAmount, total);
    assert.equal(opened.body.recoveryCase.requests[0].body.TransactionCurrency, currency);
  }

  const reservedReference = harness({ key: 'test-key', fetchImpl: url =>
    new URL(url).searchParams.has('$filter') ? sapRead({ d: { results: [sapOrder({ PurchaseOrderByCustomer: 'SAP-CUSTOMER' })] } }) : sapRead({}, 404)
  });
  assert.equal((await reservedReference.request('/api/assist/orders/SAP-CUSTOMER', {}, 'GET')).body.id, sapId);
  const collision = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: sapOrder({ PurchaseOrderByCustomer: 'KM185002' }) }) });
  assert.equal((await collision.request('/api/assist/orders/990001', {}, 'GET')).body.id, sapId);
  assert.equal((await collision.request('/api/assist/orders/KM185002', {}, 'GET')).body.total, 30);
  assert.equal((await collision.request('/api/assist/orders/' + sapId, {}, 'GET')).body.total, 25.55);

  // GET lookups now also populate shared state. Queue them with POST mutations
  // so a new snapshot cannot overwrite an unrelated recovery opened concurrently.
  const lookupStarted = deferred(), releaseLookup = deferred();
  const overlap = harness({ key: 'test-key', fetchImpl: async () => {
    lookupStarted.resolve(); await releaseLookup.promise;
    return sapRead({ d: sapOrder() });
  } });
  const lookupOne = overlap.request('/api/assist/orders/990001', {}, 'GET');
  const lookupTwo = overlap.request('/api/assist/orders/990001', {}, 'GET');
  await lookupStarted.promise;
  const demoWhileReading = open(overlap);
  releaseLookup.resolve();
  const lookups = await Promise.all([lookupOne, lookupTwo, demoWhileReading]);
  assert.ok(lookups.every(result => result.status === 200));
  assert.equal(overlap.calls.length, 1);
  assert.ok(overlap.state().orders[sapId]);
  assert.ok(overlap.state().cases.KM185002);

  // SAP quantities and duplicate materials use line IDs, not a SKU lookup.
  for (const action of ['refund', 'replace']) {
    const app = harness({ key: 'test-key', fetchImpl: () => sapRead({ d: sapOrder() }) });
    await app.request('/api/assist/orders/990001', {}, 'GET');
    const report = await app.request('/api/assist/orders/SAP-990001/problem', {
      code: 'DAMAGED', affectedItems: [{ itemId: 'line-1', qty: 1 }, { itemId: 'line-2', qty: 2 }]
    });
    assert.equal(report.status, 200);
    assert.equal(report.body.options.find(option => option.id === 'refund').amount, 13.7);
    assert.equal(report.body.selectionIsPartial, true);
    const opened = await app.request('/api/assist/orders/SAP-990001/recovery', {
      optionId: action, amount: 999, affectedItems: [{ itemId: 'line-1', qty: 99 }]
    });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.recoveryCase.amount, action === 'refund' ? 13.7 : 0);
    assert.equal(opened.body.recoveryCase.affectedValueMinor, 1370);
    assert.deepEqual(opened.body.recoveryCase.affectedItems.map(item => item.qty), [1, 2]);
    await ready(app, opened.body.recoveryCase.id);
    const done = await app.request(`/api/assist/cases/${opened.body.recoveryCase.id}/complete`);
    assert.equal(done.body.recoveryCase.requests.at(-1).body.TransactionCurrency, 'USD');
    assert.equal(done.body.recoveryCase.requests.at(-1).body.RequestedAmount, action === 'refund' ? 13.7 : 0);
  }

  // Older active cases without item snapshots are still completable without
  // silently changing their already-recorded amount or outcome.
  const legacyOrder = harness();
  const legacyOpened = await open(legacyOrder);
  const legacyState = legacyOrder.state();
  delete legacyState.cases.KM185002.affectedItems;
  delete legacyState.cases.KM185002.operations;
  legacyState.cases.KM185002.problemCode = 'MISSING';
  legacyState.problems.KM185002 = { code: 'MISSING', title: 'Old missing-item report', detail: 'Saved before item selection was available.', foundAt: 'Earlier' };
  const legacy = harness({ initialState: legacyState });
  await ready(legacy, legacyOpened.body.recoveryCase.id);
  assert.equal((await legacy.request(`/api/assist/cases/${legacyOpened.body.recoveryCase.id}/complete`)).body.recoveryCase.amount, 18);

  console.log('Customer Assist API passed: item-specific recoveries, safeguards, SAP identities and saved snapshots (mocked SAP).');
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { harness, sapOrder, sapRead, ready };
