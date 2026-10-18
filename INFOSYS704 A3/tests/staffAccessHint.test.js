const assert = require('node:assert/strict');
const { harness } = require('./customerAssist.test');

async function run() {
  for (const staffKey of ['', 'INFOSYS_704']) {
    const app = harness({ staffKey });
    const session = await app.request('/api/assist/staff/session', {}, 'GET');
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, false);
    assert.equal(session.body.hintAvailable, true);
    assert.equal(session.body.accessCode, undefined); // Revealed only on request.
    const hint = await app.request('/api/assist/staff/access-hint', {}, 'GET');
    assert.equal(hint.status, 200);
    assert.equal(hint.body.accessCode, 'INFOSYS_704');
    assert.equal(app.writes, 0);
    assert.equal((await app.request('/api/assist/staff/cases', {}, 'GET')).status, 401);
    assert.equal((await app.staffLogin('Classroom staff', 'WRONG')).status, 401);
    assert.equal((await app.staffLogin('Classroom staff', 'INFOSYS_704')).status, 200);
    assert.equal((await app.staffRequest('/api/assist/staff/cases', {}, 'GET')).status, 200);
    assert.equal(app.writes, 0);
  }

  // The public classroom hint must never expose a private deployment's key.
  const privateCode = 'PRIVATE-TEST-CODE-NOT-FOR-THE-BROWSER';
  const privateApp = harness({ staffKey: privateCode });
  const session = await privateApp.request('/api/assist/staff/session', {}, 'GET');
  assert.equal(session.body.hintAvailable, false);
  assert.ok(!JSON.stringify(session.body).includes(privateCode));
  const hint = await privateApp.request('/api/assist/staff/access-hint', {}, 'GET');
  assert.equal(hint.status, 404);
  assert.equal(hint.body.accessCode, undefined);
  assert.ok(!JSON.stringify(hint.body).includes(privateCode));
  assert.equal((await privateApp.staffLogin('Private staff', 'INFOSYS_704')).status, 401);
  assert.equal((await privateApp.staffLogin('Private staff', privateCode)).status, 200);
  assert.equal(privateApp.writes, 0);

  console.log('Staff access hint passed: INFOSYS_704 sign-in, read-only reveal and private-key protection.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
