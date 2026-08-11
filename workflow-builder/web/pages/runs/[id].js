import { useState } from 'react';
import { useRouter } from 'next/router';
import { useSubscription, useMutation } from '@apollo/client';
import { STEP_RUNS_SUB, WORKFLOW_RUN_STATUS_SUB, APPROVE_STEP } from '../../lib/graphql';

const STATUS_COLORS = {
  pending: '#94a3b8',
  running: '#2563eb',
  paused: '#d97706',
  completed: '#16a34a',
  failed: '#dc2626',
  skipped: '#94a3b8',
  pending_approval: '#d97706',
  rejected: '#dc2626',
};

function Badge({ status }) {
  return (
    <span className="badge" style={{ background: STATUS_COLORS[status] || '#64748b' }}>
      {status}
    </span>
  );
}

export default function RunView() {
  const router = useRouter();
  const { id } = router.query;
  const [error, setError] = useState(null);

  const { data: runData } = useSubscription(WORKFLOW_RUN_STATUS_SUB, { variables: { runId: id }, skip: !id });
  const { data: stepsData } = useSubscription(STEP_RUNS_SUB, { variables: { runId: id }, skip: !id });

  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP);

  async function handleApprove(stepRunId, approve) {
    setError(null);
    try {
      await approveStep({ variables: { stepRunId, approve } });
    } catch (err) {
      setError(err.message);
    }
  }

  const run = runData?.workflow_runs_by_pk;
  const stepRuns = stepsData?.step_runs ?? [];

  return (
    <div>
      <h1>Run</h1>
      {run && (
        <p>
          Status: <Badge status={run.status} /> · triggered via <strong>{run.trigger_type}</strong>
          {run.error && <span className="error"> — {run.error}</span>}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <ol className="step-list">
        {stepRuns.map((sr) => (
          <li key={sr.id}>
            <div className="row-between">
              <strong>
                {sr.workflow_step.step_order}. {sr.workflow_step.type}
              </strong>
              <div>
                <Badge status={sr.status} />
                {sr.attempt_count > 1 && <span className="muted small"> · attempt {sr.attempt_count}</span>}
              </div>
            </div>

            {sr.status === 'pending_approval' && (
              <div className="approval-box">
                <p>⏸ Paused, awaiting approval.</p>
                <button className="btn btn-primary" disabled={approving} onClick={() => handleApprove(sr.id, true)}>
                  Approve
                </button>
                <button className="btn btn-ghost" disabled={approving} onClick={() => handleApprove(sr.id, false)}>
                  Reject
                </button>
              </div>
            )}

            {sr.output && (
              <details>
                <summary>output</summary>
                <pre>{JSON.stringify(sr.output, null, 2)}</pre>
              </details>
            )}
            {sr.error && <p className="error">{sr.error}</p>}
          </li>
        ))}
        {stepRuns.length === 0 && <p className="muted">Waiting for the first step…</p>}
      </ol>
    </div>
  );
}
