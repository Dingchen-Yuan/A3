// Recovery rules for Kmart Delivery Assist.
// The service-request body is the write the API pool supports
// (OP_API_SERVICE_REQUEST_SRV_0001). The billing API in the pool
// can read, reject or delete a billing document. It cannot create a refund,
// so the financial outcome is confirmed here and linked to the sales order.

const SERVICE_API = 'OP_API_SERVICE_REQUEST_SRV_0001';
const amounts = require('./customerAmounts');
const selections = require('./customerSelections');

const STEP_COPY = {
  redeliver: [
    'Request received',
    'Fulfilment team accepted the redelivery',
    'Booked for tomorrow, 5–8pm'
  ],
  collect: [
    'Request received',
    'Being held at Kmart Broadway',
    'Ready to collect from 10am tomorrow'
  ],
  refund: [
    'Request received',
    'Refund checked against the sales order',
    'Ready to send back to your original payment'
  ],
  replace: [
    'Request received',
    'Replacement allocated at the fulfilment centre',
    'Booked for tomorrow, 5–8pm'
  ]
};

const money = amounts.money;

function orderTotal(order) {
  const currency = amounts.currencyFor(order);
  return amounts.fromMinor(amounts.sumMinor(order.items, currency), currency);
}

function affectedTotal(order, problem = order.problem) {
  const currency = amounts.currencyFor(order);
  return amounts.fromMinor(selections.totalMinor(order, selections.forProblem(order, problem)), currency);
}

function refundDetail(order, amount, selected = selections.forProblem(order)) {
  const full = orderTotal(order);
  if ((selected.length && selections.isPartial(order, selected)) || (amount > 0 && amount < full)) {
    const scope = selected.length === 1 && selected[0].qty === selected[0].orderedQty ? 'That item only' : 'Only the selected items and quantities';
    return `${scope}, back to your original payment. The rest of the order stays as it is.`;
  }
  return 'Back to your original payment. This order will not be delivered.';
}

function optionsFor(order, problem) {
  if (!problem) return [];
  const currency = amounts.currencyFor(order);
  const selected = selections.forProblem(order, problem);
  if (selections.needsItemSelection(problem) && !selected.length) return [];
  const full = orderTotal(order);
  const affected = affectedTotal(order, problem);
  const itemSummary = selections.summary(selected);

  if (problem.code === 'FAILED_ATTEMPT') {
    return [
      {
        id: 'redeliver',
        title: 'Deliver again tomorrow',
        detail: 'Same address, 5–8pm. No extra charge.',
        recommended: true,
        outcome: 'redelivery',
        amount: 0
      },
      {
        id: 'collect',
        title: 'Collect from Kmart Broadway',
        detail: 'Service desk, Bay Street, from 10am tomorrow. Bring this order number.',
        recommended: false,
        outcome: 'collection',
        amount: 0
      },
      {
        id: 'refund',
        title: `Refund ${money(full, currency)}`,
        detail: refundDetail(order, full, selected),
        recommended: false,
        outcome: 'refund',
        amount: full
      }
    ];
  }

  return [
    {
      id: 'replace',
      title: 'Send a replacement',
      detail: `${itemSummary} tomorrow, 5–8pm. No extra charge.`,
      recommended: true,
      outcome: 'replacement',
      amount: 0
    },
    {
      id: 'refund',
      title: `Refund ${money(affected, currency)}`,
      detail: refundDetail(order, affected, selected),
      recommended: false,
      outcome: 'refund',
      amount: affected
    }
  ];
}

function optionById(order, problem, optionId) {
  return optionsFor(order, problem).find(option => option.id === optionId) || null;
}

function newCaseId(orderId) {
  const tail = String(orderId).replace(/\D/g, '').slice(-4);
  return `SR-${tail}${String(Date.now()).slice(-4)}`;
}

function serviceRequestBody({ recoveryCase, order, option, action }) {
  return {
    api: SERVICE_API,
    action,
    ServiceRequest: recoveryCase.id,
    ServiceRequestType: 'YDEL',
    ServiceRequestDescription: (selections.needsItemSelection({ code: recoveryCase.problemCode }) && recoveryCase.affectedItems
      ? `${option.id === 'refund' ? 'Refund' : 'Replace'} ${selections.summary(recoveryCase.affectedItems)}`
      : `${order.id}: ${option.title}`).slice(0, 40),
    SoldToParty: order.soldToParty,
    SalesOrder: order.salesOrder,
    ServiceRequestPriority: option.id === 'refund' ? '1' : '3',
    ResolutionCode: option.outcome.toUpperCase(),
    RequestedAmount: recoveryCase.amount != null ? recoveryCase.amount : option.amount,
    TransactionCurrency: recoveryCase.currency || amounts.currencyFor(order),
    ServiceRequestStatus: action === 'complete' ? 'Completed' : 'InProcess'
  };
}

