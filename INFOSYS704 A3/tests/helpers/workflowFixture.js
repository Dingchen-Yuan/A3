const workflow = require('../../lib/recoveryWorkflow');
const actor = { id: 'test-staff', name: 'Test recovery reviewer', role: 'recovery_staff' };
function readyCase(recoveryCase) {
  for (const action of ['start_review', 'approve', 'record_outcome']) {
    if (!workflow.allowedActions(recoveryCase).includes(action)) continue;
    const input = { action, version: recoveryCase.operations ? recoveryCase.operations.version : 0, message: 'Test fixture staff update.' };
    if (action === 'record_outcome') {
      input.reference = 'TEST-' + recoveryCase.id;
      input.occurredAt = new Date().toISOString();
      if (recoveryCase.outcome !== 'refund') input.scheduledDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    }
    workflow.apply(recoveryCase, input, actor);
  }
  return recoveryCase;
}
module.exports = { readyCase };
