// Kmart Delivery Assist, with the Supply Hub buyer workspace.
// Node 18+ (built-in fetch). No npm dependencies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ---------- env ----------
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[k] = v;
    }
  } catch (e) {}
  return env;
}
const ENV = loadEnv();
const staffAccess = require('./lib/staffAccess').createStaffAccess(ENV.STAFF_ACCESS_KEY || process.env.STAFF_ACCESS_KEY || '');
const DEFAULT_BASE = 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001';
const SAP_BASE = (ENV.SAP_BASE_URL || process.env.SAP_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const SAP_KEY = ENV.SAP_API_KEY || process.env.SAP_API_KEY || '';
const SAP_MODE = (ENV.SAP_WRITE_MODE || process.env.SAP_WRITE_MODE || 'simulate').toLowerCase();
const PORT = Number(ENV.PORT || process.env.PORT || 3000);
const SAP_TIMEOUT_MS = 8000;

const { LINES } = require('./data/mockLines');
const { SHIPMENTS, PLACES, LANES } = require('./data/deliveries');
const customerAssist = require('./customerAssist');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORE_FILE = path.join(DATA_DIR, 'sap_write_store.json');
const STATE_FILE = path.join(DATA_DIR, 'app_state.json');
const CACHE_FILE = path.join(DATA_DIR, 'sap_cache.json');
const CASES_FILE = path.join(DATA_DIR, 'recovery_cases.json');

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, v) { fs.writeFileSync(file, JSON.stringify(v, null, 2), 'utf8'); }
const getState = () => readJson(STATE_FILE, { locked: {} });
const setState = s => writeJson(STATE_FILE, s);
const getStore = () => readJson(STORE_FILE, []);
const setStore = s => writeJson(STORE_FILE, s);
const getCases = () => readJson(CASES_FILE, []);
const setCases = c => writeJson(CASES_FILE, c);

