// Recovery rules for Kmart Delivery Assist.
// The service-request body is the write the API pool supports
// (OP_API_SERVICE_REQUEST_SRV_0001). The billing API in the pool
// can read, reject or delete a billing document. It cannot create a refund,
// so the financial outcome is confirmed here and linked to the sales order.

const SERVICE_API = 'OP_API_SERVICE_REQUEST_SRV_0001';
const amounts = require('./customerAmounts');
const selections = require('./customerSelections');
const workflow = require('./recoveryWorkflow');
const crypto = require('node:crypto');

const STEP_COPY = {
  redeliver: [
    'Request received',
    'Service team reviewing', 'Request approved — awaiting fulfilment', 'Fulfilment arrangement recorded'
  ],
  collect: [
    'Request received',
    'Service team reviewing', 'Request approved — awaiting fulfilment', 'Fulfilment arrangement recorded'
  ],
  refund: [
    'Request received',
    'Service team reviewing', 'Refund approved — awaiting finance', 'Finance confirmation recorded'
  ],
  replace: [
    'Request received',
    'Service team reviewing', 'Request approved — awaiting fulfilment', 'Fulfilment arrangement recorded'
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
  return 'Request a refund to your original payment instead of a replacement. Staff will review and confirm the outcome.';
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
        title: 'Request another delivery attempt',
        detail: 'Same address. The team will confirm the available date. No extra charge.',
        recommended: true,
        outcome: 'redelivery',
        amount: 0
      },
      {
        id: 'collect',
        title: 'Request collection from a Kmart store',
        detail: 'The team will confirm a suitable collection location and date.',
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
      detail: `${itemSummary}. The team will review stock and confirm the arrangements. No extra charge.`,
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
  return 'SR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
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
  workflow.initialize(recoveryCase);
  return recoveryCase;
}

function canComplete(recoveryCase) {
  return workflow.canComplete(recoveryCase);
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
  recoveryCase.customerAcknowledgedAt = recoveryCase.updatedAt;
  recoveryCase.operations.audit.push({ action: 'customer_acknowledged', at: recoveryCase.updatedAt, actor: { role: 'customer' }, message: workflow.stage(recoveryCase) === 'rejected' ? 'Customer acknowledged the decision.' : 'Customer acknowledged the recorded resolution.' });
  if (workflow.stage(recoveryCase) === 'rejected') return recoveryCase;
  const body = serviceRequestBody({ recoveryCase, order, option, action: 'complete' });
  body.settlement = recoveryCase.outcome === 'refund'
    ? 'Customer acknowledged a staff-recorded refund confirmation. This application does not process payments or independently verify settlement. API_BILLING_DOCUMENT_REQUEST_SRV cannot create a refund document.'
    : 'Customer acknowledged the staff-recorded fulfilment arrangement. No inventory reservation or carrier booking is performed by this application.';
  recoveryCase.requests.push({ at: recoveryCase.updatedAt, mode: 'simulate', body });
  return recoveryCase;
}

function outcomeCopy(recoveryCase, order) {
  const closed = recoveryCase.status === 'closed';
  const operations = recoveryCase.operations;
  if (operations && operations.stage === 'rejected') {
    return { heading: closed ? 'Decision acknowledged' : 'Recovery request declined', lead: operations.rejectionReason, confirm: 'Acknowledge decision', done: 'Decision acknowledged' };
  }
  if (operations && operations.outcome) {
    const recorded = operations.outcome;
    const heading = recoveryCase.outcome === 'refund' ? `${money(recoveryCase.amount, recoveryCase.currency || amounts.currencyFor(order))} refund confirmation recorded` : 'Fulfilment arrangement recorded';
    return {
      heading: closed ? 'Resolution update acknowledged' : heading,
      lead: `${recorded.message}${recoveryCase.affectedItems ? ' Items: ' + selections.summary(recoveryCase.affectedItems) + '.' : ''} Reference: ${recorded.reference}.${recorded.scheduledDate ? ' Arranged date: ' + recorded.scheduledDate + '.' : ''}${recoveryCase.selectionIsPartial ? ' Other items and units stay unchanged.' : ''} This update was recorded by staff and has not been independently verified with the bank or carrier.`,
      confirm: 'Acknowledge this resolution', done: 'Resolution update acknowledged'
    };
  }
  if (closed) return { heading: 'Previous resolution recorded', lead: recoveryCase.detail || 'This is a historical saved case.', confirm: 'View recorded resolution', done: 'Previous resolution recorded' };
  return { heading: 'Awaiting staff review or confirmation', lead: 'The responsible team will review the request and record the outcome here.', confirm: 'Awaiting staff confirmation', done: 'Update pending' };
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
  canComplete,
  complete,
  outcomeCopy,
  serviceRequestBody
};
