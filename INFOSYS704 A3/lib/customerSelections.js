const amounts = require('./customerAmounts');

class SelectionError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

// IDs are positions within the immutable order snapshot, not SKUs: the same
// material can occur on more than one sales-order line.
function itemId(index) { return 'line-' + (index + 1); }

function needsItemSelection(problem) {
  return Boolean(problem && ['DAMAGED', 'MISSING'].includes(problem.code));
}

function validate(order, selected) {
  if (!Array.isArray(selected) || !selected.length) {
    throw new SelectionError('Choose at least one affected item and its quantity.');
  }
  if (selected.length > order.items.length) throw new SelectionError('Choose only items from this order.');
  const currency = amounts.currencyFor(order);
  const seen = new Set();
  return selected.map(selection => {
    if (!selection || Array.isArray(selection) || typeof selection !== 'object' ||
        Object.keys(selection).some(key => !['itemId', 'qty'].includes(key))) {
      throw new SelectionError('Send only the item and affected quantity. Amounts are calculated from your order.');
    }
    const index = order.items.findIndex((_, i) => itemId(i) === selection.itemId);
    if (index < 0) throw new SelectionError('That item is not in this order.');
    if (seen.has(selection.itemId)) throw new SelectionError('Choose each affected item only once.');
    seen.add(selection.itemId);
    const item = order.items[index];
    const qty = selection.qty;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || qty > item.qty ||
        (Number.isInteger(item.qty) && !Number.isInteger(qty))) {
      throw new SelectionError(`Enter a valid affected quantity for ${item.name}, no more than ${item.qty} ordered.`);
    }
    const amountMinor = amounts.partialLineMinor(item, qty, currency);
    return {
      itemId: itemId(index), itemNumber: item.itemNumber || '', sku: item.sku || '', name: item.name,
      qty, orderedQty: item.qty, amountMinor, amount: amounts.fromMinor(amountMinor, currency)
    };
  });
}

function forProblem(order, problem = order.problem) {
  if (needsItemSelection(problem)) {
    if (problem.affectedItems != null) return validate(order, problem.affectedItems);
    // Preserve the approved damaged-box demo and older carrier-flagged cases.
    // A new missing-item report must never infer its scope from damaged flags.
    const defaults = problem.code === 'DAMAGED'
      ? order.items.flatMap((item, index) => item.damaged ? [{ itemId: itemId(index), qty: item.qty }] : [])
      : [];
    return defaults.length ? validate(order, defaults) : [];
  }
  return validate(order, order.items.map((item, index) => ({ itemId: itemId(index), qty: item.qty })));
}

function totalMinor(order, selected) {
  return amounts.sumMinor(selected.map(item => ({ lineTotalMinor: item.amountMinor })), amounts.currencyFor(order));
}

function isPartial(order, selected) {
  return selected.length !== order.items.length || selected.some(item => item.qty !== item.orderedQty);
}

function summary(selected) {
  return selected.map(item => `${item.qty} × ${item.name}`).join(', ');
}

module.exports = { SelectionError, itemId, needsItemSelection, validate, forProblem, totalMinor, isPartial, summary };
