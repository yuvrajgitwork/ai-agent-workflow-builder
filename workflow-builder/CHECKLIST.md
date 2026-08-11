# CHECKLIST — from zero to a passing Final Task demo

This is the exact, ordered path. Nothing here is optional unless marked "(optional)".
Total console work is roughly 45–75 minutes the first time.

---

## 0. Accounts you need

- An Nhost account (nhost.io) — free tier is fine.
- (Optional, recommended) A free Groq API key at console.groq.com, for real `llm_call`
  steps. Without it, `llm_call` uses a disclosed stub (an 800ms delay + an echoed
  response) — the assignment explicitly allows this.
- (Optional) A Slack incoming webhook URL, for real `notify` sends. Without it, notify
  just logs to the function's console output.
- A Vercel account (or similar), for hosting the Next.js app.

---

## 1. Create the Nhost project

1. nhost.io → New Project → pick any name/region.
2. Once provisioned, open **Settings → General** (or the project overview page) and copy
   down these exact values — do not guess the URL pattern yourself:
   - GraphQL endpoint URL
   - Auth endpoint URL
   - Admin Secret
   - Subdomain + Region (needed for the Functions URL later)

## 2. Auth settings

Console → **Auth → Settings**:

- Make sure email/password sign-up is enabled (default).
- Turn **off** "require email verification" (naming may vary slightly by dashboard
  version) so the demo accounts can sign in immediately. The seed script also force-verifies
  demo accounts via an admin mutation as a backstop.

## 3. Run the schema migration

Console → **Data → SQL** (or `psql` if you prefer):

1. Paste the entire contents of `nhost/migrations/001_init.sql` and run it.
2. This creates 9 tables + 1 view (`org_stats`) in the `public` schema.

## 4. Track tables

Console → **Data → public schema**:

1. Click **Track All** for tables (tracks all 9 tables).
2. `org_stats` is a view — it may show up in a separate "Untracked" list below; click
   **Track** on it too.

## 5. Relationships

Console → **Data**, for each table individually → **Relationships tab → Track All**
(this auto-detects both directions of every foreign key).

Then open each table again and **rename** relationships so the names exactly match the
list below (the code — both the frontend and the Action handlers — depends on these
exact names):

| Table | Relationship name | Type | Points to |
|---|---|---|---|
| `org_members` | `organization` | object | `organizations` via `org_id` |
| `organizations` | `org_members` | array | `org_members` via `org_id` |
| `workflows` | `organization` | object | `organizations` via `org_id` |
| `workflows` | `workflow_steps` | array | `workflow_steps` via `workflow_id` |
| `workflows` | `workflow_triggers` | array | `workflow_triggers` via `workflow_id` |
| `workflows` | `workflow_runs` | array | `workflow_runs` via `workflow_id` |
| `workflow_steps` | `workflow` | object | `workflows` via `workflow_id` |
| `workflow_triggers` | `workflow` | object | `workflows` via `workflow_id` |
| `workflow_runs` | `workflow` | object | `workflows` via `workflow_id` |
| `step_runs` | `workflow_run` | object | `workflow_runs` via `workflow_run_id` |
| `step_runs` | `workflow_step` | object | `workflow_steps` via `workflow_step_id` |
| `workflow_outputs` | `workflow_run` | object | `workflow_runs` via `workflow_run_id` |
| `workflow_trigger_events` | `workflow` | object | `workflows` via `workflow_id` |

Then add these two **manually** (views have no FK for Hasura to auto-detect — use
"Configure row-level relationship" / manual relationship on each table):

| Table | Relationship name | Type | Manual mapping |
|---|---|---|---|
| `organizations` | `org_stats` | object | `organizations.id` = `org_stats.org_id` |
| `org_stats` | `organization` | object | `org_stats.org_id` = `organizations.id` |

## 6. Permissions — role `user`

For every rule below: Console → table → **Permissions tab → role `user`**. Use "Without
any checks" as the base, then build the condition tree shown (it's all relationship
traversal + `_and`/`_or` — the console's condition builder supports nesting into a
relationship as a field). If your console version has a raw-JSON / text toggle for the
condition box, you can paste the JSON directly.

