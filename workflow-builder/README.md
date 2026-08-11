# AI Agent Workflow Builder

A minimal n8n for chaining AI agent steps, built on Nhost (Postgres + Hasura + Auth +
Functions) + Next.js. Built as a one-day MVP — see `WRITEUP.md` for design reasoning
and known simplifications, and `CHECKLIST.md` for exact setup + demo steps.

## What's here

```
nhost/
  migrations/001_init.sql   — full Postgres schema + org_stats aggregation view
  actions.graphql            — reference SDL for the 3 Hasura Actions
  nhost.toml                 — optional, only needed for local `nhost up` dev
functions/                   — Nhost Serverless Functions (plain Node, no framework)
  triggerWorkflowRun.js       Hasura Action: the core run-execution entrypoint
  approveStep.js               Hasura Action: approve/reject a paused approval_gate
  triggerWorkflowRunWebhook.js Hasura Action (public): the inbound webhook trigger
  notifyEventHandler.js       Hasura Event Trigger target: implements the notify step
  dbEventTrigger.js           Hasura Event Trigger target: the "database event" trigger type
  scheduledRunner.js          Hasura Cron Trigger target: the "scheduled" trigger type
  _lib/engine.js               shared step-execution loop (retries, branching, pausing)
  _lib/llm.js, _lib/http.js    the llm_call / http_request step implementations
web/                          Next.js app (Pages Router, plain CSS, Apollo Client)
scripts/seed.mjs              creates 2 demo orgs + users + a sample workflow
CHECKLIST.md                  exact manual setup steps + Final Task test script
WRITEUP.md                    schema reasoning, permission layers, approval pause/resume
```

## Quick start

Follow `CHECKLIST.md` top to bottom — it's the authoritative, ordered setup guide
(Nhost project creation, running the SQL migration, tracking tables/relationships,
permissions, deploying functions, wiring Actions/Event/Cron triggers, seeding demo
data, deploying the frontend). This README is just an overview.

Minimum to get a working app:

```bash
# 1. Backend: create an Nhost project, run nhost/migrations/001_init.sql via the
#    Hasura Console SQL tab, then follow CHECKLIST.md sections 4-10.

# 2. Seed two demo orgs + users
export NHOST_AUTH_URL=...      # from your Nhost project
export NHOST_GRAPHQL_URL=...
export NHOST_ADMIN_SECRET=...
node scripts/seed.mjs

# 3. Frontend
cd web
cp .env.local.example .env.local   # fill in the two NEXT_PUBLIC_* values
npm install
npm run dev
```

## API keys / external services

| Key | Required? | What happens without it |
|---|---|---|
| `GROQ_API_KEY` (Groq, free tier) | No | `llm_call` steps use a stubbed response with a disclosed ~800ms artificial delay, echoing the rendered prompt back. Everything else (retries, status tracking, branching) works identically. |
| `SLACK_WEBHOOK_URL` | No | `notify` steps log to the function's console instead of posting to Slack. |
| Nhost Admin Secret | Yes | Required for every serverless function to talk to Hasura. |

Set `GROQ_API_KEY` in Nhost's function environment variables (Settings → Environment
Variables) to get real LLM calls — model defaults to `llama-3.1-8b-instant`, overridable
per-step via `config.model`.

## Local development

- **Frontend only**, against a real (cloud) Nhost backend: `cd web && npm run dev`. This
  is the fastest loop and what the CHECKLIST assumes.
- **Full local stack** via the Nhost CLI (`nhost up`, requires Docker) is possible using
  `nhost/nhost.toml`, but wasn't the focus given the one-day timeline — the cloud +
  Console workflow in CHECKLIST.md is lower-risk and faster to get running.

## Known limitations (see WRITEUP.md for the reasoning)

- Org/member creation has no UI — orgs and memberships are created via `scripts/seed.mjs`
  or directly via the admin secret. Given the Final Task only requires two pre-existing
  orgs, building a full invite flow wasn't worth the time.
- The "scheduled" trigger's cadence lives on one shared Hasura Cron Trigger, not
  per-workflow cron expressions.
- Workflow steps are a single ordered list, not an arbitrary DAG; `conditional_branch`
  works by skipping a configurable number of subsequent steps rather than jumping to an
  arbitrary node.
- `workflow_triggers.config` (which holds the webhook secret) is visible to all org
  members including viewers, not just owners — acceptable for the MVP, flagged for
  hardening later.
