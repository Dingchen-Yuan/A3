// Route-level regression tests. All customer state is in memory, and SAP is
// mocked: these tests never touch saved demos or send requests to a real system.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = path.resolve(__dirname, '../customerAssist.js');
const source = fs.readFileSync(filename, 'utf8');
const localRequire = createRequire(filename);

function sapResponse(status = 201) {
  return { ok: status >= 200 && status < 300, status, text: async () => '{}' };
}

function harness({ mode = 'simulate', key = '', fetchImpl } = {}) {
  let saved = JSON.stringify({ cases: {}, problems: {} });
  let writes = 0;
  let fetcher = fetchImpl || (() => { throw new Error('Unexpected SAP call'); });
  const calls = [];
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
    __dirname: path.dirname(filename), URL, AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher(url, options);
    }
  };
  vm.runInNewContext(source, sandbox, { filename });
  return {
    calls,
    get writes() { return writes; },
    state: () => JSON.parse(saved),
    setFetch(fn) { fetcher = fn; },
    async request(url, body = {}, method = 'POST') {
      const response = {};
      response.handled = await sandbox.module.exports.tryHandle({ url, method }, response, {
        sapBase: 'https://sap.example.invalid/sap/opu/odata4/sap/purchaseorder',
        sapKey: key,
        sapMode: mode,
        jsonBody: async () => body,
        sendJson(res, status, data) {
          res.status = status;
          res.body = JSON.parse(JSON.stringify(data));
        }
      });
      return response;
    }
  };
}

async function open(app, id = 'KM185002', optionId = 'refund') {
  return app.request(`/api/assist/orders/${id}/recovery`, { optionId });
}

async function ready(app, caseId) {
  await app.request(`/api/assist/cases/${caseId}/advance`);
  const result = await app.request(`/api/assist/cases/${caseId}/advance`);
  assert.equal(result.body.recoveryCase.status, 'ready');
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
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
  // Restart remains an explicit demo action, not an implicit side effect.
  assert.equal((await protectedCase.request('/api/assist/orders/KM185002/reset')).status, 200);
  assert.equal(protectedCase.state().cases.KM185002, undefined);

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
  await ready(live, liveId);
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
  await ready(concurrent, concurrentId);
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

  console.log('Customer Assist API safeguards passed (in-memory state, mocked SAP).');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
