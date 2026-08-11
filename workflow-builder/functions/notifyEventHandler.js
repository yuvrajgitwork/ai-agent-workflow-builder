const { adminGraphQL } = require('./_lib/hasura');

// Hasura Event Trigger target, fired on INSERT into step_runs.
// This is what actually implements the "notify" step type: the engine (see
// _lib/engine.js) just marks a notify step_run complete with { queued: true }.
// This handler reacts to that row appearing and performs the real side effect
// (Slack webhook if SLACK_WEBHOOK_URL is set, otherwise a clearly-labelled log line).
// It's a no-op for any step_run that isn't a "notify" step.
module.exports = async (req, res) => {
  try {
    const newRow = req.body?.event?.data?.new;
    if (!newRow) {
      return res.status(200).json({ skipped: true, reason: 'no row in payload' });
    }

    const data = await adminGraphQL(
      `query ($id: uuid!) { workflow_steps_by_pk(id: $id) { type config } }`,
      { id: newRow.workflow_step_id }
    );
    const step = data.workflow_steps_by_pk;
    if (!step || step.type !== 'notify') {
      return res.status(200).json({ skipped: true, reason: 'not a notify step' });
    }

    const message = step.config?.message || 'Workflow notification';
    const slackUrl = process.env.SLACK_WEBHOOK_URL;

    if (slackUrl) {
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${message} (step_run ${newRow.id})` }),
      });
    } else {
      console.log(`[notify-stub] ${message} — step_run ${newRow.id}`);
    }

    return res.status(200).json({ notified: true });
  } catch (err) {
    console.error('notifyEventHandler error:', err);
    // Return 200 so Hasura doesn't retry a notification forever; the workflow run itself
    // already completed the step, this is a best-effort side channel.
    return res.status(200).json({ error: err.message });
  }
};