function uid(prefix) { return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
const DAY = 86400000;
function isoDate(d) { return new Date(d).toISOString().slice(0, 10); }
function dayOffset(n) { const d = new Date(); d.setHours(12, 0, 0, 0); return isoDate(d.getTime() + n * DAY); }
function nzDate(s) { return new Date(s + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / DAY); }

// ---------- SAP read ----------
let lastSapStatus = { live: false, at: null, message: 'Not contacted yet' };

async function sapGet(sapPath) {
  if (!SAP_KEY && SAP_BASE.includes('sandbox.api.sap.com')) {
    throw new Error('No SAP_API_KEY set – using cached SAP data');
  }
  const res = await fetch(SAP_BASE + sapPath, {
    method: 'GET',
    headers: { APIKey: SAP_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(SAP_TIMEOUT_MS)
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

function simplifyPO(po) {
  if (!po) return null;
  const items = po._PurchaseOrderItem || [];
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
    items: items.map(it => {
      const out = {
        PurchaseOrderItem: it.PurchaseOrderItem,
        PurchaseOrderItemText: it.PurchaseOrderItemText,
        Material: it.Material,
        Plant: it.Plant,
        OrderQuantity: Number(it.OrderQuantity) || 0,
        PurchaseOrderQuantityUnit: it.PurchaseOrderQuantityUnit,
        NetPriceAmount: it.NetPriceAmount,
        NetPriceQuantity: it.NetPriceQuantity,
        RequirementTracking: it.RequirementTracking
      };
      // Delivery-related fields (present when expanded with schedule lines)
      const extra = ['IsCompletelyDelivered', 'ItemIsRejectedBySupplier', 'PurgItemIsBlockedForDelivery',
        'PartialDeliveryIsAllowed', 'IncotermsClassification', 'IncotermsLocation1', 'PlannedDeliveryDurationInDays'];
      for (const k of extra) if (it[k] !== undefined) out[k] = it[k];
      if (Array.isArray(it._PurchaseOrderScheduleLineTP)) {
        out.scheduleLines = it._PurchaseOrderScheduleLineTP.map(sl => ({
          ScheduleLine: sl.ScheduleLine,
          ScheduleLineDeliveryDate: sl.ScheduleLineDeliveryDate,
          SchedLineStscDeliveryDate: sl.SchedLineStscDeliveryDate,
          ScheduleLineOrderQuantity: Number(sl.ScheduleLineOrderQuantity) || 0,
          OpenPurchaseOrderQuantity: sl.OpenPurchaseOrderQuantity !== undefined ? Number(sl.OpenPurchaseOrderQuantity) : undefined,
          GoodsIssueDate: sl.GoodsIssueDate,
          LoadingDate: sl.LoadingDate
        }));
      }
      if (it._DeliveryAddress) {
        const a = it._DeliveryAddress;
        out.deliveryAddress = { CityName: a.CityName, PostalCode: a.PostalCode, Country: a.Country, StreetName: a.StreetName };
      }
      return out;
    })
  };
}

// Short-lived memory cache + small concurrency limit so a page load doesn't fire
// a burst of parallel calls at the sandbox (which can get some of them rejected).
const MEM_TTL_MS = 60000;
const memCache = new Map();          // key -> { at, value }
const inflight = new Map();          // key -> Promise
let active = 0; const queue = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => { active++; fn().then(resolve, reject).finally(() => { active--; if (queue.length) queue.shift()(); }); };
    if (active < 2) run(); else queue.push(run);
  });
}

async function readPO(poNumber, opts = {}) {
  const deep = !!opts.deep;
  const now = Date.now();
  // A deep read also satisfies a shallow request.
  for (const key of deep ? [poNumber + '|deep'] : [poNumber + '|deep', poNumber + '|flat']) {
    const hit = memCache.get(key);
    if (hit && now - hit.at < MEM_TTL_MS) return hit.value;
  }
  const key = poNumber + (deep ? '|deep' : '|flat');
  if (inflight.has(key)) return inflight.get(key);
  const p = limit(() => readPOUncached(poNumber, { deep })).then(v => {
    if (!v.cached) memCache.set(key, { at: Date.now(), value: v });
    return v;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Read a PO live (with optional deeper expand), fall back to the cached snapshot.
async function readPOUncached(poNumber, { deep = false } = {}) {
  const cache = readJson(CACHE_FILE, { pos: {} });
  cache.pos = cache.pos || {};
  const expand = deep
    ? '_PurchaseOrderItem($expand=_PurchaseOrderScheduleLineTP,_DeliveryAddress)'
    : '_PurchaseOrderItem';
  try {
    let r = await sapGet(`/PurchaseOrder/${encodeURIComponent(poNumber)}?$expand=${expand}`);
    if (!r.ok && deep && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403) {
      // Some systems reject the nested expand – fall back to the plain item expand.
      r = await sapGet(`/PurchaseOrder/${encodeURIComponent(poNumber)}?$expand=_PurchaseOrderItem`);
    }
    if (r.ok) {
      const sp = simplifyPO(r.data);
      // keep the richest version in the cache
      const prev = cache.pos[poNumber] && cache.pos[poNumber].sap;
      const hasDeep = sp.items.some(i => i.scheduleLines);
      if (!prev || hasDeep || !(prev.items || []).some(i => i.scheduleLines)) {
        cache.pos[poNumber] = { sap: sp, at: new Date().toISOString() };
        writeJson(CACHE_FILE, cache);
      }
      lastSapStatus = { live: true, at: new Date().toISOString(), message: 'Live read from SAP sandbox' };
      return { sap: sp, cached: false, cachedAt: null };
    }
    lastSapStatus = { live: false, at: new Date().toISOString(), message: `SAP returned ${r.status}` };
    console.warn(`[SAP] PO ${poNumber}${deep ? ' (deep)' : ''}: HTTP ${r.status} – using cached snapshot`);
  } catch (e) {
    lastSapStatus = { live: false, at: new Date().toISOString(), message: e.message };
    if (SAP_KEY) console.warn(`[SAP] PO ${poNumber}${deep ? ' (deep)' : ''}: ${e.message} – using cached snapshot`);
  }
  if (cache.pos[poNumber]) return { sap: cache.pos[poNumber].sap, cached: true, cachedAt: cache.pos[poNumber].at };
  return { sap: null, cached: true, cachedAt: null };
}

// ---------- SAP write adapter (simulate | live) ----------
async function executeWrites({ kind, refId, poNumber, title, requests, meta }) {
  const entry = {
    id: uid('wr_'), kind, refId, poNumber, title,
    createdAt: new Date().toISOString(),
    mode: SAP_MODE === 'live' ? 'live' : 'simulate',
    requests, meta: meta || {}
  };
  if (entry.mode === 'live') {
    const responses = [];
    try {
      const tokenRes = await fetch(SAP_BASE + '/PurchaseOrder?$top=1', {
        headers: { APIKey: SAP_KEY, 'x-csrf-token': 'Fetch', Accept: 'application/json' },
        signal: AbortSignal.timeout(SAP_TIMEOUT_MS)
      });
      const token = tokenRes.headers.get('x-csrf-token');
      const cookies = tokenRes.headers.get('set-cookie');
      for (const rq of requests) {
        const headers = Object.assign({}, rq.headers, { APIKey: SAP_KEY, 'x-csrf-token': token || '' }, cookies ? { Cookie: cookies } : {});
        const r = await fetch(SAP_BASE + rq.path, { method: rq.method, headers, body: JSON.stringify(rq.body), signal: AbortSignal.timeout(SAP_TIMEOUT_MS) });
        responses.push({ status: r.status, body: tryJson(await r.text()) });
      }
    } catch (e) { responses.push({ error: e.message }); }
    entry.responses = responses;
  }
  const store = getStore(); store.unshift(entry); setStore(store);
  return entry;
}

function req(method, p, body, extraHeaders) {
  return { method, path: p, url: SAP_BASE + p, headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}), body };
}
function noteReq(poNumber, text) {
  return req('POST', `/PurchaseOrder/${poNumber}/_PurchaseOrderNote`, { TextObjectType: 'F01', Language: 'EN', PlainLongText: text });
}
function nextItemNumbers(items, count) {
  const max = (items || []).reduce((m, it) => Math.max(m, Number(it.PurchaseOrderItem) || 0), 0);
  const start = Math.ceil((max + 1) / 10) * 10;
  return Array.from({ length: count }, (_, i) => String(start + i * 10));
}

function buildMixLockRequests(line, sap, finalSplit, note, committedQty) {
  const poNumber = sap ? sap.PurchaseOrder : line.poNumber;
  const items = sap ? sap.items : [];
  const ref = items[0] || {};
  const nums = nextItemNumbers(items, finalSplit.length);
  const delivery = dayOffset(120);
  const requests = finalSplit.map((v, i) => req('POST', `/PurchaseOrder/${poNumber}/_PurchaseOrderItem`, {
    PurchaseOrderItem: nums[i],
    PurchaseOrderItemText: `${line.name} - ${v.colour} / ${v.size}`.slice(0, 40),
    Material: ref.Material || '',
    Plant: ref.Plant || '',
    OrderQuantity: v.qty,
    PurchaseOrderQuantityUnit: ref.PurchaseOrderQuantityUnit || 'PC',
    NetPriceAmount: ref.NetPriceAmount != null ? ref.NetPriceAmount : 0,
    NetPriceQuantity: ref.NetPriceQuantity || 1,
    DocumentCurrency: sap ? sap.DocumentCurrency : undefined,
    RequirementTracking: 'MIXLOCK',
    _PurchaseOrderScheduleLineTP: [{ ScheduleLine: '1', ScheduleLineDeliveryDate: delivery, ScheduleLineOrderQuantity: v.qty }]
  }));
  requests.push(noteReq(poNumber, note || `Mix locked ${isoDate(Date.now())} - deferred mix allocation for ${line.name}; ${committedQty} units split by 3-week trial-store sell-through.`));
  return requests;
}

// ---------- Delivery Tracker ----------
const STEPS_BY_ACTION = {
  expedite:    ['Raised', 'Supplier & carrier notified', 'Air-freight split booked', 'Expedited stock received', 'Resolved'],
  reschedule:  ['Raised', 'Supplier notified', 'Delivery date updated', 'Stores & promo plan updated', 'Resolved'],
  replacement: ['Raised', 'Supplier notified', 'Supplier accepted', 'Replacement shipped', 'Resolved'],
  refund:      ['Raised', 'Supplier notified', 'Supplier accepted', 'Credit note issued', 'Resolved'],
  resource:    ['Raised', 'Alternative supplier contacted', 'Replacement order placed', 'Replacement shipped', 'Resolved'],
  cancel:      ['Raised', 'Supplier notified', 'Order line closed', 'Ranging updated', 'Resolved']
};

function laneFor(s) { return LANES[s.lane] || []; }

function pointAlong(points, frac) {
  if (!points.length) return null;
  if (frac <= 0) return points[0];
  if (frac >= 1) return points[points.length - 1];
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d); total += d;
  }
  let target = frac * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i]) {
      const t = seg[i] ? target / seg[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    target -= seg[i];
  }
  return points[points.length - 1];
}

