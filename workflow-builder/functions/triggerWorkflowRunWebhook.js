const { adminGraphQL } = require('./_lib/hasura');
const { fetchOrderedSteps, runFrom } = require('./_lib/engine');

// Hasura Action: triggerWorkflowRunWebhook(workflow_id: uuid!, secret: String!, payload: json)
// Restricted in Hasura to role "public" (no user JWT required) — this is the "Webhook" trigger
// type: an inbound endpoint external systems call directly. It authorizes the CALL itself via a
// per-workflow secret stored on the workflow_triggers row, instead of an org-role check, since
// the caller here is not an Nhost user at all.
module.exports = async (req, res) => {
  try {
    const { input } = req.body;
    const workflowId = input?.workflow_id;
    const secret = input?.secret;

    if (!workflowId || !secret) {
      return res.status(400).json({ message: 'workflow_id and secret are required.' });
    }

    const data = await adminGraphQL(
      `query ($workflowId: uuid!) {
        workflow_triggers(where: { workflow_id: { _eq: $workflowId }, type: { _eq: "webhook" } }) {
          id
          config
        }
        workflows_by_pk(id: $workflowId) { id org_id }
      }`,
      { workflowId }
    );

    const trigger = data.workflow_triggers[0];
    const workflow = data.workflows_by_pk;
    if (!trigger || !workflow) {
      return res.status(404).json({ message: 'No webhook trigger is configured for this workflow.' });
    }
    if (!trigger.config?.secret || trigger.config.secret !== secret) {
      return res.status(403).json({ message: 'Invalid webhook secret.' });
    }

    const orgData = await adminGraphQL(
      `query ($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
      { id: workflow.org_id }
    );
    if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_limit) {
      return res.status(402).json({ message: 'Organization quota exhausted for this period.' });
    }

    const runData = await adminGraphQL(
      `mutation ($workflowId: uuid!) {
        insert_workflow_runs_one(object: { workflow_id: $workflowId, status: "running", trigger_type: "webhook" }) { id }
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
      previousOutput: input?.payload ?? {},
    });

    return res.status(200).json({ run_id: runId, status: result.status });
  } catch (err) {
    console.error('triggerWorkflowRunWebhook error:', err);
    return res.status(500).json({ message: err.message || 'Internal error' });
  }
};
