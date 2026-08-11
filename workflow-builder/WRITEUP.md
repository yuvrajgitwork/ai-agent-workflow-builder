# Write-up

## Schema reasoning

The tenancy chain is `organizations → org_members → workflows → (workflow_steps,
workflow_triggers) → workflow_runs → step_runs`, exactly as specified. A few choices
worth calling out:

- **`org_members.email` is denormalized.** Rather than adding relationships/permissions
  on the `auth.users` table (which the assignment says to avoid modifying/over-exposing),
  the member's email is copied onto `org_members` at membership-creation time, purely for
  display. This keeps every custom-table permission scoped to tables we fully own.
- **`workflow_outputs` is a separate table**, not a column on `step_runs`, so `db_write`
  has somewhere concrete to "save a result into your own tables" without overloading
  `step_runs.output` (which already holds every step type's output for the live view).
- **`workflow_trigger_events` exists purely to give the "database event" trigger type
  something real to watch** — a row inserted there (by an external system, or a "simulate"
  button in the demo UI) is what a Hasura Event Trigger reacts to.
- **`org_stats` is a Postgres view**, not a computed field, aggregating both requested
  metrics (runs this month, average run duration) plus quota in one place, joined
  `organizations → workflows → workflow_runs`. Tracked read-only in Hasura.
- Every FK cascades on delete; every status column is a `text` + `CHECK` constraint
  rather than a Postgres enum, so Hasura permission JSON stays plain string comparisons
  (`_in: ["owner","editor"]`) instead of enum-typed input objects — one less thing to get
  wrong under time pressure, at the cost of DB-level enum safety.

## The two permission layers

**Layer 1 (org + role scoping)** lives entirely as Hasura row permissions on role
`user`. Every table's `select`/`insert`/`update`/`delete` filter traverses relationships
back to `organizations.org_members` and checks `user_id = X-Hasura-User-Id`, so
membership itself is the tenancy boundary — a user with zero `org_members` rows for an
org gets an empty result set for *any* table under that org, including by guessing an
ID directly (a `where: {id: {_eq: "<guessed-uuid>"}}` on `workflows_by_pk` still passes
through the same row filter and returns `null`). Role checks (`owner`/`editor` for
writes) are nested inside the same relationship traversal, e.g.
`workflow.organization.org_members._and[user_id = me, role in (owner, editor)]`.

**Layer 2 (step-level gating)** is split across two mechanisms, deliberately, because it
answers two different questions:

1. *Can this row be written at all?* — for `workflow_steps` (type `db_write`/`notify`)
   and `workflow_triggers` (type `webhook`), a Hasura permission `_or` branches on the
   row's own `type` column: the non-restricted branch requires `owner`/`editor`, the
   restricted branch requires `owner`. This is a plain database permission because it's
   a plain row write — Hasura's declarative permissions are the right tool.
2. *Should this in-flight execution resume right now?* — clearing an `approval_gate` is
   not a row write the client should be trusted to author directly (there's no
   `step_runs` insert/update permission for role `user` at all — see below); it's a
   decision an Action handler makes after re-deriving the caller's role at the moment of
   approval. `approveStep.js` looks up `org_members` for the approver, requires
   `owner`/`editor`, and only then resumes execution. This can't be a static database
   permission because "resume" isn't a row operation — it's "read a role, then run
   arbitrary further business logic (call an LLM, call an HTTP endpoint, mutate multiple
   tables) conditionally." Putting it in code is not a workaround, it's the only place
   this decision can live.

A related, intentional design choice: `workflow_runs` and `step_runs` have **no**
insert/update/delete permission for role `user` at all. Every write to them goes through
an Action (`triggerWorkflowRun`, `triggerWorkflowRunWebhook`, `approveStep`) or an
Event/Cron Trigger handler, all authenticated with the admin secret. This means "who can
trigger a run" and "who can advance a paused run" only need to be correct in one place
each (the top of `triggerWorkflowRun.js` / `approveStep.js`) rather than also needing a
matching, separately-maintained Hasura permission that could drift out of sync.

## Approval-gate pause/resume

`_lib/engine.js` exports one function, `runFrom({ workflowRunId, orgId, steps,
startIndex, previousOutput })`, used by every entrypoint (manual trigger, webhook
trigger, database-event trigger, scheduled trigger, and the resume-after-approval path).
It walks `steps` from `startIndex`, executing each by type. When it reaches an
`approval_gate` step, it:

1. Sets that `step_runs` row to `pending_approval`.
2. Sets `workflow_runs.status = 'paused'`.
3. **Returns immediately** — the function call ends here; nothing is "waiting" inside a
   running process. The paused state is entirely represented in the database.

The live subscription (`step_runs` filtered by `workflow_run_id`) picks up the
`pending_approval` row the instant it's written, so the frontend renders the
Approve/Reject UI with no polling.

Resuming is just calling `runFrom` again, later, from a different entrypoint:
`approveStep.js` re-fetches the ordered step list, finds the index just after the
approved step's `step_order`, and calls `runFrom` with that `startIndex` and
`workflow_runs.status` flipped back to `running`. Because all state (which step is next,
what the previous output was, quota, run status) is persisted in Postgres rather than
held in memory, the resume can happen seconds or hours later, from a cold serverless
invocation, with no special-casing — it's the same function, just started partway
through the list instead of at 0.

Retries for `llm_call`/`http_request` (`withRetry` in `engine.js`) use the same pattern
at a smaller scale: `attempt_count` is written to `step_runs` before each attempt so
retry progress is visible live, not just the eventual outcome.

## What's deliberately not done

Org/member management has no UI or client-writable permission — creating orgs and
assigning roles happens via `scripts/seed.mjs` (or directly with the admin secret). The
Final Task only requires two pre-existing organizations with pre-assigned roles; a full
invite/self-serve-signup-to-org flow is real work (needs its own careful permission
design to avoid privilege escalation on `org_members` inserts) that doesn't change
whether the six Final Task conditions hold, so it was cut to protect time spent on the
Action handler, retries, and the permission layers that are actually graded.
