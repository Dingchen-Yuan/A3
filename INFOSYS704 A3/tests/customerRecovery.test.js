const assert = require('assert');
const { findOrder } = require('../data/customerOrders');
const recovery = require('../lib/customerRecovery');
const { SALES_ORDER_PATH } = require('../lib/salesOrderQuery');

assert.match(SALES_ORDER_PATH, /API_SALES_ORDER_SRV/);
assert.match(SALES_ORDER_PATH, /\$top=5/);
assert.match(SALES_ORDER_PATH, /\$select=/);
assert.match(SALES_ORDER_PATH, /\$expand=to_Item/);

const delayed = findOrder('KM184866');
const delayedOptions = recovery.optionsFor(delayed, delayed.problem);
assert.deepStrictEqual(delayedOptions.map(option => option.id), ['replace', 'refund']);
assert.strictEqual(delayedOptions.find(option => option.id === 'refund').amount, 16);
assert.match(delayedOptions.find(option => option.id === 'refund').detail, /will not be delivered/);
assert.doesNotMatch(delayedOptions.find(option => option.id === 'refund').detail, /rest of the order/);

const damaged = findOrder('KM185002');
const missed = findOrder('KM184773');
const healthy = findOrder('KM184920');

assert.strictEqual(recovery.orderTotal(damaged), 30);
assert.strictEqual(recovery.affectedTotal(damaged), 18);
assert.strictEqual(recovery.affectedTotal(missed), 32);

const damagedOptions = recovery.optionsFor(damaged, damaged.problem);
assert.deepStrictEqual(damagedOptions.map(option => option.id), ['replace', 'refund']);
assert.strictEqual(damagedOptions[0].recommended, true);
assert.strictEqual(damagedOptions[1].amount, 18);
assert.match(damagedOptions[1].detail, /That item only/);
assert.match(damagedOptions[1].detail, /rest of the order/);

const missedOptions = recovery.optionsFor(missed, missed.problem);
assert.deepStrictEqual(missedOptions.map(option => option.id), ['redeliver', 'collect', 'refund']);
assert.strictEqual(missedOptions[2].amount, 32);
assert.strictEqual(recovery.optionsFor(healthy, healthy.problem).length, 0);

const option = recovery.optionById(damaged, damaged.problem, 'replace');
const created = recovery.createCase({ order: damaged, problem: damaged.problem, option });
assert.strictEqual(created.status, 'open');
assert.strictEqual(created.stepIndex, 0);
assert.strictEqual(created.requests[0].body.api, 'OP_API_SERVICE_REQUEST_SRV_0001');
assert.strictEqual(created.requests[0].body.SalesOrder, '450218');
assert.strictEqual(created.requests[0].body.ResolutionCode, 'REPLACEMENT');
assert.strictEqual(created.detail, option.detail);

const partial = recovery.outcomeCopy(
  recovery.createCase({ order: damaged, problem: damaged.problem, option: damagedOptions[1] }),
  damaged
);
assert.match(partial.lead, /rest of the order/);
const whole = recovery.outcomeCopy(
  recovery.createCase({ order: delayed, problem: delayed.problem, option: delayedOptions[1] }),
  delayed
);
assert.match(whole.lead, /will not be delivered/);
assert.doesNotMatch(whole.lead, /rest of the order/);

recovery.advance(created);
assert.strictEqual(created.status, 'open');
recovery.advance(created);
assert.strictEqual(created.status, 'ready');
recovery.advance(created);
assert.strictEqual(created.stepIndex, created.steps.length - 1);

const refund = recovery.optionById(damaged, damaged.problem, 'refund');
const refundCase = recovery.createCase({ order: damaged, problem: damaged.problem, option: refund });
recovery.complete(refundCase, damaged, refund);
assert.strictEqual(refundCase.status, 'closed');
assert.strictEqual(refundCase.requests.at(-1).body.ServiceRequestStatus, 'Completed');
assert.match(refundCase.requests.at(-1).body.settlement, /cannot create a refund/);

console.log('recovery tests passed');
