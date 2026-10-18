const assert = require('node:assert/strict');
const { allOrders, findOrder } = require('../data/customerOrders');
const recovery = require('../lib/customerRecovery');
const { harness, ready } = require('./customerAssist.test');

async function run() {
  const orders = allOrders();
  assert.equal(orders.length, 10);
  assert.deepEqual(orders.slice(0, 4).map(order => order.id), ['KM185002', 'KM184773', 'KM184866', 'KM184920']);
  for (const field of ['id', 'salesOrder', 'outboundDelivery', 'freightOrder']) {
    const values = orders.map(order => order[field]).filter(Boolean);
    assert.equal(new Set(values).size, values.length, 'Duplicate ' + field);
  }
  for (const order of orders) {
    for (const field of ['customer', 'soldToParty', 'channel', 'address', 'promise', 'node', 'headline', 'summary']) assert.ok(order[field], order.id + ': ' + field);
    assert.ok(order.items.length && order.events.length, order.id);
    assert.ok(order.events.every(event => event.at && event.title && ['done', 'current', 'problem'].includes(event.state)));
    assert.equal(findOrder(' ' + order.id.toLowerCase() + ' ').id, order.id);
    assert.equal(findOrder(order.salesOrder).id, order.id);
  }
  const totals = { KM185104: 72, KM185116: 51, KM185128: 40, KM185140: 24, KM185152: 60, KM185164: 46 };
  for (const [id, expected] of Object.entries(totals)) assert.equal(recovery.orderTotal(findOrder(id)), expected, id);
  const clone = findOrder('KM185164');
  clone.items[1].qty = 99; clone.problem.affectedItems[0].qty = 99;
  assert.equal(findOrder('KM185164').items[1].qty, 2);
  assert.equal(findOrder('KM185164').problem.affectedItems[0].qty, 1);

  const app = harness();
  const cards = await app.request('/api/assist/orders', {}, 'GET');
  assert.equal(cards.status, 200); assert.equal(cards.body.orders.length, orders.length);
  for (const id of Object.keys(totals)) {
    const response = await app.request('/api/assist/orders/' + id, {}, 'GET');
    assert.equal(response.status, 200); assert.equal(response.body.source, 'demo');
    assert.equal(response.body.total, totals[id]); assert.equal(response.body.recoveryCase, null);
    const bySalesOrder = await app.request('/api/assist/orders/' + response.body.salesOrder, {}, 'GET');
    assert.equal(bySalesOrder.body.id, id);
  }
  assert.equal(app.writes, 0); assert.equal(app.calls.length, 0);
  for (const id of ['KM185104', 'KM185116', 'KM185128', 'KM185140']) {
    const response = await app.request('/api/assist/orders/' + id, {}, 'GET');
    assert.equal(response.body.problem, null); assert.deepEqual(response.body.options, []);
    assert.equal(cards.body.orders.find(order => order.id === id).tone, 'ok');
  }
  for (const [id, amount, itemId, orderedQty] of [['KM185152', 16, 'line-1', 3], ['KM185164', 8, 'line-2', 2]]) {
    const response = await app.request('/api/assist/orders/' + id, {}, 'GET');
    assert.equal(response.body.requiresItemSelection, false);
    assert.equal(response.body.options.find(option => option.id === 'refund').amount, amount);
    assert.deepEqual(response.body.affectedItems.map(item => [item.itemId, item.qty, item.orderedQty]), [[itemId, 1, orderedQty]]);
    const created = await app.request('/api/assist/orders/' + id + '/recovery', { optionId: 'refund' });
    assert.equal(created.status, 200);
    const entry = created.body.recoveryCase;
    assert.equal(entry.amount, amount); assert.equal(entry.selectionIsPartial, true);
    assert.equal(entry.operations.stage, 'submitted');
    await ready(app, entry.id);
    const done = await app.request('/api/assist/cases/' + entry.id + '/complete');
    assert.equal(done.status, 200); assert.equal(done.body.recoveryCase.status, 'closed');
    assert.equal(done.body.recoveryCase.requests.at(-1).body.RequestedAmount, amount);
  }
  // A delivered sample still supports a newly reported partial-quantity issue.
  const report = await app.request('/api/assist/orders/KM185140/problem', { code: 'DAMAGED', affectedItems: [{ itemId: 'line-1', qty: 2 }] });
  assert.equal(report.status, 200);
  assert.equal(report.body.options.find(option => option.id === 'refund').amount, 9);
  assert.equal(findOrder('KM185140').problem, null);
  assert.equal(app.calls.length, 0);
  console.log('Customer catalogue passed: ten searchable sample orders, varied statuses, exact totals and partial-quantity staff recoveries (memory-only).');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