`X-Hasura-User-Id` below means: pick the session variable of that name in the condition
builder (don't type it as a literal string).

**organizations** — select only
```
filter: { org_members: { user_id: { _eq: X-Hasura-User-Id } } }
```

**org_members** — select only
```
filter: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } }
```
(No insert/update/delete for role `user` in this MVP — membership is managed via the
seed script / admin secret. See WRITEUP.md for why.)

**workflows**
```
select filter: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } }

insert check: { organization: { org_members: { _and: [
  { user_id: { _eq: X-Hasura-User-Id } },
  { role: { _in: ["owner", "editor"] } }
] } } }
  insertable columns: org_id, name, description, created_by

update: same check as insert, same columns updatable: name, description

delete check: { organization: { org_members: { _and: [
  { user_id: { _eq: X-Hasura-User-Id } },
  { role: { _eq: "owner" } }
] } } }
```

**workflow_steps** — this is Layer 2 (step-level gating): `db_write` and `notify` steps
require `owner`; everything else only requires `owner`/`editor`.
```
select filter: { workflow: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } } }

insert/update/delete check:
{ _or: [
  { _and: [
    { type: { _nin: ["db_write", "notify"] } },
    { workflow: { organization: { org_members: { _and: [
      { user_id: { _eq: X-Hasura-User-Id } }, { role: { _in: ["owner","editor"] } }
    ] } } } }
  ] },
  { _and: [
    { type: { _in: ["db_write", "notify"] } },
    { workflow: { organization: { org_members: { _and: [
      { user_id: { _eq: X-Hasura-User-Id } }, { role: { _eq: "owner" } }
    ] } } } }
  ] }
] }
  insertable columns: workflow_id, step_order, type, config
```

**workflow_triggers** — same pattern, `webhook` requires `owner`.
```
select filter: { workflow: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } } }

insert/update/delete check:
{ _or: [
  { _and: [
    { type: { _neq: "webhook" } },
    { workflow: { organization: { org_members: { _and: [
      { user_id: { _eq: X-Hasura-User-Id } }, { role: { _in: ["owner","editor"] } }
    ] } } } }
  ] },
  { _and: [
    { type: { _eq: "webhook" } },
    { workflow: { organization: { org_members: { _and: [
      { user_id: { _eq: X-Hasura-User-Id } }, { role: { _eq: "owner" } }
    ] } } } }
  ] }
] }
  insertable columns: workflow_id, type, config
```

**workflow_runs** — select only
```
filter: { workflow: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } } }
```
No insert/update/delete for role `user` — runs are only ever created/mutated by the
Action handlers (using the admin secret), which is what lets those handlers be the
single point where trigger permission + quota are enforced.

**step_runs** — select only (this is what the live subscription reads)
```
filter: { workflow_run: { workflow: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } } } }
```
No insert/update/delete for role `user`.

**workflow_outputs** — select only
```
filter: { workflow_run: { workflow: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } } } }
```

**workflow_trigger_events**
```
select filter: { workflow: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } } }

insert check: { workflow: { organization: { org_members: { _and: [
  { user_id: { _eq: X-Hasura-User-Id } }, { role: { _in: ["owner","editor"] } }
] } } } }
  insertable columns: workflow_id, payload
```

**org_stats** — select only
```
filter: { organization: { org_members: { user_id: { _eq: X-Hasura-User-Id } } } }
```

## 7. Deploy the functions

The `functions/` folder is a set of plain Node handlers (Nhost Serverless Functions —
each file automatically becomes an HTTP endpoint, no extra config needed).

- If your Nhost project is connected to this GitHub repo: just push; Nhost builds
  functions automatically.
- Otherwise: `nhost functions deploy` via the Nhost CLI, or check the Functions tab in
  the dashboard for a manual deploy option.

Once deployed, open **Functions** in the dashboard and copy the exact URL for each of:
`triggerWorkflowRun`, `approveStep`, `triggerWorkflowRunWebhook`, `notifyEventHandler`,
`dbEventTrigger`, `scheduledRunner` (optional). You'll paste these into Actions/Event
Triggers/Cron Triggers next.

### Function environment variables

Console → **Settings → Environment Variables**:

- `NHOST_GRAPHQL_URL` — the GraphQL URL from step 1 (set this explicitly; don't assume
  it's auto-injected).
- `NHOST_ADMIN_SECRET` — Nhost auto-injects this into functions. If a function logs
  "NHOST_ADMIN_SECRET is not set", add it manually here with the Admin Secret from step 1.
- `GROQ_API_KEY` — (optional) enables real `llm_call` steps.
- `SLACK_WEBHOOK_URL` — (optional) enables real `notify` sends.

## 8. Create the Hasura Actions

Console → **Actions → Create**. Use the type definitions in `nhost/actions.graphql`.
For each action:

**triggerWorkflowRun**
- Handler: the deployed URL for `triggerWorkflowRun`
- Permissions tab: add role `user`

**approveStep**
- Handler: the deployed URL for `approveStep`
- Permissions tab: add role `user`

**triggerWorkflowRunWebhook**
- Handler: the deployed URL for `triggerWorkflowRunWebhook`
- Permissions tab: add role `public` (Nhost's default role for unauthenticated
  requests — check **Settings → Environment Variables →
  `HASURA_GRAPHQL_UNAUTHORIZED_ROLE`** if `public` isn't offered). Do **not** add
  role `user` here — this action must work with zero auth header, that's the point.

## 9. Event Triggers (notify step + database-event trigger type)

Console → **Events → Create Trigger**:

**notify_step_runs**
- Table: `step_runs`, Operation: **Insert**
- Webhook: deployed URL for `notifyEventHandler`

**db_event_workflow_trigger**
- Table: `workflow_trigger_events`, Operation: **Insert**
- Webhook: deployed URL for `dbEventTrigger`

## 10. Cron Trigger (optional — scheduled trigger type)

Console → **Events → Cron Triggers → Create**:
- Webhook: deployed URL for `scheduledRunner`
- Schedule: e.g. `*/10 * * * *`
- Not required for the Final Task demo; included for completeness of "Trigger Types".

## 11. Seed two organizations

```bash
export NHOST_AUTH_URL="<from step 1>"
export NHOST_GRAPHQL_URL="<from step 1>"
export NHOST_ADMIN_SECRET="<from step 1>"
node scripts/seed.mjs
```

This creates Org A (`owner_a@example.com` owner, `editor_a@example.com` editor,
`viewer_a@example.com` viewer) and Org B (`owner_b@example.com` owner), password
`Password123!` for all, plus a ready-made "Support Ticket Triage" workflow in Org A
(`llm_call → conditional_branch → approval_gate → http_request`, with manual + webhook
triggers) so you have a known-good example even under time pressure.

## 12. Deploy the frontend

```bash
cd web
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_NHOST_GRAPHQL_URL and NEXT_PUBLIC_NHOST_AUTH_URL
npm install
npm run dev        # local check at http://localhost:3000
```

For Vercel: import the repo, set the project root to `web/`, and set the same two
`NEXT_PUBLIC_*` env vars in the Vercel project settings.

---

## Testing the Final Task, step by step

1. **Log in as `owner_a@example.com`** (password `Password123!`). Org A is selected
   automatically. You should see the quota bar and the "Support Ticket Triage" workflow
   (3+ step types: `llm_call`, `http_request`, `conditional_branch`, plus
   `approval_gate`).
2. Open the workflow. In the "Initial input" box, keep the default text containing the
   word **URGENT** (this is what drives the `conditional_branch` step to take the true
   path — works identically whether `llm_call` is real or stubbed, since the stub
   echoes the input back).
3. Click **▶ Run workflow**. You land on `/runs/<id>` with a live view (GraphQL
   subscription, no refresh):
   - `llm_call` → completed
   - `conditional_branch` → completed, `branch: true`
   - `approval_gate` → **pending_approval**, run status **paused** — with Approve/Reject
     buttons rendered right there.
4. Click **Approve**. Watch the `http_request` step start and complete live, and the run
   status flip to `completed` — no refresh.
5. **Second trigger type**: back on the workflow page, copy the printed `curl` command
   under "Webhook trigger" and run it from a terminal:
   ```bash
   curl -X POST '<graphql url>' -H 'Content-Type: application/json' -d '...'
   ```
   This calls `triggerWorkflowRunWebhook` directly with no login — a second run starts.
   (Or use the "Simulate event trigger" button for the database-event path instead.)
6. **Cross-org isolation**: log out, log in as `owner_b@example.com`. Org B has no
   workflows. Confirm:
   - The dashboard shows zero Org A workflows.
   - Directly guessing an Org A workflow/run URL
     (`/workflows/<org-a-workflow-id>`, `/runs/<org-a-run-id>`) returns nothing —
     Hasura's row filter returns `null`/empty because `owner_b` has no `org_members`
     row for Org A, regardless of knowing the UUID.
   - Calling `approveStep` on an Org A `step_run_id` as `owner_b` fails with 403 from
     the Action handler's own role check (not just a UI hide).
7. **Quota**: as `owner_a`, run the workflow a few more times, or temporarily set
   `quota_limit` to `1` for Org A via the SQL editor, then try to trigger a run — you
   should get "Organization quota exhausted" from the Action.

Record steps 1–6 for the required walkthrough video.