function shipmentItem(s, sap) {
  if (!sap) return null;
  return sap.items.find(i => String(i.PurchaseOrderItem) === String(s.poItem)) || sap.items[0] || null;
}

function detectProblems(s, item) {
  const problems = [];
  const ordered = item ? item.OrderQuantity : 0;
  const unitCost = s.unitCost;
  const promised = dayOffset(s.promisedOffset);
  const eta = dayOffset(s.etaOffset);
  const launch = dayOffset(s.launchInDays);
  const sl = item && item.scheduleLines && item.scheduleLines[0];

  // 1) Delay – prefer SAP schedule line dates, else carrier feed
  let daysLate = 0, delaySource = 'Carrier feed (simulated)';
  if (sl && sl.ScheduleLineDeliveryDate && sl.SchedLineStscDeliveryDate) {
    const d = daysBetween(sl.SchedLineStscDeliveryDate, sl.ScheduleLineDeliveryDate);
    if (d > 0) { daysLate = d; delaySource = 'SAP schedule line'; }
  }
  if (!daysLate) daysLate = Math.max(0, daysBetween(promised, eta));
  if (daysLate > 0) {
    const missesLaunch = new Date(eta) > new Date(launch);
    problems.push({
      type: 'delay', source: delaySource,
      severity: daysLate > 7 || missesLaunch ? 'High' : daysLate > 3 ? 'Medium' : 'Low',
      title: `Arriving ${daysLate} days late`,
      explanation: `${s.feed.event} Expected at the DC on ${nzDate(eta)} instead of ${nzDate(promised)}.`,
      impact: {
        daysLate, units: ordered, value: Math.round(ordered * unitCost), storesAffected: s.storesAffected,
        note: missesLaunch ? `Misses the in-store launch on ${nzDate(launch)}.` : `Still lands before the in-store launch on ${nzDate(launch)}.`
      }
    });
  }
  // 2) Short delivery
  if (s.feed.receivedRatio && ordered) {
    const received = Math.round(ordered * s.feed.receivedRatio);
    const short = ordered - received;
    problems.push({
      type: 'short', source: 'DC goods receipt vs SAP order quantity',
      severity: short / ordered >= 0.1 ? 'High' : 'Medium',
      title: `Short-shipped by ${short} units`,
      explanation: `${s.feed.event} SAP ordered ${ordered} ${item.PurchaseOrderQuantityUnit || 'PC'}, the DC received ${received}.`,
      impact: { units: short, received, ordered, value: Math.round(short * unitCost), storesAffected: s.storesAffected, note: `${Math.round(short / ordered * 100)}% of the order is missing.` }
    });
  }
  // 3) Damage
  if (s.feed.damagedCartons) {
    const units = s.feed.damagedCartons * s.unitsPerCarton;
    problems.push({
      type: 'damage', source: 'DC inbound inspection (simulated)',
      severity: units * unitCost > 500 ? 'High' : 'Medium',
      title: `${s.feed.damagedCartons} cartons damaged in transit`,
      explanation: `${s.feed.event} ${units} units can't be sold.`,
      impact: { units, cartons: s.feed.damagedCartons, value: Math.round(units * unitCost), storesAffected: s.storesAffected, note: 'Damaged stock is quarantined at the DC.' }
    });
  }
  // 4) Supplier rejection / delivery block (SAP flags first)
  const rejectedInSap = item && item.ItemIsRejectedBySupplier === true;
  const blockedInSap = item && item.PurgItemIsBlockedForDelivery === true;
  if (rejectedInSap || s.feed.supplierResponse === 'rejected') {
    problems.push({
      type: 'rejected', source: rejectedInSap ? 'SAP item flag ItemIsRejectedBySupplier' : 'Supplier response (simulated)',
      severity: 'High',
      title: 'Supplier rejected the order line',
      explanation: s.feed.event,
      impact: { units: ordered, value: Math.round(ordered * unitCost), storesAffected: s.storesAffected, note: `Nothing will ship unless the order is re-sourced. Launch is on ${nzDate(launch)}.` }
    });
  }
  if (blockedInSap) {
    problems.push({
      type: 'blocked', source: 'SAP item flag PurgItemIsBlockedForDelivery', severity: 'Medium',
      title: 'Delivery blocked in SAP', explanation: 'The purchase order item is blocked for delivery in SAP.',
      impact: { units: ordered, value: Math.round(ordered * unitCost), storesAffected: s.storesAffected, note: 'Release the block before goods can be received.' }
    });
  }
  return problems;
}

