const assert = require('node:assert/strict');
const amounts = require('../lib/customerAmounts');
const recovery = require('../lib/customerRecovery');
const { readyCase } = require('./helpers/workflowFixture');

assert.equal(amounts.currencyCode('usd'), 'USD');
assert.equal(amounts.toMinor('1.005'), 101);
assert.equal(amounts.toMinor('2.675'), 268);
assert.equal(amounts.toMinor('-1.005'), -101);
assert.equal(amounts.toMinor('1e-2'), 1);
assert.equal(amounts.lineTotalMinor({ price: '0.35', qty: '0.1' }), 4);
assert.equal(recovery.orderTotal({ items: [{ price: 0.1, qty: 1 }, { price: 0.2, qty: 1 }] }), 0.3);

// SAP NetAmount is a line total; its quantity and derived unit price must not
// cause that amount to be multiplied or rounded a second time.
const order = {
  id: 'SAP-990001', salesOrder: '990001', soldToParty: '1001', currency: 'USD',
  items: [
    { name: 'Storage boxes', qty: 2, price: 10, lineTotalMinor: 2000, damaged: true },
    { name: 'Covers', qty: 3, price: 5.55 / 3, lineTotal: '5.55', damaged: false }
  ],
  problem: { code: 'DAMAGED' }
};
assert.equal(recovery.orderTotal(order), 25.55);
assert.equal(recovery.affectedTotal(order), 20);
assert.equal(amounts.lineTotal({ qty: 3, price: 1 / 3, lineTotal: '1.00' }), 1);
assert.equal(amounts.lineTotal({ qty: 2, price: 20, lineTotalMinor: 2000 }), 20);
const option = recovery.optionById(order, order.problem, 'refund');
assert.equal(option.amount, 20);
assert.equal(option.title, 'Refund ' + amounts.money(20, 'USD'));
assert.match(option.detail, /That item only/);
const recoveryCase = recovery.createCase({ order, problem: order.problem, option });
assert.equal(recoveryCase.amountMinor, 2000);
assert.equal(recoveryCase.currency, 'USD');
assert.equal(recoveryCase.requests[0].body.RequestedAmount, 20);
assert.equal(recoveryCase.requests[0].body.TransactionCurrency, 'USD');
readyCase(recoveryCase);
// Completion uses the amount/currency recorded when the customer chose, not a
// newly calculated option that could have changed during the recovery.
recovery.complete(recoveryCase, { ...order, currency: 'AUD' }, { ...option, amount: 99 });
assert.equal(recoveryCase.requests.at(-1).body.RequestedAmount, 20);
assert.equal(recoveryCase.requests.at(-1).body.TransactionCurrency, 'USD');
assert.equal(recovery.outcomeCopy(recoveryCase, order).heading, 'Resolution update acknowledged');
assert.equal(recoveryCase.operations.outcome.externallyVerified, false);

// ISO currencies do not all use two decimal places.
assert.equal(amounts.toMinor('995', 'JPY'), 995);
assert.equal(recovery.orderTotal({ currency: 'JPY', items: [{ qty: 2, lineTotal: '995' }] }), 995);
assert.equal(amounts.toMinor('1.2345', 'KWD'), 1235);
assert.equal(recovery.orderTotal({ currency: 'KWD', items: [{ lineTotal: '1.234' }, { lineTotal: '2.345' }] }), 3.579);
assert.equal(amounts.fromMinor(3579, 'KWD'), 3.579);

for (const value of ['', 'NaN', 'Infinity', 'not an amount', '1e101']) {
  assert.throws(() => amounts.toMinor(value), RangeError);
}
assert.throws(() => amounts.toMinor('9007199254740992'), RangeError);
assert.throws(() => amounts.lineTotalMinor({ lineTotalMinor: 1.5 }), RangeError);
assert.throws(() => amounts.fromMinor(1.5), RangeError);
assert.throws(() => amounts.toMinor('1.00', 'US$'), RangeError);
assert.throws(() => amounts.sumMinor([{ lineTotalMinor: Number.MAX_SAFE_INTEGER }, { lineTotalMinor: 1 }]), RangeError);

console.log('Customer amounts passed: quantities, partial refunds, decimal precision and currencies.');
