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
    }
    for (const route of ['/supply-hub', '/supply-hub/', '/supply-hub/index.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /<title>Supply Hub · Kmart Group<\/title>/, route);
      assert.match(html, /href="\/" class="customer-link"/, route);
    }
    for (const route of ['/assist/styles.css', '/assist/app.js', '/styles.css', '/app.js']) {
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
    console.log('Navigation passed: customer home, buyer workspace, assets and legacy bookmarks.');
  } finally {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    await closed;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