function actionOptions(s, sap, item, problem) {
  if (!problem || !item) return [];
  const po = sap.PurchaseOrder;
  const it = item.PurchaseOrderItem;
  const sl = (item.scheduleLines && item.scheduleLines[0] && item.scheduleLines[0].ScheduleLine) || '1';
  const unit = item.PurchaseOrderQuantityUnit || 'PC';
  const base = {
    Material: item.Material, Plant: item.Plant, PurchaseOrderQuantityUnit: unit,
    NetPriceAmount: item.NetPriceAmount, NetPriceQuantity: item.NetPriceQuantity || 1
  };
  const [n1, n2] = nextItemNumbers(sap.items, 2);
  const opts = [];
  if (problem.type === 'delay') {
    const expDate = dayOffset(s.promisedOffset + 1);
    opts.push({
      id: 'expedite', title: 'Expedite by air freight', recommended: problem.severity === 'High',
      summary: 'Split 30% of the order onto air freight so launch stores are covered; the rest follows by sea.',
      cost: Math.round(item.OrderQuantity * 0.3 * 3.1), daysToShelf: Math.max(1, s.promisedOffset + 1), stockOutRisk: 'Low',
      requests: [req('PATCH', `/PurchaseOrderScheduleLine/${po}/${it}/${sl}`, { ScheduleLineDeliveryDate: expDate }, { 'If-Match': '<etag from GET>' })]
    });
    opts.push({
      id: 'reschedule', title: 'Accept delay and move the launch', recommended: problem.severity !== 'High',
      summary: 'Update the delivery date in SAP and push the in-store launch back to match.',
      cost: 0, daysToShelf: s.etaOffset + 3, stockOutRisk: 'Medium',
      requests: [req('PATCH', `/PurchaseOrderScheduleLine/${po}/${it}/${sl}`, { ScheduleLineDeliveryDate: dayOffset(s.etaOffset) }, { 'If-Match': '<etag from GET>' })]
    });
  }
  if (problem.type === 'short' || problem.type === 'damage') {
    const qty = problem.impact.units;
    const repDate = dayOffset(Math.max(s.etaOffset, 0) + 18);
    const returnsItem = Object.assign({ PurchaseOrderItem: n1, PurchaseOrderItemText: `RETURN ${s.product}`.slice(0, 40), OrderQuantity: qty, IsReturnsItem: true }, base);
    if (problem.type === 'damage') {
      opts.push({
        id: 'replacement', title: 'Return damaged stock for replacement', recommended: true,
        summary: `Send ${qty} damaged units back and have the supplier ship ${qty} new units.`,
        cost: 0, daysToShelf: 18, stockOutRisk: 'Medium',
        requests: [
          req('POST', `/PurchaseOrder/${po}/_PurchaseOrderItem`, returnsItem),
          req('POST', `/PurchaseOrder/${po}/_PurchaseOrderItem`, Object.assign({ PurchaseOrderItem: n2, PurchaseOrderItemText: `REPLACEMENT ${s.product}`.slice(0, 40), OrderQuantity: qty,
            _PurchaseOrderScheduleLineTP: [{ ScheduleLine: '1', ScheduleLineDeliveryDate: repDate, ScheduleLineOrderQuantity: qty }] }, base))
        ]
      });
      opts.push({
        id: 'refund', title: 'Return damaged stock for a refund', recommended: false,
        summary: `Return ${qty} units and claim a supplier credit of $${problem.impact.value}. No replacement stock.`,
        cost: -problem.impact.value, daysToShelf: null, stockOutRisk: 'High',
        requests: [req('POST', `/PurchaseOrder/${po}/_PurchaseOrderItem`, returnsItem)]
      });
    } else {
      opts.push({
        id: 'replacement', title: 'Request the missing units', recommended: true,
        summary: `Ask the supplier to ship the ${qty} missing units on the next sailing.`,
        cost: 0, daysToShelf: 18, stockOutRisk: 'Medium',
        requests: [req('POST', `/PurchaseOrder/${po}/_PurchaseOrderItem`, Object.assign({ PurchaseOrderItem: n1, PurchaseOrderItemText: `BALANCE ${s.product}`.slice(0, 40), OrderQuantity: qty,
          _PurchaseOrderScheduleLineTP: [{ ScheduleLine: '1', ScheduleLineDeliveryDate: repDate, ScheduleLineOrderQuantity: qty }] }, base))]
      });
      opts.push({
        id: 'refund', title: 'Close short and claim a credit', recommended: false,
        summary: `Reduce the order to the ${problem.impact.received} units received and claim $${problem.impact.value} back.`,
        cost: -problem.impact.value, daysToShelf: null, stockOutRisk: 'High',
        requests: [req('PATCH', `/PurchaseOrderItem/${po}/${it}`, { OrderQuantity: problem.impact.received, IsCompletelyDelivered: true }, { 'If-Match': '<etag from GET>' })]
      });
    }
  }
  if (problem.type === 'rejected' || problem.type === 'blocked') {
    opts.push({
      id: 'resource', title: 'Re-source from an approved alternative supplier', recommended: true,
      summary: 'Place the same quantity with a pre-approved backup supplier and close the rejected line.',
      cost: Math.round(item.OrderQuantity * s.unitCost * 0.08), daysToShelf: 28, stockOutRisk: 'Medium',
      requests: [
        req('PATCH', `/PurchaseOrderItem/${po}/${it}`, { IsCompletelyDelivered: true }, { 'If-Match': '<etag from GET>' }),
        req('POST', `/PurchaseOrder/${po}/_PurchaseOrderItem`, Object.assign({ PurchaseOrderItem: n1, PurchaseOrderItemText: `RESOURCED ${s.product}`.slice(0, 40), OrderQuantity: item.OrderQuantity,
          _PurchaseOrderScheduleLineTP: [{ ScheduleLine: '1', ScheduleLineDeliveryDate: dayOffset(28), ScheduleLineOrderQuantity: item.OrderQuantity }] }, base))
      ]
    });
    opts.push({
      id: 'cancel', title: 'Cancel the line and de-range', recommended: false,
      summary: 'Close the order line and remove the product from this season’s range.',
      cost: 0, daysToShelf: null, stockOutRisk: 'High',
      requests: [req('PATCH', `/PurchaseOrderItem/${po}/${it}`, { IsCompletelyDelivered: true }, { 'If-Match': '<etag from GET>' })]
    });
  }
  return opts;
}

