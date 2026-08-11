-- AI Agent Workflow Builder — initial schema
-- Run this whole file once via Hasura Console -> Data -> SQL (with "Track this" checked),
-- or via psql. See CHECKLIST.md for exact steps.

create extension if not exists pgcrypto;

-- ============================================================
-- Core tenancy
-- ============================================================

create table public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  quota_limit        integer not null default 50,
  quota_used         integer not null default 0,
  quota_period_start timestamptz not null default date_trunc('month', now()),
  created_at         timestamptz not null default now()
);

create table public.org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- denormalized for display only, so the frontend never needs to touch auth.users permissions
  email      text,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on public.org_members(user_id);
create index idx_org_members_org on public.org_members(org_id);

-- ============================================================
-- Workflows
-- ============================================================

create table public.workflows (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_workflows_org on public.workflows(org_id);

create table public.workflow_steps (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  step_order  integer not null,
  type        text not null check (type in (
                'llm_call', 'http_request', 'db_write', 'notify',
                'conditional_branch', 'approval_gate'
              )),
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create index idx_workflow_steps_workflow on public.workflow_steps(workflow_id, step_order);

create table public.workflow_triggers (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  type        text not null check (type in ('manual', 'webhook', 'scheduled', 'event')),
  -- webhook: { "secret": "..." }  |  event: { "watch_table": "..." }  |  scheduled: { "note": "..." }
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_workflow_triggers_workflow on public.workflow_triggers(workflow_id);

-- ============================================================
-- Runs
-- ============================================================

create table public.workflow_runs (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.workflows(id) on delete cascade,
  status       text not null default 'pending' check (status in (
                 'pending', 'running', 'paused', 'completed', 'failed'
               )),
  trigger_type text not null default 'manual',
  triggered_by uuid references auth.users(id),
  started_at   timestamptz default now(),
  finished_at  timestamptz,
  error        text
);

create index idx_workflow_runs_workflow on public.workflow_runs(workflow_id, started_at desc);

create table public.step_runs (
  id               uuid primary key default gen_random_uuid(),
  workflow_run_id  uuid not null references public.workflow_runs(id) on delete cascade,
  workflow_step_id uuid not null references public.workflow_steps(id) on delete cascade,
  status           text not null default 'pending' check (status in (
                     'pending', 'running', 'completed', 'failed', 'skipped',
                     'pending_approval', 'rejected'
                   )),
  input            jsonb,
  output           jsonb,
  error            text,
  attempt_count    integer not null default 0,
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz
);

create index idx_step_runs_run on public.step_runs(workflow_run_id);
create index idx_step_runs_step on public.step_runs(workflow_step_id);

-- db_write steps land here
create table public.workflow_outputs (
  id              uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_run_id     uuid references public.step_runs(id) on delete set null,
  data            jsonb,
  created_at      timestamptz not null default now()
);

create index idx_workflow_outputs_run on public.workflow_outputs(workflow_run_id);

-- Insert a row here to simulate an external system writing to a "watched table" —
-- a Hasura Event Trigger on this table's INSERT drives the "Database event" trigger type.
create table public.workflow_trigger_events (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_wf_trigger_events_workflow on public.workflow_trigger_events(workflow_id);

-- ============================================================
-- Aggregation: org-level usage / avg run duration (Hasura requirement)
-- ============================================================

create view public.org_stats as
select
  o.id as org_id,
  o.quota_used,
  o.quota_limit,
  count(distinct wr.id) filter (
    where wr.started_at >= date_trunc('month', now())
  ) as runs_this_month,
  coalesce(
    avg(extract(epoch from (wr.finished_at - wr.started_at)))
      filter (where wr.finished_at is not null),
    0
  )::float as avg_run_duration_seconds
from public.organizations o
left join public.workflows w on w.org_id = o.id
left join public.workflow_runs wr on wr.workflow_id = w.id
group by o.id, o.quota_used, o.quota_limit;
