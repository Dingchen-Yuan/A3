// Full HTTP app with in-memory data files and no external SAP access.
// Static assets are read from disk; writes can only reach the memory map.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
const files = ['app_state.json', 'sap_write_store.json', 'recovery_cases.json', 'customer_state.json', 'sap_cache.json'];

function serverFixture({ mode = 'simulate', key = '', staffKey = 'INFOSYS_704', initial = {}, fetchImpl } = {}) {
  const saved = new Map();
  const writes = [], sapCalls = [], errors = [];
  const defaults = {
    'app_state.json': { locked: {} }, 'sap_write_store.json': [], 'recovery_cases.json': [],
    'customer_state.json': { cases: {}, problems: {}, orders: {} },
    'sap_cache.json': JSON.parse(fs.readFileSync(path.join(dataDir, 'sap_cache.json'), 'utf8'))
  };
  for (const name of files) saved.set(path.join(dataDir, name), JSON.stringify(initial[name] ?? defaults[name]));
  saved.set(path.join(root, '.env'), `SAP_WRITE_MODE=${mode}\nSAP_API_KEY=${key}\nSTAFF_ACCESS_KEY=${staffKey}`);
  const memoryFs = {
    readFileSync(file, encoding) {
      const resolved = path.resolve(file);
      if (saved.has(resolved)) return encoding ? saved.get(resolved) : Buffer.from(saved.get(resolved));
      assert.ok(resolved.startsWith(publicDir + path.sep), 'Unexpected fixture read: ' + resolved);
      return fs.readFileSync(file, encoding);
    },
    writeFileSync(file, value) {
      const resolved = path.resolve(file);
      assert.ok(saved.has(resolved) && resolved.startsWith(dataDir + path.sep), 'Unexpected fixture write: ' + resolved);
      saved.set(resolved, String(value)); writes.push(path.basename(file));
    },
    existsSync: file => saved.has(path.resolve(file)) || fs.existsSync(file),
    statSync: fs.statSync
  };
  const shared = {
    URL, URLSearchParams, AbortSignal, Buffer,
    fetch: async (url, options) => {
      sapCalls.push({ url, options });
      if (!fetchImpl) throw new Error('Unexpected external SAP call in fixture');
      return fetchImpl(url, options);
    },
    console: { error: error => errors.push(error), warn() {}, log() {} },
    process: { env: {} }
  };
  function load(name, overrides = {}) {
    const filename = path.join(root, name);
    const localRequire = createRequire(filename);
    const sandbox = {
      ...shared, __dirname: root, module: { exports: {} },
      require: dependency => dependency === 'fs' ? memoryFs : Object.hasOwn(overrides, dependency) ? overrides[dependency] : localRequire(dependency)
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox.module.exports;
  }
  const customerAssist = load('customerAssist.js');
  const server = load('server.js', { './customerAssist': customerAssist });
  server.prependListener('request', (req, res) => res.setHeader('X-In-Memory-Test-Fixture', 'true'));
  return {
    server, writes, sapCalls, errors,
    json: name => JSON.parse(saved.get(path.join(dataDir, name))),
    seedJson(name, value) { assert.ok(files.includes(name)); saved.set(path.join(dataDir, name), JSON.stringify(value)); },
    snapshot: () => Object.fromEntries(files.map(name => [name, saved.get(path.join(dataDir, name))]))
  };
}

module.exports = { serverFixture };
