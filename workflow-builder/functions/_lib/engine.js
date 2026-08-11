const { adminGraphQL } = require('./hasura');
const { callLLM } = require('./llm');
const { callHttp } = require('./http');
const { sleep, nowIso, evaluateCondition } = require('./util');

const MAX_ATTEMPTS = 3; // 1 initial attempt + 2 retries, for llm_call / http_request

// ---- small data helpers -------------------------------------------------

async function fetchOrderedSteps(workflowId) {
  const data = await adminGraphQL(
    `query ($workflowId: uuid!) {
      workflow_steps(where: { workflow_id: { _eq: $workflowId } }, order_by: { step_order: asc }) {
        id
        type
        config
        step_order
      }
    }`,
    { workflowId }
  );
  return data.workflow_steps;
}

async function createStepRun({ workflowRunId, stepId, input }) {
  const data = await adminGraphQL(
    `mutation ($runId: uuid!, $stepId: uuid!, $input: jsonb) {
      insert_step_runs_one(object: {
        workflow_run_id: $runId,
        workflow_step_id: $stepId,
        status: "running",
        input: $input,
        started_at: "${nowIso()}"
      }) { id }
    }`,
    { runId: workflowRunId, stepId, input: input ?? null }
  );
  return data.insert_step_runs_one.id;
}

async function markStepSkipped(workflowRunId, stepId) {
  await adminGraphQL(
    `mutation ($runId: uuid!, $stepId: uuid!) {
      insert_step_runs_one(object: {
        workflow_run_id: $runId,
        workflow_step_id: $stepId,
        status: "skipped",
        started_at: "${nowIso()}",
        finished_at: "${nowIso()}"
      }) { id }
    }`,
    { runId: workflowRunId, stepId }
  );
}

async function updateStepRun(id, patch) {
  const sets = [];
  const vars = { id };
  const typeMap = {
    status: 'String',
    output: 'jsonb',
    error: 'String',
    attempt_count: 'Int',
    finished_at: 'timestamptz',
    started_at: 'timestamptz',
  };
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key}: $${key}`);
    vars[key] = value;
  }
  const varDefs = Object.keys(patch)
    .map((k) => `$${k}: ${typeMap[k] || 'String'}`)
    .join(', ');

  await adminGraphQL(
    `mutation ($id: uuid!, ${varDefs}) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: { ${sets.join(', ')} }) { id }
    }`,
    vars
  );
}

async function updateWorkflowRun(id, patch) {
  const typeMap = { status: 'String', error: 'String', finished_at: 'timestamptz' };
  const sets = Object.keys(patch).map((k) => `${k}: $${k}`);
  const varDefs = Object.keys(patch)
    .map((k) => `$${k}: ${typeMap[k] || 'String'}`)
    .join(', ');
  await adminGraphQL(
    `mutation ($id: uuid!, ${varDefs}) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { ${sets.join(', ')} }) { id }
    }`,
    { id, ...patch }
  );
}

async function insertWorkflowOutput({ workflowRunId, stepRunId, data }) {
  await adminGraphQL(
    `mutation ($runId: uuid!, $stepRunId: uuid!, $data: jsonb) {
      insert_workflow_outputs_one(object: {
        workflow_run_id: $runId, step_run_id: $stepRunId, data: $data
      }) { id }
    }`,
    { runId: workflowRunId, stepRunId, data: data ?? null }
  );
}

async function incrementOrgQuota(orgId, by = 1) {
  await adminGraphQL(
    `mutation ($orgId: uuid!, $by: Int!) {
      update_organizations_by_pk(pk_columns: { id: $orgId }, _inc: { quota_used: $by }) { id }
    }`,
    { orgId, by }
  );
}

// ---- retry wrapper --------------------------------------------------------

async function withRetry(stepRunId, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await updateStepRun(stepRunId, { attempt_count: attempt, status: 'running' });
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(400 * attempt); // simple linear backoff
      }
    }
  }
  throw lastErr;
}

// ---- the engine -------------------------------------------------------

// Executes workflow steps starting at `startIndex`, mutating step_runs / workflow_runs
// as it goes so the live subscription reflects progress. Stops (and returns 'paused')
// when it hits an approval_gate; a later call to approveStep resumes from the next step.
async function runFrom({ workflowRunId, orgId, steps, startIndex, previousOutput }) {
  let output = previousOutput;
  let i = startIndex;

  while (i < steps.length) {
    const step = steps[i];
    const stepRunId = await createStepRun({ workflowRunId, stepId: step.id, input: output ?? null });

    try {
      if (step.type === 'llm_call') {
        output = await withRetry(stepRunId, () => callLLM(step.config, output));
      } else if (step.type === 'http_request') {
        output = await withRetry(stepRunId, () => callHttp(step.config, output));
      } else if (step.type === 'db_write') {
        await insertWorkflowOutput({ workflowRunId, stepRunId, data: output ?? null });
        output = { saved: true, previous: output ?? null };
      } else if (step.type === 'notify') {
        // The actual send happens asynchronously via a Hasura Event Trigger on
        // step_runs INSERT (see functions/notifyEventHandler.js) — this step just
        // records intent so the trigger has something to react to.
        output = { queued: true, message: step.config?.message ?? null, previous: output ?? null };
      } else if (step.type === 'conditional_branch') {
        const result = evaluateCondition(step.config, output);
        output = { branch: result, previous: output ?? null };
        if (!result) {
          const skip = Number(step.config?.skip_if_false ?? 1);
          for (let s = 0; s < skip && i + 1 < steps.length; s++) {
            i++;
            await markStepSkipped(workflowRunId, steps[i].id);
          }
        }
      } else if (step.type === 'approval_gate') {
        await updateStepRun(stepRunId, { status: 'pending_approval' });
        await updateWorkflowRun(workflowRunId, { status: 'paused' });
        return { status: 'paused', pausedStepRunId: stepRunId };
      } else {
        throw new Error(`Unknown step type: ${step.type}`);
      }

      await updateStepRun(stepRunId, { status: 'completed', output: output ?? null, finished_at: nowIso() });
    } catch (err) {
      const message = String(err?.message || err);
      await updateStepRun(stepRunId, { status: 'failed', error: message, finished_at: nowIso() });
      await updateWorkflowRun(workflowRunId, { status: 'failed', error: message, finished_at: nowIso() });
      return { status: 'failed', error: message };
    }

    i++;
  }

  await updateWorkflowRun(workflowRunId, { status: 'completed', finished_at: nowIso() });
  await incrementOrgQuota(orgId, 1);
  return { status: 'completed' };
}

module.exports = {
  fetchOrderedSteps,
  runFrom,
  updateStepRun,
  updateWorkflowRun,
};