async function buildShipment(s, { deep = false } = {}) {
  const { sap, cached, cachedAt } = await readPO(s.poNumber, { deep });
  const item = shipmentItem(s, sap);
  const cases = getCases();
  const kase = cases.find(c => c.shipmentId === s.id) || null;
  const problems = detectProblems(s, item);
  const lane = laneFor(s);
  const currentPos = pointAlong(lane, s.progress);
  const milestones = s.milestones.map(([label, planned, actual, place]) => ({
    label, planned: dayOffset(planned), actual: actual == null ? null : dayOffset(actual),
    place: place ? PLACES[place] : null, done: actual != null
  }));
  let status = 'On track';
  if (problems.length) status = problems.some(p => p.severity === 'High') ? 'Problem' : 'At risk';
  if (problems.some(p => p.type === 'delay') && status !== 'Problem') status = 'Delayed';
  if (kase) status = kase.status === 'Resolved' ? 'Resolved' : 'Recovery in progress';
  const doneCount = milestones.filter(m => m.done).length;
  return {
    id: s.id, product: s.product, category: s.category,
    poNumber: s.poNumber, poItem: item ? item.PurchaseOrderItem : s.poItem,
    supplierName: s.supplierName, supplierId: sap ? sap.Supplier : '—',
    vessel: s.vessel, container: s.container,
    origin: PLACES[s.origin], portLoad: PLACES[s.portLoad], portDischarge: PLACES[s.portDischarge], dc: PLACES[s.dc],
    lane, currentPos, progress: s.progress,
    stage: milestones[Math.max(0, doneCount - 1)] ? (doneCount ? milestones[doneCount - 1].label : 'Awaiting dispatch') : 'Awaiting dispatch',
    eta: dayOffset(s.etaOffset), promised: dayOffset(s.promisedOffset), launch: dayOffset(s.launchInDays),
    units: item ? item.OrderQuantity : 0, unit: item ? item.PurchaseOrderQuantityUnit : 'PC',
    value: item ? Math.round(item.OrderQuantity * s.unitCost) : 0,
    storesAffected: s.storesAffected,
    milestones, feedEvent: s.feed.event,
    sap: sap ? { PurchaseOrder: sap.PurchaseOrder, Supplier: sap.Supplier, PurchaseOrderDate: sap.PurchaseOrderDate, CompanyCode: sap.CompanyCode, DocumentCurrency: sap.DocumentCurrency, item } : null,
    sapHasSchedule: !!(item && item.scheduleLines),
    cached, cachedAt,
    problems, status,
    case: kase,
    _sapFull: sap
  };
}

