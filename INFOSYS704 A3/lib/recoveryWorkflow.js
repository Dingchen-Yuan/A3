// Human-reviewed recovery operations. Recording a reference is an attestation
// by staff, not a payment, stock reservation or externally verified carrier event.
class WorkflowError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function stage(recoveryCase) {
  return recoveryCase.operations ? recoveryCase.operations.stage : recoveryCase.status === 'closed' ? 'historical' : 'submitted';
}

function steps(recoveryCase) {
  const refund = recoveryCase.outcome === 'refund';
  return [
    'Request received', 'Service team reviewing',
    refund ? 'Refund approved — awaiting finance' : 'Request approved — awaiting fulfilment',
    refund ? 'Finance confirmation recorded' : 'Fulfilment arrangement recorded'
  ];
}

function initialize(recoveryCase) {
  recoveryCase.steps = steps(recoveryCase);
  recoveryCase.stepIndex = 0;
  recoveryCase.status = 'open';
  recoveryCase.operations = { stage: 'submitted', version: 0, audit: [] };
  return recoveryCase;
}

function allowedActions(recoveryCase) {
  if (recoveryCase.status === 'closed') return [];
  return ({ submitted: ['start_review'], reviewing: ['approve', 'reject'], approved: ['record_outcome'] })[stage(recoveryCase)] || [];
}

function canComplete(recoveryCase) {
  return Boolean(recoveryCase && recoveryCase.operations && recoveryCase.status === 'ready' &&
    ['outcome_recorded', 'rejected'].includes(stage(recoveryCase)) && recoveryCase.stepIndex === recoveryCase.steps.length - 1);
}

function text(value, label, minimum = 5, maximum = 1000) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) {
    throw new WorkflowError(`${label} must contain ${minimum}–${maximum} characters.`);
  }
  return value.trim();
}

function apply(recoveryCase, input, actor) {
  if (!actor || actor.role !== 'recovery_staff') throw new WorkflowError('Staff sign-in is required.', 401);
  const permitted = ['action', 'version', 'message', 'internalNote', 'reference', 'occurredAt', 'scheduledDate'];
  if (!input || Object.keys(input).some(key => !permitted.includes(key))) throw new WorkflowError('Only the workflow action and supporting details can be changed.');
  const version = recoveryCase.operations ? recoveryCase.operations.version : 0;
  if (!Number.isInteger(input.version) || input.version !== version) throw new WorkflowError('This case changed. Refresh it before recording another action.', 409);
  if (!allowedActions(recoveryCase).includes(input.action)) throw new WorkflowError('That action is not allowed at the current stage.', 409);
  const message = text(input.message, 'Customer update');
  const internalNote = input.internalNote ? text(input.internalNote, 'Internal note', 1) : '';
  let outcome;
  if (input.action === 'record_outcome') {
    const reference = text(input.reference, 'Finance or booking reference', 3, 80);
    if (/[<>\r\n]/.test(reference)) throw new WorkflowError('Enter a valid reference, not markup or multiple lines.');
    const occurred = typeof input.occurredAt === 'string' && new Date(input.occurredAt);
    if (!occurred || !Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now() + 300000) throw new WorkflowError('Enter a valid confirmation time that is not in the future.');
    const scheduledDate = input.scheduledDate || '';
    const schedule = new Date(scheduledDate + 'T12:00:00Z');
    if (recoveryCase.outcome !== 'refund' && (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !Number.isFinite(schedule.getTime()) || schedule.toISOString().slice(0, 10) !== scheduledDate || new Date(scheduledDate + 'T23:59:59Z') < new Date())) {
      throw new WorkflowError('Enter the arranged delivery or collection date (today or later).');
    }
    outcome = { reference, occurredAt: occurred.toISOString(), scheduledDate, message, source: 'staff_recorded', externallyVerified: false };
  }
  const now = new Date().toISOString();
  if (!recoveryCase.operations) {
    const previous = { steps: recoveryCase.steps, stepIndex: recoveryCase.stepIndex, status: recoveryCase.status };
    initialize(recoveryCase);
    recoveryCase.operations.previousProgress = previous;
  }
  const operations = recoveryCase.operations;
  const from = operations.stage;
  const to = ({ start_review: 'reviewing', approve: 'approved', reject: 'rejected', record_outcome: 'outcome_recorded' })[input.action];
  operations.stage = to;
  operations.version += 1;
  operations.customerMessage = message;
  if (outcome) operations.outcome = Object.assign({}, outcome, { recordedAt: now, recordedBy: actor.name });
  if (to === 'rejected') operations.rejectionReason = message;
  operations.audit.push({ action: input.action, from, to, at: now, actor: { id: actor.id, name: actor.name, role: actor.role }, message, internalNote, reference: outcome ? outcome.reference : null });
  recoveryCase.steps = to === 'rejected' ? ['Request received', 'Service team reviewing', 'Request declined'] : steps(recoveryCase);
  recoveryCase.stepIndex = ({ reviewing: 1, approved: 2, rejected: 2, outcome_recorded: 3 })[to];
  recoveryCase.status = ['rejected', 'outcome_recorded'].includes(to) ? 'ready' : 'open';
  recoveryCase.updatedAt = now;
  return recoveryCase;
}

function customerView(recoveryCase) {
  const view = Object.assign({}, recoveryCase);
  if (!recoveryCase.operations && recoveryCase.status !== 'closed') {
    view.steps = steps(recoveryCase); view.stepIndex = 0; view.status = 'open';
  }
  const operations = recoveryCase.operations;
  view.operations = operations ? {
    stage: operations.stage, version: operations.version, customerMessage: operations.customerMessage || '',
    rejectionReason: operations.rejectionReason || '',
    outcome: operations.outcome ? { reference: operations.outcome.reference, occurredAt: operations.outcome.occurredAt, scheduledDate: operations.outcome.scheduledDate, message: operations.outcome.message, recordedAt: operations.outcome.recordedAt, source: 'staff_recorded', externallyVerified: false } : null,
    updates: operations.audit.map(event => ({ action: event.action, at: event.at, message: event.message, source: event.actor && event.actor.role === 'customer' ? 'customer' : 'staff_recorded' }))
  } : { stage: stage(recoveryCase), version: 0, customerMessage: '', updates: [] };
  view.readyForCompletion = canComplete(recoveryCase);
  return view;
}

module.exports = { WorkflowError, stage, initialize, allowedActions, canComplete, apply, customerView };
