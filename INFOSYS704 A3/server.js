const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// --- env loading ---
function loadEnv() {
  const env = {};
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx < 0) continue;
      const k = t.slice(0, idx).trim();
      let v = t.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[k] = v;
    }
  } catch (e) {}
  return env;
}
const ENV = loadEnv();
const SAP_BASE = (ENV.SAP_BASE_URL || process.env.SAP_BASE_URL || '').replace(/\/+$/, '');
const SAP_KEY = ENV.SAP_API_KEY || process.env.SAP_API_KEY || '';
const SAP_MODE = ENV.SAP_WRITE_MODE || process.env.SAP_WRITE_MODE || 'simulate';
const PORT = Number(ENV.PORT || process.env.PORT || 3000);

const { LINES } = require('./data/mockLines');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'sap_write_store.json');
const STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const CACHE_FILE = path.join(DATA_DIR, 'sap_cache.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, v) {
  fs.writeFileSync(file, JSON.stringify(v, null, 2), 'utf8');
}

function getState() { return readJson(STATE_FILE, { locked: {} }); }
function setState(s) { writeJson(STATE_FILE, s); }
function getStore() { return readJson(STORE_FILE, []); }
function setStore(s) { writeJson(STORE_FILE, s); }

function uid() { return 'wr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

// --- SAP fetch ---
async function sapGet(sapPath) {
  const url = SAP_BASE + sapPath;
  const res = await fetch(url, {
    method: 'GET',
    headers: { APIKey: SAP_KEY, Accept: 'application/json' }
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

function simplifyPO(po) {
  if (!po) return null;
  const items = (po._PurchaseOrderItem || []);
  const qty = items.reduce((s, it) => s + (Number(it.OrderQuantity) || 0), 0);
  return {
    PurchaseOrder: po.PurchaseOrder,
    PurchaseOrderType: po.PurchaseOrderType,
    CompanyCode: po.CompanyCode,
    PurchasingOrganization: po.PurchasingOrganization,
    PurchasingGroup: po.PurchasingGroup,
    Supplier: po.Supplier,
    PurchaseOrderDate: po.PurchaseOrderDate,
    DocumentCurrency: po.DocumentCurrency,
    committedQuantity: qty,
    items: items.map(it => ({
      PurchaseOrderItem: it.PurchaseOrderItem,
      PurchaseOrderItemText: it.PurchaseOrderItemText,
      Material: it.Material,
      Plant: it.Plant,
      OrderQuantity: Number(it.OrderQuantity) || 0,
      PurchaseOrderQuantityUnit: it.PurchaseOrderQuantityUnit,
      NetPriceAmount: it.NetPriceAmount,
      RequirementTracking: it.RequirementTracking
    }))
  };
}

// --- SAP write adapter ---
async function sapWriteAdapter({ lineId, poNumber, finalSplit, note, committedQty }) {
  const base = SAP_BASE;
  const requests = [];
  let itemNo = 10; // existing bulk line likely 10; new variants start 20
  // Per notes: variant lines start after bulk; use 20,30,...
  let counter = 20;
  for (const v of finalSplit) {
    const itemText = `${nameForLine(lineId)} - ${v.colour} / ${v.size}`;
    const body = {
      PurchaseOrderItem: String(counter),
      PurchaseOrderItemText: itemText.slice(0, 40),
      Material: '',
      Plant: '1710',
      OrderQuantity: v.qty,
      PurchaseOrderQuantityUnit: 'PC',
      NetPriceAmount: 6.40,
      NetPriceQuantity: 1,
      RequirementTracking: 'MIXLOCK',
      _PurchaseOrderScheduleLineTP: [
        { ScheduleLine: '1', ScheduleLineDeliveryDate: deliveryDate(), ScheduleLineOrderQuantity: v.qty }
      ]
    };
    requests.push({
      method: 'POST',
      url: base + `/PurchaseOrder/${poNumber}/_PurchaseOrderItem`,
      path: `/PurchaseOrder/${poNumber}/_PurchaseOrderItem`,
      headers: { 'Content-Type': 'application/json' },
      body
    });
    counter += 10;
  }
  // header note
  const noteText = note || `Mix locked ${new Date().toISOString().slice(0,10)} - deferred mix allocation. Anko ${nameForLine(lineId)} committed ${committedQty} units.`;
  requests.push({
    method: 'POST',
    url: base + `/PurchaseOrder/${poNumber}/_PurchaseOrderNote`,
    path: `/PurchaseOrder/${poNumber}/_PurchaseOrderNote`,
    headers: { 'Content-Type': 'application/json' },
    body: { TextObjectType: 'F01', Language: 'EN', PlainLongText: noteText }
  });

  if (SAP_MODE === 'live') {
    // live mode: fetch CSRF token then send. Best-effort.
    const writes = [];
    try {
      const tokenRes = await fetch(SAP_BASE + '/PurchaseOrder?%24top=1', {
        method: 'GET',
        headers: { APIKey: SAP_KEY, 'x-csrf-token': 'Fetch', Accept: 'application/json' }
      });
      const token = tokenRes.headers.get('x-csrf-token');
      const cookies = tokenRes.headers.get('set-cookie');
      for (const req of requests) {
        const r = await fetch(req.url, {
          method: req.method,
          headers: Object.assign({}, req.headers, { APIKey: SAP_KEY, 'x-csrf-token': token || '' }, cookies ? { Cookie: cookies } : {}),
          body: JSON.stringify(req.body)
        });
        const t = await r.text();
        writes.push({ status: r.status, body: tryJson(t) });
      }
    } catch (e) {
      writes.push({ error: e.message });
    }
    const entry = { id: uid(), createdAt: new Date().toISOString(), mode: 'live', lineId, poNumber, requests, responses: writes };
    const store = getStore(); store.unshift(entry); setStore(store);
    return { mode: 'live', id: entry.id, requests, responses: writes };
  }

  // simulate
  const entry = { id: uid(), createdAt: new Date().toISOString(), mode: 'simulate', lineId, poNumber, requests };
  const store = getStore(); store.unshift(entry); setStore(store);
  // mark line locked
  const st = getState();
  st.locked = st.locked || {};
  st.locked[lineId] = { writeId: entry.id, finalSplit, at: entry.createdAt };
  setState(st);
  return { mode: 'simulate', id: entry.id, requests, banner: 'Simulation mode - SAP sandbox is read-only. This request is ready for Kmart\'s production S/4HANA system.' };
}

function nameForLine(id) {
  const l = LINES.find(x => x.id === id);
  return l ? l.name : 'ANKO Item';
}
function deliveryDate() { return '2027-02-15'; }
function tryJson(t) { try { return JSON.parse(t); } catch (e) { return t; } }

// --- http server ---
function sendJson(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}
function sendFile(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': (types[ext] || 'application/octet-stream') });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
}

function collectBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;

    if (pathname === '/api/config') {
      return sendJson(res, 200, { sapWriteMode: SAP_MODE, sapBase: SAP_BASE });
    }
    if (pathname === '/api/lines' && req.method === 'GET') {
      const state = getState();
      const cache = readJson(CACHE_FILE, { pos: {} });
      const out = [];
      for (const l of LINES) {
        let poData = null;
        let cached = false;
        try {
          const r = await sapGet(`/PurchaseOrder/${l.poNumber}?$expand=_PurchaseOrderItem`);
          if (r.ok) {
            poData = simplifyPO(r.data);
            cache.pos = cache.pos || {};
            cache.pos[l.poNumber] = { sap: poData, at: new Date().toISOString() };
            writeJson(CACHE_FILE, cache);
          } else if (cache.pos && cache.pos[l.poNumber]) {
            poData = cache.pos[l.poNumber].sap;
            cached = true;
          }
        } catch (e) {
          if (cache.pos && cache.pos[l.poNumber]) {
            poData = cache.pos[l.poNumber].sap;
            cached = true;
          }
        }
        out.push(Object.assign({}, l, {
          sap: poData,
          cached: cached,
          status: (state.locked && state.locked[l.id]) ? 'Mix locked' : 'G1 committed',
          lockedDetail: (state.locked && state.locked[l.id]) || null
        }));
      }
      return sendJson(res, 200, { lines: out });
    }
    if (pathname.startsWith('/api/lines/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const state = getState();
      const l = LINES.find(x => x.id === id);
      if (!l) return sendJson(res, 404, { error: 'not found' });
      let poData = null;
      let cached = false;
      const cache = readJson(CACHE_FILE, { pos: {} });
      try {
        const r = await sapGet(`/PurchaseOrder/${l.poNumber}?$expand=_PurchaseOrderItem`);
        if (r.ok) {
          poData = simplifyPO(r.data);
          cache.pos = cache.pos || {};
          cache.pos[l.poNumber] = { sap: poData, at: new Date().toISOString() };
          writeJson(CACHE_FILE, cache);
        } else if (cache.pos && cache.pos[l.poNumber]) {
          poData = cache.pos[l.poNumber].sap;
          cached = true;
        }
      } catch (e) {
        if (cache.pos && cache.pos[l.poNumber]) {
          poData = cache.pos[l.poNumber].sap;
          cached = true;
        }
      }
      return sendJson(res, 200, Object.assign({}, l, {
        sap: poData,
        cached: cached,
        status: (state.locked && state.locked[l.id]) ? 'Mix locked' : 'G1 committed',
        lockedDetail: (state.locked && state.locked[l.id]) || null
      }));
    }
    if (pathname.startsWith('/api/po/') && req.method === 'GET') {
      const po = decodeURIComponent(pathname.split('/')[3]);
      const cache = readJson(CACHE_FILE, { pos: {} });
      const r = await sapGet(`/PurchaseOrder/${po}?$expand=_PurchaseOrderItem`);
      if (r.ok) {
        const sp = simplifyPO(r.data);
        cache.pos = cache.pos || {};
        cache.pos[po] = { sap: sp, at: new Date().toISOString() };
        writeJson(CACHE_FILE, cache);
        return sendJson(res, 200, sp);
      }
      if (cache.pos && cache.pos[po]) {
        return sendJson(res, 200, Object.assign({}, cache.pos[po].sap, { cached: true }));
      }
      return sendJson(res, r.status, r.data);
    }
    if (pathname === '/api/mixlock' && req.method === 'POST') {
      const body = await collectBody(req);
      let j; try { j = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
      const { lineId, poNumber, finalSplit, note } = j;
      const line = LINES.find(x => x.id === lineId);
      const committedQty = (j.committedQty) || 0;
      const result = await sapWriteAdapter({ lineId, poNumber, finalSplit, note, committedQty });
      return sendJson(res, 200, result);
    }
    if (pathname === '/api/writes' && req.method === 'GET') {
      return sendJson(res, 200, { writes: getStore() });
    }
    if (pathname.startsWith('/api/writes/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const entry = getStore().find(w => w.id === id);
      if (!entry) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, entry);
    }
    if (pathname === '/api/reset-state' && req.method === 'POST') {
      setState({ locked: {} });
      setStore([]);
      return sendJson(res, 200, { ok: true });
    }

    // static files
    let p = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(__dirname, 'public', p.replace(/^\/+/, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return sendFile(res, filePath);
    }
    // fallback index
    const idx = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(idx)) return sendFile(res, idx);
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Anko Mix-Lock server listening on http://localhost:${PORT}`);
  console.log(`SAP mode: ${SAP_MODE}`);
});
