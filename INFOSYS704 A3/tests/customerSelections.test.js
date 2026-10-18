const assert = require('node:assert/strict');
const { findOrder } = require('../data/customerOrders');
const amounts = require('../lib/customerAmounts');
const selections = require('../lib/customerSelections');
const recovery = require('../lib/customerRecovery');

const order = findOrder('KM185002');
assert.equal(recovery.affectedTotal(order), 18); // Original carrier-flagged demo.
const missing = { code: 'MISSING', affectedItems: [{ itemId: 'line-2', qty: 1 }] };
const selected = selections.forProblem(order, missing);
assert.equal(selected.length, 1);
assert.equal(selected[0].name, 'ANKO Cushion Cover 45cm');
assert.equal(selected[0].amountMinor, 1200);
assert.equal(recovery.affectedTotal(order, missing), 12);
assert.equal(selections.isPartial(order, selected), true);
const options = recovery.optionsFor(order, missing);
assert.equal(options.find(option => option.id === 'refund').amount, 12);
assert.match(options.find(option => option.id === 'replace').detail, /1 × ANKO Cushion Cover/);
assert.doesNotMatch(options.find(option => option.id === 'replace').detail, /Storage Box/);
assert.equal(recovery.optionsFor(order, { code: 'MISSING' }).length, 0);

const replacement = recovery.createCase({ order, problem: missing, option: options[0] });
assert.equal(replacement.affectedValue, 12);
assert.equal(replacement.selectionIsPartial, true);
assert.equal(replacement.amount, 0);
assert.deepEqual(replacement.affectedItems.map(item => [item.itemId, item.qty]), [['line-2', 1]]);
assert.match(recovery.outcomeCopy(replacement, order).lead, /Cushion Cover/);
assert.doesNotMatch(recovery.outcomeCopy(replacement, order).lead, /damaged|discard/);
assert.match(recovery.outcomeCopy(replacement, order).lead, /Other items and units stay unchanged/);
missing.affectedItems[0].qty = 99;
assert.equal(replacement.affectedItems[0].qty, 1); // Snapshot, not a mutable alias.

const three = { currency: 'AUD', items: [{ name: 'Three covers', sku: 'SAME', qty: 3, lineTotalMinor: 100 }] };
assert.equal(amounts.partialLineMinor(three.items[0], 1), 33);
assert.equal(amounts.partialLineMinor(three.items[0], 2), 67);
assert.equal(amounts.partialLineMinor(three.items[0], 3), 100);
const partial = { code: 'DAMAGED', affectedItems: [{ itemId: 'line-1', qty: 2 }] };
assert.equal(recovery.affectedTotal(three, partial), 0.67);
assert.equal(selections.forProblem(three, partial)[0].orderedQty, 3);
assert.match(recovery.optionsFor(three, partial)[1].detail, /selected items and quantities/);
for (const [currency, minor] of [['JPY', 100], ['KWD', 1000]]) {
  const item = { name: 'Pack', qty: 3, lineTotalMinor: minor };
  assert.equal(amounts.partialLineMinor(item, 2, currency), currency === 'JPY' ? 67 : 667);
  assert.equal(amounts.partialLineMinor(item, 3, currency), minor);
}
const fractional = { items: [{ name: 'Bulk item', qty: 1.5, lineTotalMinor: 3000 }] };
assert.equal(selections.validate(fractional, [{ itemId: 'line-1', qty: 0.5 }])[0].amountMinor, 1000);

const duplicateSku = { items: [{ name: 'First pack', sku: 'SAME', qty: 2, price: 4 }, { name: 'Second pack', sku: 'SAME', qty: 2, price: 8 }] };
assert.equal(selections.validate(duplicateSku, [{ itemId: 'line-2', qty: 1 }])[0].amount, 8);

for (const invalid of [
  undefined, null, [], {},
  [{ itemId: 'NOT-IN-ORDER', qty: 1 }],
  [{ itemId: 'line-1', qty: 1 }, { itemId: 'line-1', qty: 1 }],
  ...[0, -1, 4, 0.5, NaN, Infinity, '1', null].map(qty => [{ itemId: 'line-1', qty }]),
  [{ itemId: 'line-1', qty: 1, price: 999 }],
  [null], [[]]
]) {
  assert.throws(() => selections.validate(three, invalid), selections.SelectionError);
}
assert.throws(() => amounts.partialLineMinor(three.items[0], 4), RangeError);

// A free partial item is still a partial recovery, not cancellation of the
// remaining paid order. Zero currency values must not determine the scope.
const free = { id: 'FREE', salesOrder: '1', items: [{ name: 'Gift', qty: 2, price: 0 }, { name: 'Paid item', qty: 1, price: 3 }] };
const freeProblem = { code: 'MISSING', affectedItems: [{ itemId: 'line-1', qty: 1 }] };
const freeOption = recovery.optionsFor(free, freeProblem).find(option => option.id === 'refund');
assert.equal(freeOption.amount, 0);
assert.match(freeOption.detail, /rest of the order stays/);
assert.doesNotMatch(freeOption.detail, /will not be delivered/);
const freeCase = recovery.createCase({ order: free, problem: freeProblem, option: freeOption });
recovery.advance(freeCase); recovery.advance(freeCase);
recovery.complete(freeCase, free, freeOption);
assert.match(freeCase.requests.at(-1).body.settlement, /refund confirmed/);

console.log('Item selections passed: partial quantities, exact proportions, duplicate SKUs, validation and frozen scope.');