function publicShipment(x, withOptions) {
  const out = Object.assign({}, x);
  if (withOptions) {
    const p = x.problems[0];
    out.options = actionOptions(SHIPMENTS.find(s => s.id === x.id), x._sapFull, x.sap && x.sap.item, p);
  }
  delete out._sapFull;
  return out;
}

// ---------- HTTP ----------
function sendJson(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b), 'Cache-Control': 'no-store' });
  res.end(b);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function sendFile(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('Not found'); }
}
function collectBody(req) {
  return new Promise(resolve => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => resolve(d)); });
}
async function jsonBody(req) { try { return JSON.parse(await collectBody(req) || '{}'); } catch (e) { return null; } }
function tryJson(t) { try { return JSON.parse(t); } catch (e) { return t; } }

async function lineWithSap(l, state) {
  const { sap, cached, cachedAt } = await readPO(l.poNumber);
  const lock = state.locked && state.locked[l.id];
  return Object.assign({}, l, { sap, cached, cachedAt, status: lock ? 'Mix locked' : 'G1 committed', lockedDetail: lock || null });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const parts = p.split('/').filter(Boolean).map(decodeURIComponent);

    if (p === '/api/config') {
      return sendJson(res, 200, { sapWriteMode: SAP_MODE === 'live' ? 'live' : 'simulate', sapBase: SAP_BASE, hasKey: !!SAP_KEY, sapStatus: lastSapStatus });
    }

    // ----- Mix-Lock -----
    if (p === '/api/lines' && req.method === 'GET') {
      const state = getState();
      const out = await Promise.all(LINES.map(l => lineWithSap(l, state)));
      return sendJson(res, 200, { lines: out, sapStatus: lastSapStatus });
    }
    if (parts[0] === 'api' && parts[1] === 'lines' && parts[2] && req.method === 'GET') {
      const l = LINES.find(x => x.id === parts[2]);
      if (!l) return sendJson(res, 404, { error: 'Line not found' });
      return sendJson(res, 200, await lineWithSap(l, getState()));
    }
    if (parts[0] === 'api' && parts[1] === 'po' && parts[2] && req.method === 'GET') {
      const r = await readPO(parts[2]);
      if (!r.sap) return sendJson(res, 404, { error: 'PO not available live or in cache' });
      return sendJson(res, 200, Object.assign({}, r.sap, { cached: r.cached }));
    }
    if (p === '/api/mixlock' && req.method === 'POST') {
      const j = await jsonBody(req);
      if (!j) return sendJson(res, 400, { error: 'Invalid JSON' });
      const line = LINES.find(x => x.id === j.lineId);
      if (!line) return sendJson(res, 404, { error: 'Line not found' });
      const state = getState();
      if (state.locked && state.locked[line.id]) return sendJson(res, 409, { error: 'This line is already mix-locked.' });
      const finalSplit = Array.isArray(j.finalSplit) ? j.finalSplit : [];
      const total = finalSplit.reduce((s, v) => s + (Number(v.qty) || 0), 0);
      const { sap } = await readPO(line.poNumber);
      const committed = sap ? sap.committedQuantity : Number(j.committedQty) || 0;
      if (total !== committed) return sendJson(res, 400, { error: `Split totals ${total} but committed volume is ${committed}.` });
      const requests = buildMixLockRequests(line, sap, finalSplit, j.note, committed);
      const entry = await executeWrites({
        kind: 'mixlock', refId: line.id, poNumber: sap ? sap.PurchaseOrder : line.poNumber, title: `Mix lock – ${line.name}`, requests,
        meta: { lineName: line.name, units: committed, riskBefore: j.riskBefore, riskAfter: j.riskAfter }
      });
      state.locked = state.locked || {};
      state.locked[line.id] = { writeId: entry.id, finalSplit, at: entry.createdAt, riskBefore: j.riskBefore, riskAfter: j.riskAfter };
      setState(state);
      return sendJson(res, 200, entry);
    }

    // ----- Delivery Tracker -----
    if (p === '/api/deliveries' && req.method === 'GET') {
      const list = await Promise.all(SHIPMENTS.map(s => buildShipment(s)));
      return sendJson(res, 200, { deliveries: list.map(x => publicShipment(x, false)), sapStatus: lastSapStatus });
    }
    if (parts[0] === 'api' && parts[1] === 'deliveries' && parts[2] && !parts[3] && req.method === 'GET') {
      const s = SHIPMENTS.find(x => x.id === parts[2]);
      if (!s) return sendJson(res, 404, { error: 'Shipment not found' });
      return sendJson(res, 200, publicShipment(await buildShipment(s, { deep: true }), true));
    }
    if (parts[0] === 'api' && parts[1] === 'deliveries' && parts[2] && parts[3] === 'recovery' && req.method === 'POST') {
      const s = SHIPMENTS.find(x => x.id === parts[2]);
      if (!s) return sendJson(res, 404, { error: 'Shipment not found' });
      if (getCases().find(c => c.shipmentId === s.id)) return sendJson(res, 409, { error: 'A recovery case already exists for this shipment.' });
      const j = await jsonBody(req) || {};
      const x = await buildShipment(s, { deep: true });
      const problem = x.problems[0];
      const options = actionOptions(s, x._sapFull, x.sap && x.sap.item, problem);
      const opt = options.find(o => o.id === j.actionId);
      if (!opt) return sendJson(res, 400, { error: 'Choose one of the recommended actions.' });
      const caseId = 'RC-' + (1000 + getCases().length + 1);
      const requests = opt.requests.concat([noteReq(x.poNumber,
        `Recovery ${caseId}: ${problem.title} (${problem.source}). Action: ${opt.title}.${j.comment ? ' Buyer note: ' + j.comment : ''}`)]);
      const entry = await executeWrites({
        kind: 'recovery', refId: s.id, poNumber: x.poNumber, title: `${opt.title} – ${s.product}`, requests,
        meta: { product: s.product, problem: problem.title, action: opt.title, units: problem.impact.units, value: problem.impact.value }
      });
      const steps = STEPS_BY_ACTION[opt.id];
      const now = new Date().toISOString();
      const kase = {
        id: caseId, shipmentId: s.id, product: s.product, poNumber: x.poNumber,
        problem: { type: problem.type, title: problem.title, severity: problem.severity, units: problem.impact.units, value: problem.impact.value, daysLate: problem.impact.daysLate || 0 },
        action: { id: opt.id, title: opt.title, cost: opt.cost, daysToShelf: opt.daysToShelf },
        comment: j.comment || '', owner: 'Anko Buyer – Homewares',
        steps, stepIndex: 0, status: steps[0],
        history: [{ step: steps[0], at: now }],
        writeId: entry.id, createdAt: now, resolvedAt: null,
        newEta: opt.daysToShelf != null ? dayOffset(opt.daysToShelf) : null
      };
      const cases = getCases(); cases.unshift(kase); setCases(cases);
      return sendJson(res, 200, { case: kase, write: entry });
    }
    if (parts[0] === 'api' && parts[1] === 'cases' && parts[2] && !parts[3] && req.method === 'GET') {
      const kase = getCases().find(c => c.id === parts[2]);
      if (!kase) return sendJson(res, 404, { error: 'Case not found' });
      const s = SHIPMENTS.find(x => x.id === kase.shipmentId);
      const x = publicShipment(await buildShipment(s), false);
      return sendJson(res, 200, { case: kase, shipment: x });
    }
    if (parts[0] === 'api' && parts[1] === 'cases' && parts[2] && parts[3] === 'advance' && req.method === 'POST') {
      const cases = getCases();
      const kase = cases.find(c => c.id === parts[2]);
      if (!kase) return sendJson(res, 404, { error: 'Case not found' });
      if (kase.stepIndex < kase.steps.length - 1) {
        kase.stepIndex += 1;
        kase.status = kase.steps[kase.stepIndex];
        kase.history.push({ step: kase.status, at: new Date().toISOString() });
        if (kase.status === 'Resolved') kase.resolvedAt = new Date().toISOString();
        setCases(cases);
      }
      return sendJson(res, 200, { case: kase });
    }
    if (p === '/api/cases' && req.method === 'GET') return sendJson(res, 200, { cases: getCases() });

    // ----- History / admin -----
    if (p === '/api/writes' && req.method === 'GET') return sendJson(res, 200, { writes: getStore() });
    if (parts[0] === 'api' && parts[1] === 'writes' && parts[2] && req.method === 'GET') {
      const entry = getStore().find(w => w.id === parts[2]);
      return entry ? sendJson(res, 200, entry) : sendJson(res, 404, { error: 'Not found' });
    }
    if (p === '/api/reset-state' && req.method === 'POST') {
      setState({ locked: {} }); setStore([]); setCases([]);
      return sendJson(res, 200, { ok: true });
    }
    if (await customerAssist.tryHandle(req, res, { sapBase: SAP_BASE, sapKey: SAP_KEY, sapMode: SAP_MODE, staffAccess, sendJson, jsonBody })) return;
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown API route' });

    // ----- static -----
    if (['/recovery-management', '/recovery-management/'].includes(p)) return sendFile(res, path.join(PUBLIC_DIR, 'staff', 'index.html'));
    if (['/supply-hub', '/supply-hub/', '/supply-hub/index.html'].includes(p)) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }
    const customerHome = ['/', '/index.html', '/assist', '/assist/', '/assist/index.html'].includes(p);
    const rel = customerHome ? 'assist/index.html' : p.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (filePath.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return sendFile(res, filePath);
    return sendFile(res, path.join(PUBLIC_DIR, 'assist', 'index.html'));
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    const port = server.address().port;
    console.log(`Kmart Delivery Assist running on http://localhost:${port}`);
    console.log(`Supply Hub buyer workspace: http://localhost:${port}/supply-hub`);
    console.log(`Recovery Management: http://localhost:${port}/recovery-management`);
    console.log(staffAccess.hintAvailable ? 'Staff sign-in uses the public classroom code; reveal it with the access-code hint button.' : 'Private staff access code configured; public code hint is disabled.');
    console.log(`SAP base: ${SAP_BASE}`);
    console.log(`SAP key: ${SAP_KEY ? 'set' : 'NOT set (cached SAP data will be used)'} · write mode: ${SAP_MODE}`);
  });
}

module.exports = server;
