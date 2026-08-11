const { adminGraphQL } = require('./_lib/hasura');
const { fetchOrderedSteps, runFrom } = require('./_lib/engine');

// Hasura Event Trigger target, fired on INSERT into workflow_trigger_events.
// This is the "Database event" trigger type: an external system (or, for the demo,
// the app itself via a "simulate event" button) inserts a row into a watched table,
// and that row change auto-starts a run — no button click, no webhook call.
module.exports = async (req, res) => {
  try {
    const newRow = req.body?.event?.data?.new;
    if (!newRow) {
      return res.status(200).json({ skipped: true, reason: 'no row in payload' });
    }

    const workflowId = newRow.workflow_id;
    const data = await adminGraphQL(
      `query ($workflowId: uuid!) {
        workflow_triggers(where: { workflow_id: { _eq: $workflowId }, type: { _eq: "event" } }) { id }
        workflows_by_pk(id: $workflowId) { id org_id }
      }`,
      { workflowId }
    );

    if (!data.workflow_triggers[0] || !data.workflows_by_pk) {
      return res.status(200).json({ skipped: true, reason: 'no event trigger configured for this workflow' });
    }
    const workflow = data.workflows_by_pk;

    const orgData = await adminGraphQL(
      `query ($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
      { id: workflow.org_id }
    );
    if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_limit) {
      return res.status(200).json({ skipped: true, reason: 'quota exhausted' });
    }

    const runData = await adminGraphQL(
      `mutation ($workflowId: uuid!) {
        insert_workflow_runs_one(object: { workflow_id: $workflowId, status: "running", trigger_type: "event" }) { id }
      }`,
      { workflowId }
    );
    const runId = runData.insert_workflow_runs_one.id;

    const steps = await fetchOrderedSteps(workflowId);
    const result = await runFrom({
      workflowRunId: runId,
      orgId: workflow.org_id,
      steps,
      startIndex: 0,
      previousOutput: newRow.payload ?? {},
    });

    return res.status(200).json({ run_id: runId, status: result.status });
  } catch (err) {
    console.error('dbEventTrigger error:', err);
    return res.status(200).json({ error: err.message });
  }
};
