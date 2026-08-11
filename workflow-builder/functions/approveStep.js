const { adminGraphQL } = require('./_lib/hasura');
const { runFrom } = require('./_lib/engine');

// Hasura Action: approveStep(step_run_id: uuid!, approve: Boolean): ApproveStepOutput
// Restricted in Hasura to role "user". This is the one authorization decision the
// assignment explicitly calls out as needing to live in application code rather than
// a database permission: clearing an approval_gate is a mid-execution decision, not a
// row read/write, so we look up the approver's org role here before resuming the run.
module.exports = async (req, res) => {
  try {
    const { input, session_variables } = req.body;
    const userId = session_variables?.['x-hasura-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated.' });
    }

    const stepRunId = input?.step_run_id;
    if (!stepRunId) {
      return res.status(400).json({ message: 'step_run_id is required.' });
    }
    const approve = input?.approve !== false; // default: approve

    const data = await adminGraphQL(
      `query ($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          workflow_step { workflow_id step_order }
          workflow_run { id workflow { id org_id } }
        }
      }`,
      { id: stepRunId }
    );
    const stepRun = data.step_runs_by_pk;
    if (!stepRun) {
      return res.status(404).json({ message: 'Step run not found.' });
    }
    if (stepRun.status !== 'pending_approval') {
      return res.status(400).json({ message: 'This step is not currently awaiting approval.' });
    }

    const orgId = stepRun.workflow_run.workflow.org_id;
    const runId = stepRun.workflow_run.id;

    // --- the step-level gating check that MUST live in code, not a DB permission ---
    const memberData = await adminGraphQL(
      `query ($orgId: uuid!, $userId: uuid!) {
        org_members(where: { org_id: { _eq: $orgId }, user_id: { _eq: $userId } }) { role }
      }`,
      { orgId, userId }
    );
    const role = memberData.org_members[0]?.role;
    if (!role || !['owner', 'editor'].includes(role)) {
      return res.status(403).json({ message: 'Only owners and editors in this organization can approve this step.' });
    }
    // ---------------------------------------------------------------------------

    const now = new Date().toISOString();

    if (!approve) {
      await adminGraphQL(
        `mutation ($id: uuid!, $userId: uuid!, $now: timestamptz!) {
          update_step_runs_by_pk(pk_columns: { id: $id }, _set: {
            status: "rejected", approved_by: $userId, approved_at: $now, finished_at: $now
          }) { id }
        }`,
        { id: stepRunId, userId, now }
      );
      await adminGraphQL(
        `mutation ($id: uuid!, $now: timestamptz!) {
          update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: {
            status: "failed", error: "Approval rejected", finished_at: $now
          }) { id }
        }`,
        { id: runId, now }
      );
      return res.status(200).json({ run_id: runId, status: 'failed' });
    }

    await adminGraphQL(
      `mutation ($id: uuid!, $userId: uuid!, $now: timestamptz!) {
        update_step_runs_by_pk(pk_columns: { id: $id }, _set: {
          status: "completed", approved_by: $userId, approved_at: $now, finished_at: $now
        }) { id }
      }`,
      { id: stepRunId, userId, now }
    );
    await adminGraphQL(
      `mutation ($id: uuid!) {
        update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "running" }) { id }
      }`,
      { id: runId }
    );

    const stepsData = await adminGraphQL(
      `query ($workflowId: uuid!) {
        workflow_steps(where: { workflow_id: { _eq: $workflowId } }, order_by: { step_order: asc }) {
          id type config step_order
        }
      }`,
      { workflowId: stepRun.workflow_step.workflow_id }
    );
    const steps = stepsData.workflow_steps;
    const approvedOrder = stepRun.workflow_step.step_order;
    const nextIndex = steps.findIndex((s) => s.step_order > approvedOrder);

    const result = await runFrom({
      workflowRunId: runId,
      orgId,
      steps,
      startIndex: nextIndex === -1 ? steps.length : nextIndex,
      previousOutput: { approved: true, step_run_id: stepRunId },
    });

    return res.status(200).json({ run_id: runId, status: result.status });
  } catch (err) {
    console.error('approveStep error:', err);
    return res.status(500).json({ message: err.message || 'Internal error' });
  }
};
