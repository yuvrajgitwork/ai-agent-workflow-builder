import { useState } from 'react';
import { useRouter } from 'next/router';
import { useApolloClient } from '@apollo/client';
import { useAuth } from '../../lib/auth';
import { CREATE_WORKFLOW, ADD_STEP, ADD_TRIGGER } from '../../lib/graphql';

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];

const DEFAULT_CONFIG = {
  llm_call: { prompt: 'Classify this support ticket as URGENT or NORMAL:\n\n{{input}}' },
  http_request: { url: 'https://jsonplaceholder.typicode.com/posts', method: 'GET' },
  db_write: {},
  notify: { message: 'A workflow step needs attention.' },
  conditional_branch: { field: 'text', operator: 'contains', value: 'URGENT', skip_if_false: 1 },
  approval_gate: {},
};

function newStep(type) {
  return { type, configText: JSON.stringify(DEFAULT_CONFIG[type], null, 2) };
}

function randomSecret() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export default function NewWorkflow() {
  const router = useRouter();
  const { user } = useAuth();
  const client = useApolloClient();
  const orgId = router.query.org;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState([newStep('llm_call')]);
  const [addWebhook, setAddWebhook] = useState(false);
  const [addEvent, setAddEvent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function updateStep(i, patch) {
    setSteps((s) => s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)));
  }
  function addStep() {
    setSteps((s) => [...s, newStep('http_request')]);
  }
  function removeStep(i) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }
  function moveStep(i, dir) {
    setSteps((s) => {
      const arr = [...s];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let parsedConfigs;
      try {
        parsedConfigs = steps.map((s) => JSON.parse(s.configText || '{}'));
      } catch (err) {
        throw new Error(`One of the step configs isn't valid JSON: ${err.message}`);
      }

      const { data } = await client.mutate({
        mutation: CREATE_WORKFLOW,
        variables: { orgId, name, description, createdBy: user.id },
      });
      const workflowId = data.insert_workflows_one.id;

      for (let i = 0; i < steps.length; i++) {
        await client.mutate({
          mutation: ADD_STEP,
          variables: { workflowId, stepOrder: i + 1, type: steps[i].type, config: parsedConfigs[i] },
        });
      }

      await client.mutate({
        mutation: ADD_TRIGGER,
        variables: { workflowId, type: 'manual', config: {} },
      });
      if (addWebhook) {
        await client.mutate({
          mutation: ADD_TRIGGER,
          variables: { workflowId, type: 'webhook', config: { secret: randomSecret() } },
        });
      }
      if (addEvent) {
        await client.mutate({
          mutation: ADD_TRIGGER,
          variables: { workflowId, type: 'event', config: { watch_table: 'workflow_trigger_events' } },
        });
      }

      router.push(`/workflows/${workflowId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>New workflow</h1>
      <form onSubmit={handleSubmit}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />

        <h3>Steps</h3>
        {steps.map((step, i) => (
          <div className="card step-card" key={i}>
            <div className="row-between">
              <select value={step.type} onChange={(e) => updateStep(i, { type: e.target.value, configText: JSON.stringify(DEFAULT_CONFIG[e.target.value], null, 2) })}>
                {STEP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => moveStep(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => moveStep(i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => removeStep(i)}>
                  ✕
                </button>
              </div>
            </div>
            <textarea
              rows={5}
              value={step.configText}
              onChange={(e) => updateStep(i, { configText: e.target.value })}
            />
            {step.type === 'db_write' && (
              <p className="muted small">db_write and notify steps require the owner role.</p>
            )}
            {step.type === 'notify' && (
              <p className="muted small">db_write and notify steps require the owner role.</p>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-secondary" onClick={addStep}>
          + Add step
        </button>

        <h3>Extra triggers</h3>
        <p className="muted small">A manual trigger is always added. A webhook trigger requires the owner role.</p>
        <label className="checkbox-label">
          <input type="checkbox" checked={addWebhook} onChange={(e) => setAddWebhook(e.target.checked)} />
          Also add a webhook trigger (generates a secret)
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={addEvent} onChange={(e) => setAddEvent(e.target.checked)} />
          Also add a database-event trigger
        </label>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !orgId}>
          {busy ? 'Creating…' : 'Create workflow'}
        </button>
      </form>
    </div>
  );
}
