// Customer Delivery Assist.
// Separate from the inbound Delivery Tracker: own orders, own state file,
// own /api/assist routes. It does not read or write purchase-order state.

const fs = require('fs');
const path = require('path');
const recovery = require('./lib/customerRecovery');
const { allOrders, findOrder, REPORTABLE } = require('./data/customerOrders');
const { SALES_ORDER_PATH } = require('./lib/salesOrderQuery');

const STATE_FILE = path.join(__dirname, 'data', 'customer_state.json');

function salesRoot(sapBase) {
  const base = String(sapBase || '').replace(/\/+$/, '');
  const marker = base.indexOf('/sap/opu/');
  if (marker > 0) return base.slice(0, marker);
  return base || 'https://sandbox.api.sap.com/s4hanacloud';
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    return { cases: {}, problems: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sapGet(root, key, sapPath) {
  if (!root || !key) return null;
  let res;
  try {
    res = await fetch(root + sapPath, {
      headers: { APIKey: key, Accept: 'application/json' }
    });
  } catch (err) {
    return null;
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (err) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

async function sapPost(root, key, mode, sapPath, body) {
  if (mode !== 'live' || !root || !key) return { mode: 'simulate' };
  try {
    const res = await fetch(root + sapPath, {
      method: 'POST',
      headers: {
        APIKey: key,
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
  if (state.problems[order.id]) order.problem = state.problems[order.id];
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

async function readSalesOrders(root, key) {
  const query = {
    api: 'API_SALES_ORDER_SRV',
    path: SALES_ORDER_PATH,
    top: 5,
    select: 'SalesOrder,SoldToParty,TotalNetAmount,RequestedDeliveryDate,OverallDeliveryStatus',
    expand: 'to_Item'
  };
  if (!key) return Object.assign({ configured: false, ok: false }, query);
  const result = await sapGet(root, key, SALES_ORDER_PATH);
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

async function orderFromSap(root, key, salesOrder) {
  const result = await sapGet(root, key, `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${encodeURIComponent(salesOrder)}')?$expand=to_Item`);
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

async function tryHandle(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/assist')) return false;

  const root = salesRoot(ctx.sapBase);
  const key = ctx.sapKey || '';
  const mode = ctx.sapMode || 'simulate';
  const sendJson = ctx.sendJson;

  if (pathname === '/api/assist/config' && req.method === 'GET') {
    sendJson(res, 200, {
      sapWriteMode: mode,
      sapConfigured: Boolean(key),
      serviceApi: recovery.SERVICE_API,
      salesOrderApi: 'API_SALES_ORDER_SRV'
    });
    return true;
  }

  if (pathname === '/api/assist/sap/sales-orders' && req.method === 'GET') {
    sendJson(res, 200, await readSalesOrders(root, key));
    return true;
  }

  if (pathname === '/api/assist/orders' && req.method === 'GET') {
    sendJson(res, 200, { orders: listOrders() });
    return true;
  }

  if (pathname === '/api/assist/reset' && req.method === 'POST') {
    writeState({ cases: {}, problems: {} });
    sendJson(res, 200, { ok: true });
    return true;
  }

  const orderMatch = pathname.match(/^\/api\/assist\/orders\/([^/]+)(?:\/(problem|recovery|reset))?$/);
  if (orderMatch) {
    const id = decodeURIComponent(orderMatch[1]);
    const action = orderMatch[2];
    let order = catalogueOrder(id);
    if (!order && /^\d+$/.test(id)) order = await orderFromSap(root, key, id);
    if (!order) {
      sendJson(res, 404, { error: 'We can’t find that order. Check the number on your email.' });
      return true;
    }

    if (!action && req.method === 'GET') {
      sendJson(res, 200, withProblem(order));
      return true;
    }

    if (action === 'problem' && req.method === 'POST') {
      const body = await ctx.jsonBody(req);
      if (!body) {
        sendJson(res, 400, { error: 'bad json' });
        return true;
      }
      const problem = REPORTABLE[body.code];
      if (!problem) {
        sendJson(res, 400, { error: 'Choose what went wrong.' });
        return true;
      }
      const state = readState();
      state.problems[order.id] = problem;
      delete state.cases[order.id];
      writeState(state);
      sendJson(res, 200, withProblem(catalogueOrder(order.id)));
      return true;
    }

    if (action === 'reset' && req.method === 'POST') {
      const state = readState();
      delete state.cases[order.id];
      delete state.problems[order.id];
      writeState(state);
      sendJson(res, 200, withProblem(catalogueOrder(order.id) || order));
      return true;
    }

    if (action === 'recovery' && req.method === 'POST') {
      const current = catalogueOrder(order.id) || order;
      const body = await ctx.jsonBody(req);
      if (!body) {
        sendJson(res, 400, { error: 'bad json' });
        return true;
      }
      const option = recovery.optionById(current, current.problem, body.optionId);
      if (!current.problem) {
        sendJson(res, 400, { error: 'There is no delivery problem on this order yet.' });
        return true;
      }
      if (!option) {
        sendJson(res, 400, { error: 'Choose a recovery option.' });
        return true;
      }
      const recoveryCase = recovery.createCase({ order: current, problem: current.problem, option });
      const posted = await sapPost(root, key, mode, '/sap/opu/odata/sap/OP_API_SERVICE_REQUEST_SRV_0001/A_ServiceRequest', recoveryCase.requests[0].body);
      recoveryCase.requests[0].mode = posted.mode;
      if (posted.status) recoveryCase.requests[0].status = posted.status;
      const state = readState();
      state.cases[current.id] = recoveryCase;
      writeState(state);
      sendJson(res, 200, withProblem(catalogueOrder(current.id) || current));
      return true;
    }
  }

  const caseMatch = pathname.match(/^\/api\/assist\/cases\/([^/]+)\/(advance|complete)$/);
  if (caseMatch && req.method === 'POST') {
    const caseId = decodeURIComponent(caseMatch[1]);
    const state = readState();
    const orderId = Object.keys(state.cases).find(keyName => state.cases[keyName].id === caseId);
    if (!orderId) {
      sendJson(res, 404, { error: 'That recovery could not be found.' });
      return true;
    }
    const order = catalogueOrder(orderId);
    const option = recovery.optionById(order, order.problem, state.cases[orderId].optionId);
    if (caseMatch[2] === 'advance') {
      recovery.advance(state.cases[orderId]);
    } else {
      recovery.complete(state.cases[orderId], order, option);
      const last = state.cases[orderId].requests.at(-1);
      const posted = await sapPost(root, key, mode, '/sap/opu/odata/sap/OP_API_SERVICE_REQUEST_SRV_0001/A_ServiceRequest', last.body);
      last.mode = posted.mode;
      if (posted.status) last.status = posted.status;
    }
    writeState(state);
    sendJson(res, 200, withProblem(catalogueOrder(orderId)));
    return true;
  }

  sendJson(res, 404, { error: 'Unknown API route' });
  return true;
}

module.exports = { tryHandle, salesRoot };
