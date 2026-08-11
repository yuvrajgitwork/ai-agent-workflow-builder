const { adminGraphQL } = require('./_lib/hasura');
const { fetchOrderedSteps, runFrom } = require('./_lib/engine');

// Hasura Action: triggerWorkflowRun(workflow_id: uuid!): TriggerWorkflowRunOutput
// Restricted in Hasura to role "user" (see CHECKLIST.md), so req.body.session_variables
// is always populated for a real, authenticated caller.
//
// Does, in order:
//  1. Verifies the caller is owner/editor in the workflow's org      (Layer 1 + step-level intent)
//  2. Checks the org's quota isn't exhausted
//  3. Creates the workflow_run and runs steps in order (llm_call / http_request / db_write /
//     notify / conditional_branch / approval_gate), with retries on llm_call & http_request
//  4. Updates step_runs / workflow_runs throughout so the subscription reflects it live
//  5. Increments the org's quota usage on completion
module.exports = async (req, res) => {
  try {
    const { input, session_variables } = req.body;
    const userId = session_variables?.['x-hasura-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated.' });
    }

    const workflowId = input?.workflow_id;
    if (!workflowId) {
      return res.status(400).json({ message: 'workflow_id is required.' });
    }

    const wfData = await adminGraphQL(
      `query ($id: uuid!) { workflows_by_pk(id: $id) { id org_id } }`,
      { id: workflowId }
    );
    const workflow = wfData.workflows_by_pk;
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found.' });
    }

    const memberData = await adminGraphQL(
      `query ($orgId: uuid!, $userId: uuid!) {
        org_members(where: { org_id: { _eq: $orgId }, user_id: { _eq: $userId } }) { role }
      }`,
      { orgId: workflow.org_id, userId }
    );
    const role = memberData.org_members[0]?.role;
    if (!role || !['owner', 'editor'].includes(role)) {
      return res.status(403).json({ message: 'Only owners and editors can trigger a run in this organization.' });
    }

    const orgData = await adminGraphQL(
      `query ($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
      { id: workflow.org_id }
    );
    const org = orgData.organizations_by_pk;
    if (org.quota_used >= org.quota_limit) {
      return res.status(402).json({ message: 'Organization quota exhausted for this period.' });
    }

    const runData = await adminGraphQL(
      `mutation ($workflowId: uuid!, $userId: uuid!) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflowId, status: "running", trigger_type: "manual", triggered_by: $userId
        }) { id }
      }`,
      { workflowId, userId }
    );
    const runId = runData.insert_workflow_runs_one.id;

    const steps = await fetchOrderedSteps(workflowId);
    const result = await runFrom({
      workflowRunId: runId,
      orgId: workflow.org_id,
      steps,
      startIndex: 0,
      previousOutput: input?.initial_input ?? {},
    });

    return res.status(200).json({ run_id: runId, status: result.status });
  } catch (err) {
    console.error('triggerWorkflowRun error:', err);
    return res.status(500).json({ message: err.message || 'Internal error' });
  }
};
