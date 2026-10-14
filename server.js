const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { allOrders, findOrder, REPORTABLE } = require('./data/orders');
const recovery = require('./lib/recovery');
const { SALES_ORDER_PATH } = require('./lib/sapQuery');

function loadEnv() {
  const env = {};
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch (err) {
    // A missing .env is the normal prototype path.
  }
  return env;
}

const ENV = loadEnv();
const SAP_BASE = (ENV.SAP_BASE_URL || process.env.SAP_BASE_URL || '').replace(/\/+$/, '');
const SAP_KEY = ENV.SAP_API_KEY || process.env.SAP_API_KEY || '';
const SAP_MODE = ENV.SAP_WRITE_MODE || process.env.SAP_WRITE_MODE || 'simulate';
const PORT = Number(ENV.PORT || process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    return { cases: {}, problems: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function sapGet(sapPath) {
  if (!SAP_BASE || !SAP_KEY) return null;
  let res;
  try {
    res = await fetch(SAP_BASE + sapPath, {
      headers: { APIKey: SAP_KEY, Accept: 'application/json' }
    });
  } catch (err) {
    return null;
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (err) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

async function sapPost(sapPath, body) {
  if (SAP_MODE !== 'live' || !SAP_BASE || !SAP_KEY) {
    return { mode: 'simulate' };
  }
  try {
    const res = await fetch(SAP_BASE + sapPath, {
      method: 'POST',
      headers: {
        APIKey: SAP_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return { mode: res.ok ? 'live' : 'simulate', status: res.status, response: text.slice(0, 500) };
  } catch (err) {
    return { mode: 'simulate', error: err.message };
  }
}

function withProblem(order) {
  const state = readState();
  const reported = state.problems[order.id];
  if (reported) order.problem = reported;
  if (!order.problem && reported) order.problem = reported;
  const active = state.cases[order.id] || null;
  return {
    id: order.id,
    salesOrder: order.salesOrder,
    outboundDelivery: order.outboundDelivery,
    freightOrder: order.freightOrder,
    customer: order.customer,
    channel: order.channel,
    address: order.address,
    promise: order.promise,
    node: order.node,
    items: order.items,
    events: order.events,
    problem: order.problem,
    headline: order.headline,
    summary: order.problem ? order.problem.title : order.summary,
    total: recovery.orderTotal(order),
    options: recovery.optionsFor(order, order.problem),
    recoveryCase: active,
    sap: {
      salesOrder: order.salesOrder,
      outboundDelivery: order.outboundDelivery,
      freightOrder: order.freightOrder,
      apis: ['API_SALES_ORDER_SRV', 'API_OUTBOUND_DELIVERY_SRV', 'CE_FREIGHTORDER_0001']
    }
  };
}

function catalogueOrder(id) {
  const order = findOrder(id);
  if (!order) return null;
  const state = readState();
  if (state.problems[order.id]) {
    order.problem = state.problems[order.id];
    order.headline = order.problem.title;
    order.summary = order.problem.title;
  }
  return order;
}

function listOrders() {
  return allOrders()
    .map(order => {
      const state = readState();
      if (state.problems[order.id]) order.problem = state.problems[order.id];
      const card = withProblem(order);
      return {
        id: card.id,
        salesOrder: card.salesOrder,
        summary: order.problem ? order.problem.title : order.summary,
        headline: order.problem ? order.problem.title : order.headline,
        item: order.items[0].name,
        promise: order.promise,
        tone: order.problem ? 'problem' : 'ok',
        hasCase: Boolean(card.recoveryCase),
        caseStatus: card.recoveryCase ? card.recoveryCase.status : null
      };
    })
    .sort((a, b) => Number(b.tone === 'problem') - Number(a.tone === 'problem'));
}

function salesOrderRows(payload) {
  const root = payload && (payload.d || payload);
  if (!root) return [];
  if (Array.isArray(root.results)) return root.results;
  if (root.SalesOrder) return [root];
  return [];
}

async function readSalesOrders() {
  const query = {
    api: 'API_SALES_ORDER_SRV',
    path: SALES_ORDER_PATH,
    top: 5,
    select: 'SalesOrder,SoldToParty,TotalNetAmount,RequestedDeliveryDate,OverallDeliveryStatus',
    expand: 'to_Item'
  };
  if (!SAP_BASE || !SAP_KEY) {
    return Object.assign({ configured: false, ok: false }, query);
  }
  const result = await sapGet(SALES_ORDER_PATH);
  if (!result) return Object.assign({ configured: true, ok: false }, query);
  const rows = salesOrderRows(result.data);
  return Object.assign({
    configured: true,
    ok: result.ok,
    status: result.status,
    count: rows.length,
    salesOrders: rows.slice(0, 5).map(row => ({
      SalesOrder: row.SalesOrder,
      SoldToParty: row.SoldToParty,
      RequestedDeliveryDate: row.RequestedDeliveryDate,
      OverallDeliveryStatus: row.OverallDeliveryStatus
    }))
  }, query);
}

async function orderFromSap(salesOrder) {
  const result = await sapGet(`/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${encodeURIComponent(salesOrder)}')?$expand=to_Item`);
  if (!result || !result.ok) return null;
  const row = result.data.d || result.data;
  const items = ((row.to_Item && row.to_Item.results) || []).map(item => ({
    sku: item.Material || 'ITEM',
    name: item.SalesOrderItemText || item.Material || 'Item',
    qty: Number(item.RequestedQuantity) || 1,
    price: Number(item.NetAmount) || 0,
    damaged: false
  }));
  return {
    id: row.PurchaseOrderByCustomer || salesOrder,
    salesOrder: row.SalesOrder || salesOrder,
    outboundDelivery: '',
    freightOrder: '',
    customer: 'SAP customer',
    soldToParty: row.SoldToParty || '',
    channel: 'Home delivery',
    address: 'On the sales order',
    promise: row.RequestedDeliveryDate || 'Date on the sales order',
    node: 'SAP S/4HANA',
    items: items.length ? items : [{ sku: 'ITEM', name: 'Sales order item', qty: 1, price: 0, damaged: false }],
    events: [{ at: 'From SAP', title: `Sales order ${row.SalesOrder || salesOrder} read from API_SALES_ORDER_SRV`, state: 'current' }],
    problem: null,
    headline: 'We found this sales order',
    summary: 'Sales order read from SAP',
    live: true
  };
}

function sendFile(res, filePath) {
  const data = fs.readFileSync(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  res.writeHead(200, {
    'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        sapWriteMode: SAP_MODE,
        sapConfigured: Boolean(SAP_BASE && SAP_KEY),
        serviceApi: recovery.SERVICE_API,
        salesOrderApi: 'API_SALES_ORDER_SRV'
      });
    }

    if (pathname === '/api/sap/sales-orders' && req.method === 'GET') {
      return sendJson(res, 200, await readSalesOrders());
    }

    if (pathname === '/api/orders' && req.method === 'GET') {
      return sendJson(res, 200, { orders: listOrders() });
    }

    if (pathname === '/api/reset' && req.method === 'POST') {
      writeState({ cases: {}, problems: {} });
      return sendJson(res, 200, { ok: true });
    }

    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)(?:\/(problem|recovery|reset))?$/);
    if (orderMatch) {
      const id = decodeURIComponent(orderMatch[1]);
      const action = orderMatch[2];
      let order = catalogueOrder(id);
      if (!order && /^\d+$/.test(id)) order = await orderFromSap(id);
      if (!order) return sendJson(res, 404, { error: 'We can’t find that order. Check the number on your email.' });

      if (!action && req.method === 'GET') return sendJson(res, 200, withProblem(order));

      if (action === 'problem' && req.method === 'POST') {
        const raw = await collectBody(req);
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (err) { return sendJson(res, 400, { error: 'bad json' }); }
        const problem = REPORTABLE[body.code];
        if (!problem) return sendJson(res, 400, { error: 'Choose what went wrong.' });
        const state = readState();
        state.problems[order.id] = problem;
        delete state.cases[order.id];
        writeState(state);
        return sendJson(res, 200, withProblem(catalogueOrder(order.id)));
      }

      if (action === 'reset' && req.method === 'POST') {
        const state = readState();
        delete state.cases[order.id];
        delete state.problems[order.id];
        writeState(state);
        return sendJson(res, 200, withProblem(catalogueOrder(order.id) || order));
      }

      if (action === 'recovery' && req.method === 'POST') {
        const current = catalogueOrder(order.id) || order;
        const raw = await collectBody(req);
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (err) { return sendJson(res, 400, { error: 'bad json' }); }
        const option = recovery.optionById(current, current.problem, body.optionId);
        if (!current.problem) return sendJson(res, 400, { error: 'There is no delivery problem on this order yet.' });
        if (!option) return sendJson(res, 400, { error: 'Choose a recovery option.' });
        const recoveryCase = recovery.createCase({ order: current, problem: current.problem, option });
        const posted = await sapPost('/sap/opu/odata/sap/OP_API_SERVICE_REQUEST_SRV_0001/A_ServiceRequest', recoveryCase.requests[0].body);
        recoveryCase.requests[0].mode = posted.mode;
        if (posted.status) recoveryCase.requests[0].status = posted.status;
        const state = readState();
        state.cases[current.id] = recoveryCase;
        writeState(state);
        return sendJson(res, 200, withProblem(catalogueOrder(current.id) || current));
      }
    }

    const caseMatch = pathname.match(/^\/api\/cases\/([^/]+)\/(advance|complete)$/);
    if (caseMatch && req.method === 'POST') {
      const caseId = decodeURIComponent(caseMatch[1]);
      const state = readState();
      const orderId = Object.keys(state.cases).find(key => state.cases[key].id === caseId);
      if (!orderId) return sendJson(res, 404, { error: 'That recovery could not be found.' });
      const order = catalogueOrder(orderId);
      const option = recovery.optionById(order, order.problem, state.cases[orderId].optionId);
      if (caseMatch[2] === 'advance') {
        recovery.advance(state.cases[orderId]);
      } else {
        recovery.complete(state.cases[orderId], order, option);
        const last = state.cases[orderId].requests.at(-1);
        const posted = await sapPost('/sap/opu/odata/sap/OP_API_SERVICE_REQUEST_SRV_0001/A_ServiceRequest', last.body);
        last.mode = posted.mode;
        if (posted.status) last.status = posted.status;
      }
      writeState(state);
      return sendJson(res, 200, withProblem(catalogueOrder(orderId)));
    }

    let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.normalize(path.join(__dirname, 'public', relative));
    const root = path.normalize(path.join(__dirname, 'public') + path.sep);
    if (filePath.startsWith(root) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return sendFile(res, filePath);
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try that again.' });
  }
});

server.listen(PORT, () => {
  console.log(`Kmart Delivery Assist listening on http://localhost:${PORT}`);
  console.log(`SAP write mode: ${SAP_MODE}`);
});
