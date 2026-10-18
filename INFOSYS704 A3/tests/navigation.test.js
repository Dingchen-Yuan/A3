const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const server = require('../server');

async function run() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/index.html', '/assist', '/assist/', '/assist/index.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /<title>Kmart Delivery Assist<\/title>/, route);
      assert.match(html, /href="\/supply-hub"/, route);
      assert.match(html, /class="btn secondary home-link" href="\/"/, route);
      assert.match(html, /class="sidebar app-sidebar" id="sidebar"/, route);
      assert.match(html, /aria-controls="sidebar" aria-expanded="false"/, route);
      assert.deepEqual(Array.from(html.matchAll(/<a\b[^>]*data-nav="([^"]+)"/g), match => match[1]), ['assist', 'mixlock', 'deliveries', 'history'], route);
      assert.ok(html.indexOf('/site-navigation.js') < html.indexOf('/assist/app.js'), route);
    }
    for (const route of ['/supply-hub', '/supply-hub/', '/supply-hub/index.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /<title>Supply Hub · Kmart Group<\/title>/, route);
      assert.match(html, /href="\/" class="customer-link"/, route);
      assert.match(html, /class="sidebar app-sidebar" id="sidebar"/, route);
      assert.deepEqual(Array.from(html.matchAll(/<a\b[^>]*data-nav="([^"]+)"/g), match => match[1]), ['assist', 'mixlock', 'deliveries', 'history'], route);
    }
    for (const route of ['/assist/styles.css', '/assist/app.js', '/styles.css', '/app.js', '/site-navigation.css', '/site-navigation.js']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.doesNotMatch(await response.text(), /<!DOCTYPE html>/, route);
    }

    // Browser hashes never reach the server. Verify that the customer router
    // forwards old buyer bookmarks to the secondary workspace on the client.
    const source = fs.readFileSync(path.join(__dirname, '../public/assist/app.js'), 'utf8');
    for (const hash of ['#/mixlock', '#/deliveries', '#/delivery/S001', '#/case/RC-1001', '#/history']) {
      let redirected;
      vm.runInNewContext(source, {
        document: { querySelector: () => ({}) },
        window: { addEventListener() {} },
        location: { hash, replace(url) { redirected = url; } }
      });
      assert.equal(redirected, '/supply-hub' + hash);
    }
    const context = vm.createContext({
      document: { querySelector: () => ({}) }, window: { addEventListener() {} },
      location: { hash: '#/mixlock', replace() {} },
      previewOrder: { currency: 'USD', total: 20, items: [{ name: '<Storage box>', qty: 2, price: 20, lineTotal: 20 }] },
      previewCase: { status: 'closed', outcome: 'refund', amount: 20, currency: 'USD' }
    });
    vm.runInContext(source, context);
    const expectedMoney = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD' }).format(20);
    const items = vm.runInContext('itemList(previewOrder)', context);
    assert.ok(items.includes(expectedMoney));
    assert.ok(items.includes('2 units'));
    assert.ok(items.includes('&lt;Storage box&gt;'));
    assert.ok(!items.includes(new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD' }).format(40)));
    assert.equal(vm.runInContext('outcomeText(previewCase, previewOrder).heading', context), expectedMoney + ' refund confirmed');
    const scopedView = vm.runInContext(`recoveryItems([
      {name:'<Cushion cover>', qty:1, orderedQty:3, amount:12}
    ], 'AUD', true)`, context);
    assert.ok(scopedView.includes('&lt;Cushion cover&gt;'));
    assert.ok(scopedView.includes('1 of 3 units affected'));
    assert.ok(scopedView.includes('$12.00'));
    assert.ok(scopedView.includes('stay unchanged'));
    assert.equal(vm.runInContext("outcomeText({outcomeCopy:{heading:'Replacement for the selected cover'}}, previewOrder).heading", context), 'Replacement for the selected cover');
    assert.equal(vm.runInContext("isRecoveryReady({status:'open',stepIndex:0,steps:['Received','Ready']})", context), false);
    assert.equal(vm.runInContext("isRecoveryReady({status:'ready',stepIndex:0,steps:['Received','Ready']})", context), false);
    assert.equal(vm.runInContext("isRecoveryReady({status:'ready',stepIndex:1,steps:['Received','Ready'],readyForCompletion:false})", context), false);
    assert.equal(vm.runInContext("isRecoveryReady({status:'ready',stepIndex:1,steps:['Received','Ready'],readyForCompletion:true})", context), true);
    assert.equal(vm.runInContext("recoveryDemoControls({demoControlsAvailable:false})", context), '');
    const demoControls = vm.runInContext("recoveryDemoControls({demoControlsAvailable:true,demoAdvanceAllowed:true,status:'open',stepIndex:0,steps:['Received','Ready']})", context);
    assert.ok(demoControls.includes('Demo controls · presentation only'));
    assert.ok(demoControls.includes('id="advanceDemo"'));
    assert.equal(vm.runInContext("recoveryTime('invalid', 'Not available')", context), 'Not available');
    const trackingCalls = [];
    context.fetch = async (url, options = {}) => {
      trackingCalls.push({ url, method: options.method || 'GET' });
      return { ok: true, json: async () => ({}) };
    };
    for (let index = 0; index < 3; index += 1) await vm.runInContext("readRecoveryStatus('SR/TEST')", context);
    assert.deepEqual(trackingCalls, Array.from({ length: 3 }, () => ({ url: '/api/assist/cases/SR%2FTEST', method: 'GET' })));
    await vm.runInContext("applyDemoRecoveryUpdate('SR/TEST')", context);
    assert.deepEqual(trackingCalls.at(-1), { url: '/api/assist/cases/SR%2FTEST/advance', method: 'POST' });
    assert.equal(vm.runInContext("orderPath('SAP-REF/1 #A', 'choose')", context), '#/order/SAP-REF%2F1%20%23A/choose');
    const routed = vm.runInContext(`
      showScreen = (id, screen) => [id, screen];
      location.hash = '#/order/SAP-REF%2F1%20%23A/choose';
      JSON.stringify(route());
    `, context);
    assert.equal(routed, JSON.stringify(['SAP-REF/1 #A', 'choose']));
    assert.match(vm.runInContext("showHome = message => message; location.hash = '#/order/%E0%A4'; route();", context), /link is not valid/);
    console.log('Navigation and customer views passed: aliases, encoded IDs, line totals, currencies and legacy bookmarks.');
  } finally {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    await closed;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
