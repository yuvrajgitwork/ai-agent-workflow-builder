const { adminGraphQL } = require('./_lib/hasura');
const { fetchOrderedSteps, runFrom } = require('./_lib/engine');

// Hasura Cron Trigger target. Configure one Cron Trigger in the Hasura console pointing
// at this function on whatever cadence you want (e.g. every 5 minutes). On each firing,
// it starts one run for every workflow that has a trigger of type "scheduled".
//
// Simplification (documented in WRITEUP.md): the cron *cadence* lives on the Hasura Cron
// Trigger itself, not per-workflow — every "scheduled" workflow shares that one cadence.
// A production version would parse a cron expression per workflow_triggers row and
// register one Hasura Cron Trigger per workflow via the Hasura metadata API.
module.exports = async (req, res) => {
  try {
    const data = await adminGraphQL(
      `query {
        workflow_triggers(where: { type: { _eq: "scheduled" } }) {
          workflow_id
          workflow { org_id }
        }
      }`
    );

    const results = [];
    for (const trig of data.workflow_triggers) {
      try {
        const orgData = await adminGraphQL(
          `query ($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
          { id: trig.workflow.org_id }
        );
        if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_limit) {
          results.push({ workflow_id: trig.workflow_id, skipped: 'quota' });
          continue;
        }

        const runData = await adminGraphQL(
          `mutation ($workflowId: uuid!) {
            insert_workflow_runs_one(object: { workflow_id: $workflowId, status: "running", trigger_type: "scheduled" }) { id }
          }`,
          { workflowId: trig.workflow_id }
        );
        const runId = runData.insert_workflow_runs_one.id;
        const steps = await fetchOrderedSteps(trig.workflow_id);
        const result = await runFrom({
          workflowRunId: runId,
          orgId: trig.workflow.org_id,
          steps,
          startIndex: 0,
          previousOutput: {},
        });
        results.push({ workflow_id: trig.workflow_id, run_id: runId, status: result.status });
      } catch (err) {
        results.push({ workflow_id: trig.workflow_id, error: err.message });
      }
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('scheduledRunner error:', err);
    return res.status(500).json({ message: err.message });
  }
};