function createCase({ order, problem, option }) {
  option = optionById(order, problem, option && option.id);
  if (!option) throw new selections.SelectionError('Confirm the affected items and choose a recovery option.');
  const affectedItems = selections.forProblem(order, problem);
  const affectedValueMinor = selections.totalMinor(order, affectedItems);
  const recoveryCase = {
    id: newCaseId(order.id),
    orderId: order.id,
    salesOrder: order.salesOrder,
    optionId: option.id,
    outcome: option.outcome,
    title: option.title,
    detail: option.detail,
    amount: option.amount,
    amountMinor: amounts.toMinor(option.amount, amounts.currencyFor(order)),
    currency: amounts.currencyFor(order),
    affectedItems,
    affectedValueMinor,
    affectedValue: amounts.fromMinor(affectedValueMinor, amounts.currencyFor(order)),
    selectionIsPartial: selections.isPartial(order, affectedItems),
    stepIndex: 0,
    steps: STEP_COPY[option.id],
    status: 'open',
    problemCode: problem.code,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    requests: []
  };
  recoveryCase.requests.push({
    at: recoveryCase.createdAt,
    mode: 'simulate',
    body: serviceRequestBody({ recoveryCase, order, option, action: 'create' })
  });
  return recoveryCase;
}

function advance(recoveryCase) {
  if (!recoveryCase || recoveryCase.status === 'closed' || recoveryCase.stepIndex >= recoveryCase.steps.length - 1) return recoveryCase;
  if (recoveryCase.stepIndex < recoveryCase.steps.length - 1) {
    recoveryCase.stepIndex += 1;
  }
  recoveryCase.status = recoveryCase.stepIndex >= recoveryCase.steps.length - 1 ? 'ready' : 'open';
  recoveryCase.updatedAt = new Date().toISOString();
  return recoveryCase;
}

function canComplete(recoveryCase) {
  return Boolean(recoveryCase && recoveryCase.status === 'ready' &&
    Array.isArray(recoveryCase.steps) && recoveryCase.steps.length &&
    recoveryCase.stepIndex === recoveryCase.steps.length - 1);
}

function complete(recoveryCase, order, option) {
  if (recoveryCase && recoveryCase.status === 'closed') return recoveryCase;
  if (!canComplete(recoveryCase)) {
    throw new Error('This recovery is not ready to complete. Wait for a recovery update first.');
  }
  recoveryCase.stepIndex = recoveryCase.steps.length - 1;
  recoveryCase.status = 'closed';
  recoveryCase.updatedAt = new Date().toISOString();
  recoveryCase.closedAt = recoveryCase.updatedAt;
  const body = serviceRequestBody({ recoveryCase, order, option, action: 'complete' });
  body.settlement = recoveryCase.outcome === 'refund'
    ? 'Customer refund confirmed in Delivery Assist and linked to the sales order. API_BILLING_DOCUMENT_REQUEST_SRV cannot create a refund document.'
    : 'No billing document. The sales order stays open for the replacement, redelivery or collection.';
  recoveryCase.requests.push({ at: recoveryCase.updatedAt, mode: 'simulate', body });
  return recoveryCase;
}

function outcomeCopy(recoveryCase, order) {
  const item = (order.items.find(entry => entry.damaged) || order.items[0]).name;
  const closed = recoveryCase.status === 'closed';
  if (recoveryCase.outcome === 'refund') {
    return {
      heading: closed ? `${money(recoveryCase.amount, recoveryCase.currency || amounts.currencyFor(order))} refund confirmed` : `Refund ${money(recoveryCase.amount, recoveryCase.currency || amounts.currencyFor(order))}`,
      lead: recoveryCase.detail || refundDetail(order, recoveryCase.amount),
      confirm: 'Confirm refund',
      done: 'Refund confirmed'
    };
  }
  if (recoveryCase.outcome === 'replacement') {
    const damaged = recoveryCase.problemCode === 'DAMAGED';
    const scope = recoveryCase.affectedItems ? selections.summary(recoveryCase.affectedItems) : item;
    return {
      heading: closed ? 'Replacement confirmed' : 'Replacement tomorrow, 5–8pm',
      lead: damaged
        ? `A replacement for ${scope} will go to the same address. Keep or discard the damaged units.${recoveryCase.selectionIsPartial ? ' Other items and units stay unchanged.' : ''}`
        : `A replacement for ${scope} will go to the same address. You do not need to call us.${recoveryCase.selectionIsPartial ? ' Other items and units stay unchanged.' : ''}`,
      confirm: 'Confirm replacement',
      done: 'Replacement confirmed'
    };
  }
  if (recoveryCase.outcome === 'collection') {
    return {
      heading: closed ? 'Collection confirmed' : 'Ready to collect from Kmart Broadway',
      lead: 'Service desk, Bay Street, from 10am tomorrow. Bring this order number.',
      confirm: 'Confirm collection',
      done: 'Collection confirmed'
    };
  }
  return {
    heading: closed ? 'Redelivery confirmed' : 'Redelivery tomorrow, 5–8pm',
    lead: 'Same address. No extra charge.',
    confirm: 'Confirm redelivery',
    done: 'Redelivery confirmed'
  };
}

module.exports = {
  SERVICE_API,
  STEP_COPY,
  money,
  orderTotal,
  affectedTotal,
  optionsFor,
  optionById,
  refundDetail,
  createCase,
  advance,
  canComplete,
  complete,
  outcomeCopy,
  serviceRequestBody
};
