import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useQuery, useMutation } from '@apollo/client';
import { useAuth } from '../../lib/auth';
import { GRAPHQL_URL } from '../../lib/config';
import {
  WORKFLOW_DETAIL,
  MY_ORG_MEMBERSHIPS,
  TRIGGER_WORKFLOW_RUN,
  SIMULATE_EVENT,
} from '../../lib/graphql';

function webhookCurl(workflowId, secret) {
  const body = JSON.stringify({
    query: 'mutation($w: uuid!, $s: String!) { triggerWorkflowRunWebhook(workflow_id: $w, secret: $s) { run_id status } }',
    variables: { w: workflowId, s: secret },
  });
  return `curl -X POST '${GRAPHQL_URL}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
}

export default function WorkflowDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [error, setError] = useState(null);

  const { data, loading, refetch } = useQuery(WORKFLOW_DETAIL, { variables: { id }, skip: !id, pollInterval: 4000 });
  const { data: membershipsData } = useQuery(MY_ORG_MEMBERSHIPS, { variables: { userId: user?.id }, skip: !user });

  const workflow = data?.workflows_by_pk;
  const role = membershipsData?.org_members?.find((m) => m.organization.id === workflow?.org_id)?.role;

  const [initialInput, setInitialInput] = useState(
    'URGENT: customers cannot check out, payments are failing site-wide.'
  );
  const [triggerRun, { loading: triggering }] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [simulateEvent, { loading: simulating }] = useMutation(SIMULATE_EVENT);

  async function handleRun() {
    setError(null);
    try {
      const { data } = await triggerRun({
        variables: { workflowId: id, initialInput: { text: initialInput } },
      });
      router.push(`/runs/${data.triggerWorkflowRun.run_id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSimulateEvent() {
    setError(null);
    try {
      await simulateEvent({ variables: { workflowId: id, payload: { simulated: true, at: new Date().toISOString() } } });
      setTimeout(refetch, 1500);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading || !workflow) return <div className="page-center">Loading…</div>;

  const webhookTrigger = workflow.workflow_triggers.find((t) => t.type === 'webhook');
  const eventTrigger = workflow.workflow_triggers.find((t) => t.type === 'event');

  return (
    <div>
      <h1>{workflow.name}</h1>
      <p className="muted">{workflow.description}</p>
      {error && <p className="error">{error}</p>}

      {role && role !== 'viewer' ? (
        <div className="card">
          <label>Initial input (fed into the first step as {'{{input}}'})</label>
          <textarea rows={2} value={initialInput} onChange={(e) => setInitialInput(e.target.value)} />
          <p className="muted small">
            Tip: include the word &quot;URGENT&quot; to take the true branch of the conditional_branch
            step below (and reach the approval gate); leave it out for the false branch.
          </p>
          <button className="btn btn-primary" onClick={handleRun} disabled={triggering}>
            {triggering ? 'Starting…' : '▶ Run workflow'}
          </button>
        </div>
      ) : (
        <p className="muted">Viewers cannot trigger runs.</p>
      )}

      <h2>Steps</h2>
      <ol className="step-list">
        {workflow.workflow_steps.map((s) => (
          <li key={s.id}>
            <strong>{s.type}</strong>
            <pre>{JSON.stringify(s.config, null, 2)}</pre>
          </li>
        ))}
      </ol>

      <h2>Triggers</h2>
      <ul>
        {workflow.workflow_triggers.map((t) => (
          <li key={t.id}>{t.type}</li>
        ))}
      </ul>

      {webhookTrigger && (
        <div className="card">
          <h3>Webhook trigger</h3>
          <p className="muted small">Any external system can POST this to start a run — no login required.</p>
          <pre className="curl">{webhookCurl(workflow.id, webhookTrigger.config?.secret)}</pre>
        </div>
      )}

      {eventTrigger && role && role !== 'viewer' && (
        <div className="card">
          <h3>Database-event trigger</h3>
          <p className="muted small">
            Inserting a row into <code>workflow_trigger_events</code> auto-starts a run via a Hasura
            Event Trigger. Click below to simulate that insert.
          </p>
          <button className="btn btn-secondary" onClick={handleSimulateEvent} disabled={simulating}>
            {simulating ? 'Inserting…' : 'Simulate event trigger'}
          </button>
        </div>
      )}

      <h2>Recent runs</h2>
      <ul className="run-list">
        {workflow.workflow_runs.map((r) => (
          <li key={r.id}>
            <Link href={`/runs/${r.id}`}>
              {new Date(r.started_at).toLocaleString()} — {r.status} ({r.trigger_type})
            </Link>
          </li>
        ))}
        {workflow.workflow_runs.length === 0 && <li className="muted">No runs yet.</li>}
      </ul>
    </div>
  );
}
