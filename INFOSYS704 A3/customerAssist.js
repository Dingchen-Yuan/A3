// Customer Delivery Assist.
// Separate from the inbound Delivery Tracker: own orders, own state file,
// own /api/assist routes. It does not read or write purchase-order state.

const fs = require('fs');
const path = require('path');
const recovery = require('./lib/customerRecovery');
const amounts = require('./lib/customerAmounts');
const selections = require('./lib/customerSelections');
const { allOrders, findOrder, REPORTABLE } = require('./data/customerOrders');
const { SALES_ORDER_PATH } = require('./lib/salesOrderQuery');

const STATE_FILE = path.join(__dirname, 'data', 'customer_state.json');
const SAP_TIMEOUT_MS = 8000;

// Serialize mutations and cache-populating lookups in this single-process demo
// so concurrent requests cannot overwrite another order's saved state.
let mutationQueue = Promise.resolve();
function serializeMutation(fn) {
  const result = mutationQueue.then(fn);
  mutationQueue = result.catch(() => {});
  return result;
}

function salesRoot(sapBase) {
  const base = String(sapBase || '').replace(/\/+$/, '');
  const marker = base.indexOf('/sap/opu/');
  if (marker > 0) return base.slice(0, marker);
  return base || 'https://sandbox.api.sap.com/s4hanacloud';
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Object.assign({}, state, { cases: state.cases || {}, problems: state.problems || {}, orders: state.orders || {} });
  } catch (err) {
    return { cases: {}, problems: {}, orders: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sapGet(root, key, sapPath) {
  if (!root || !key) return null;
  try {
    const res = await fetch(root + sapPath, {
      headers: { APIKey: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(SAP_TIMEOUT_MS)
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (err) { json = { raw: text }; }
    return { status: res.status, ok: res.ok, data: json };
  } catch (err) {
    return null;
  }
}

async function sapPost(root, key, mode, sapPath, body) {
  if (mode !== 'live') return { mode: 'simulate', ok: true };
  if (!root || !key) return { mode: 'live', ok: false, error: 'SAP is not configured.' };
  try {
    const res = await fetch(root + sapPath, {
      method: 'POST',
      headers: {
        APIKey: key,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SAP_TIMEOUT_MS)
    });
    const text = await res.text();
    return { mode: 'live', ok: res.ok, status: res.status, response: text.slice(0, 500) };
  } catch (err) {
    return { mode: 'live', ok: false, error: err.message };
  }
}

function applyProblem(order, state) {
  const problem = state.problems[order.id];
  return problem ? Object.assign({}, order, { problem, headline: problem.title, summary: problem.title }) : order;
}

function withProblem(order) {
  const state = readState();
  order = applyProblem(order, state);
  const currency = amounts.currencyFor(order);
  const active = state.cases[order.id] || null;
  const affectedItems = selections.forProblem(order, order.problem);
  return {
    id: order.id,
    customerReference: order.customerReference || order.id,
    salesOrder: order.salesOrder,
    currency,
    source: order.source || 'demo',
    cached: Boolean(order.cached),
    sapReadAt: order.sapReadAt || null,
    outboundDelivery: order.outboundDelivery,
    freightOrder: order.freightOrder,
    customer: order.customer,
    channel: order.channel,
    address: order.address,
    promise: order.promise,
    node: order.node,
    items: order.items.map((item, index) => Object.assign({}, item, {
      itemId: selections.itemId(index),
      affectedQty: order.problem ? (affectedItems.find(affected => affected.itemId === selections.itemId(index)) || {}).qty || 0 : 0,
      lineTotalMinor: amounts.lineTotalMinor(item, currency),
      lineTotal: amounts.lineTotal(item, currency)
    })),
    events: order.events,
    problem: order.problem,
    affectedItems: order.problem ? affectedItems : [],
    selectionIsPartial: Boolean(order.problem && affectedItems.length && selections.isPartial(order, affectedItems)),
    requiresItemSelection: selections.needsItemSelection(order.problem) && !affectedItems.length,
    headline: order.headline,
    summary: order.problem ? order.problem.title : order.summary,
    total: recovery.orderTotal(order),
    options: recovery.optionsFor(order, order.problem),
    recoveryCase: active ? Object.assign({}, active, { outcomeCopy: recovery.outcomeCopy(active, order) }) : null,
    sap: {
      salesOrder: order.salesOrder,
      outboundDelivery: order.outboundDelivery,
      freightOrder: order.freightOrder,
      apis: ['API_SALES_ORDER_SRV', 'API_OUTBOUND_DELIVERY_SRV', 'CE_FREIGHTORDER_0001']
    }
  };
}

class OrderLookupError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function salesKey(value) {
  const key = String(value || '').trim().toUpperCase();
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
}

function savedOrders(state) {
  return Object.values(state.orders).filter(order => order && typeof order.id === 'string' && Array.isArray(order.items));
}

function knownOrder(query, state = readState()) {
  const text = String(query || '').trim();
  const demo = findOrder(text) || (/^\d+$/.test(text) && allOrders().find(order => salesKey(order.salesOrder) === salesKey(text)));
  if (demo) return applyProblem(Object.assign({}, demo, { source: 'demo', currency: 'AUD' }), state);
  const orders = savedOrders(state);
  const explicit = /^SAP-(.+)$/i.exec(text);
  const canonicalId = explicit ? 'SAP-' + salesKey(explicit[1]) : text;
  const canonical = orders.find(order => order.id.toLowerCase() === canonicalId.toLowerCase());
  if (canonical) return applyProblem(Object.assign({}, canonical, { cached: true }), state);
  const bySalesOrder = orders.find(order => salesKey(order.salesOrder) === salesKey(text));
  if (bySalesOrder) return applyProblem(Object.assign({}, bySalesOrder, { cached: true }), state);
  const matches = orders.filter(order => String(order.customerReference || '').toLowerCase() === text.toLowerCase());
  if (matches.length > 1) throw new OrderLookupError('More than one order uses that reference. Please enter the sales order number.', 409);
  return matches.length ? applyProblem(Object.assign({}, matches[0], { cached: true }), state) : null;
}

async function resolveOrder(query, root, key) {
  const known = knownOrder(query);
  if (known) return known;
  if (!key) return null;
  const order = await orderFromSap(root, key, String(query || '').trim());
  if (!order) return null;
  const state = readState();
  const cached = Boolean(state.orders[order.id]);
  // Keep the original snapshot for an existing case; a later lookup must not
  // change the quantities, currency or refund value that was already selected.
  if (!state.orders[order.id]) {
    state.orders[order.id] = order;
    writeState(state);
  }
  return applyProblem(Object.assign({}, state.orders[order.id], { cached }), readState());
}

function caseLabel(recoveryCase) {
  if (!recoveryCase) return null;
  if (recoveryCase.status !== 'closed') return 'Recovery in progress';
  if (recoveryCase.outcome === 'refund') return 'Refund confirmed';
  if (recoveryCase.outcome === 'replacement') return 'Replacement confirmed';
  if (recoveryCase.outcome === 'collection') return 'Collection confirmed';
  return 'Redelivery confirmed';
}

function listOrders() {
  const state = readState();
  return allOrders().concat(savedOrders(state))
    .map(order => {
      order = applyProblem(order, state);
      const card = withProblem(order);
      return {
        id: card.id,
        customerReference: card.customerReference,
        source: card.source,
        salesOrder: card.salesOrder,
        summary: order.problem ? order.problem.title : order.summary,
        headline: order.problem ? order.problem.title : order.headline,
        item: order.items[0].name,
        promise: order.promise,
        tone: order.problem ? 'problem' : 'ok',
        hasCase: Boolean(card.recoveryCase),
        caseStatus: card.recoveryCase ? card.recoveryCase.status : null,
        caseLabel: caseLabel(card.recoveryCase)
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

async function orderFromSap(root, key, query) {
  const endpoint = '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder';
  const explicit = /^SAP-(.+)$/i.exec(query);
  const salesOrder = explicit ? explicit[1] : /^\d+$/.test(query) ? query : null;
  let result;
  if (salesOrder) {
    const escaped = encodeURIComponent(salesOrder.replace(/'/g, "''"));
    result = await sapGet(root, key, `${endpoint}('${escaped}')?$expand=to_Item`);
  }
  // A reference may be non-numeric (or a numeric customer PO number). Escape
  // OData literals and encode query parameters rather than interpolating input.
  if (!salesOrder || (result && result.status === 404)) {
    const literal = "'" + query.replace(/'/g, "''") + "'";
    const params = new URLSearchParams({
      '$filter': `(SalesOrder eq ${literal} or PurchaseOrderByCustomer eq ${literal})`,
      '$top': '2', '$expand': 'to_Item'
    });
    result = await sapGet(root, key, endpoint + '?' + params);
  }
  if (result && result.status === 404) return null;
  if (!result || !result.ok) throw new OrderLookupError('SAP order lookup is unavailable. Please try again later.');
  const rows = salesOrderRows(result.data);
  if (rows.length > 1) throw new OrderLookupError('More than one order uses that reference. Please enter the sales order number.', 409);
  if (!rows.length) return null;
  const row = rows[0];
  const number = String(row.SalesOrder || '').trim();
  const rawItems = row.to_Item && row.to_Item.results;
  if (!number || !Array.isArray(rawItems) || !rawItems.length) {
    throw new OrderLookupError('SAP returned incomplete order details. Please try again later.');
  }
  let currency, items;
  try {
    currency = amounts.currencyCode(row.TransactionCurrency || rawItems[0].TransactionCurrency || '');
    items = rawItems.map(item => {
      const qty = Number(item.RequestedQuantity);
      if (!['string', 'number'].includes(typeof item.RequestedQuantity) || !Number.isFinite(qty) || qty <= 0 || item.NetAmount == null || String(item.NetAmount).trim() === '' || Number(item.NetAmount) < 0) {
        throw new RangeError('Invalid order amount or quantity');
      }
      if (item.TransactionCurrency && amounts.currencyCode(item.TransactionCurrency) !== currency) {
        throw new RangeError('Mixed order currencies');
      }
      const lineTotalMinor = amounts.toMinor(item.NetAmount, currency);
      const lineTotal = amounts.fromMinor(lineTotalMinor, currency);
      return {
        itemNumber: item.SalesOrderItem || '',
        sku: item.Material || 'ITEM', name: item.SalesOrderItemText || item.Material || 'Item',
        qty, price: lineTotal / qty, lineTotalMinor, lineTotal, damaged: false
      };
    });
    amounts.sumMinor(items, currency);
  } catch (err) {
    throw new OrderLookupError('SAP returned an invalid order amount, quantity or currency. No recovery has been created.');
  }
  const requested = String(row.RequestedDeliveryDate || '');
  const wrappedDate = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(requested);
  const date = wrappedDate && new Date(Number(wrappedDate[1]));
  const promise = date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : requested || 'Date on the sales order';
  return {
    id: 'SAP-' + salesKey(number),
    customerReference: String(row.PurchaseOrderByCustomer || number).trim(),
    salesOrder: number,
    currency, source: 'sap', sapReadAt: new Date().toISOString(),
    outboundDelivery: '',
    freightOrder: '',
    customer: 'SAP customer',
    soldToParty: row.SoldToParty || '',
    channel: 'Home delivery',
    address: 'On the sales order',
    promise,
    node: 'SAP S/4HANA',
    items,
    events: [{ at: 'From SAP', title: `Sales order ${number} read from API_SALES_ORDER_SRV`, state: 'current' }],
    problem: null,
    headline: 'We found this sales order',
    summary: 'Sales order read from SAP'
  };
}

async function handleRequest(req, res, ctx) {
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
    const state = readState();
    state.cases = {}; state.problems = {};
    writeState(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const orderMatch = pathname.match(/^\/api\/assist\/orders\/([^/]+)(?:\/(problem|recovery|reset))?$/);
  if (orderMatch) {
    const id = decodeURIComponent(orderMatch[1]);
    const action = orderMatch[2];
    const order = await resolveOrder(id, root, key);
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
      const problem = typeof body.code === 'string' && Object.hasOwn(REPORTABLE, body.code) ? REPORTABLE[body.code] : null;
      if (!problem) {
        sendJson(res, 400, { error: 'Choose what went wrong.' });
        return true;
      }
      const state = readState();
      if (state.cases[order.id]) {
        sendJson(res, 409, { error: 'A recovery already exists for this order. Continue it, or restart the order before reporting another problem.' });
        return true;
      }
      let reported = Object.assign({}, problem);
      if (selections.needsItemSelection(problem)) {
        const affected = selections.validate(order, body.affectedItems);
        reported.affectedItems = affected.map(item => ({ itemId: item.itemId, qty: item.qty }));
      } else if (body.affectedItems != null) {
        throw new selections.SelectionError('A delay or failed attempt covers the whole delivery. Item selection is for damaged or missing items.');
      }
      state.problems[order.id] = reported;
      writeState(state);
      sendJson(res, 200, withProblem(knownOrder(order.id)));
      return true;
    }

    if (action === 'reset' && req.method === 'POST') {
      const state = readState();
      delete state.cases[order.id];
      delete state.problems[order.id];
      writeState(state);
      sendJson(res, 200, withProblem(knownOrder(order.id)));
      return true;
    }

    if (action === 'recovery' && req.method === 'POST') {
      const current = knownOrder(order.id);
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
      const state = readState();
      if (state.cases[current.id]) {
        if (state.cases[current.id].optionId !== option.id) {
          sendJson(res, 409, { error: 'A recovery already exists with a different option. Continue your existing recovery.' });
          return true;
        }
        sendJson(res, 200, withProblem(current));
        return true;
      }
      const recoveryCase = recovery.createCase({ order: current, problem: current.problem, option });
      const posted = await sapPost(root, key, mode, '/sap/opu/odata/sap/OP_API_SERVICE_REQUEST_SRV_0001/A_ServiceRequest', recoveryCase.requests[0].body);
      if (!posted.ok) {
        sendJson(res, 502, { error: 'We could not send your recovery request to SAP. Nothing has been confirmed. Please try again.', sapStatus: posted.status || null });
        return true;
      }
      if (selections.needsItemSelection(current.problem) && !selections.forProblem(current, current.problem).length) {
        throw new selections.SelectionError('Choose and confirm the affected items before starting a recovery.');
      }
      recoveryCase.requests[0].mode = posted.mode;
      if (posted.status) recoveryCase.requests[0].status = posted.status;
      state.cases[current.id] = recoveryCase;
      writeState(state);
      sendJson(res, 200, withProblem(knownOrder(current.id)));
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
    const order = await resolveOrder(orderId, root, key);
    if (!order) {
      sendJson(res, 404, { error: 'We can’t find the order linked to this recovery.' });
      return true;
    }
    const recoveryCase = state.cases[orderId];
    if (recoveryCase.status === 'closed') {
      sendJson(res, 200, withProblem(order));
      return true;
    }
    // Case scope and financial values are frozen at creation, including for
    // older saved cases that predate item-specific problem reporting.
    const option = recovery.STEP_COPY[recoveryCase.optionId] && {
      id: recoveryCase.optionId, title: recoveryCase.title, detail: recoveryCase.detail,
      outcome: recoveryCase.outcome, amount: recoveryCase.amount
    };
    if (!option) {
      sendJson(res, 400, { error: 'Choose a recovery option.' });
      return true;
    }
    if (caseMatch[2] === 'advance') {
      recovery.advance(recoveryCase);
    } else {
      if (!recovery.canComplete(recoveryCase)) {
        sendJson(res, 409, { error: 'This recovery is not ready to complete. Check for an update first.' });
        return true;
      }
      recovery.complete(recoveryCase, order, option);
      const last = recoveryCase.requests.at(-1);
      const posted = await sapPost(root, key, mode, '/sap/opu/odata/sap/OP_API_SERVICE_REQUEST_SRV_0001/A_ServiceRequest', last.body);
      if (!posted.ok) {
        // The edited case exists only in this local copy. Do not save it as
        // closed unless SAP confirms the write; the persisted case stays ready.
        sendJson(res, 502, { error: 'We could not confirm this recovery with SAP. Your case is still ready to complete. Please try again.', sapStatus: posted.status || null });
        return true;
      }
      last.mode = posted.mode;
      if (posted.status) last.status = posted.status;
    }
    writeState(state);
    sendJson(res, 200, withProblem(knownOrder(order.id)));
    return true;
  }

  sendJson(res, 404, { error: 'Unknown API route' });
  return true;
}

async function tryHandle(req, res, ctx) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/api/assist')) return false;
  try {
    const cachesOrder = req.method === 'GET' && /^\/api\/assist\/orders\/[^/]+$/.test(pathname);
    if (req.method === 'POST' || cachesOrder) return await serializeMutation(() => handleRequest(req, res, ctx));
    return await handleRequest(req, res, ctx);
  } catch (err) {
    if (!(err instanceof OrderLookupError) && !(err instanceof selections.SelectionError)) throw err;
    ctx.sendJson(res, err.status, { error: err.message });
    return true;
  }
}

module.exports = { tryHandle, salesRoot };
