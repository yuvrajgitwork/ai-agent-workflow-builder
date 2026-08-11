#!/usr/bin/env node
// Seed script for the Final Task demo.
//
// Creates:
//   Org A: owner_a@example.com (owner), editor_a@example.com (editor), viewer_a@example.com (viewer)
//   Org B: owner_b@example.com (owner)
// ...and a ready-made "Support Ticket Triage" workflow in Org A with llm_call ->
// conditional_branch -> approval_gate -> http_request, plus manual + webhook triggers,
// so you have a working example even if you don't build one from scratch in the UI.
//
// Usage:
//   NHOST_AUTH_URL=... NHOST_GRAPHQL_URL=... NHOST_ADMIN_SECRET=... node scripts/seed.mjs
//
// Requires Node 18+ (uses global fetch). Password for all demo users: "Password123!"

const AUTH_URL = process.env.NHOST_AUTH_URL;
const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;
const PASSWORD = 'Password123!';

if (!AUTH_URL || !GRAPHQL_URL || !ADMIN_SECRET) {
  console.error('Set NHOST_AUTH_URL, NHOST_GRAPHQL_URL, and NHOST_ADMIN_SECRET first. See CHECKLIST.md.');
  process.exit(1);
}

async function adminGraphQL(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': ADMIN_SECRET },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

async function signUpOrFetch(email) {
  const res = await fetch(`${AUTH_URL}/signup/email-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();

  let userId = json?.session?.user?.id;

  if (!userId) {
    // Already exists (or pending verification) — look it up via admin GraphQL instead.
    // Fetching all + filtering client-side avoids guessing whether the `email` column's
    // GraphQL scalar is `citext` or `String` on this project.
    const data = await adminGraphQL(`query { users { id email } }`);
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (!userId) {
      throw new Error(`Could not sign up or find existing user for ${email}: ${JSON.stringify(json)}`);
    }
  }

  // Force emailVerified = true so the demo doesn't get blocked on email verification.
  // (hasura-auth's Postgres schema uses camelCase column names directly, so this is not
  // a GraphQL naming-convention transform.)
  //await adminGraphQL(
  //  `mutation ($id: uuid!) { update_users_by_pk(pk_columns: { id: $id }, _set: { emailVerified: true }) { id } }`,
  //  { id: userId }
  //);

  return userId;
}

async function main() {
  console.log('Signing up demo users...');
  const ownerA = await signUpOrFetch('owner_a@example.com');
  const editorA = await signUpOrFetch('editor_a@example.com');
  const viewerA = await signUpOrFetch('viewer_a@example.com');
  const ownerB = await signUpOrFetch('owner_b@example.com');
  console.log('Users ready:', { ownerA, editorA, viewerA, ownerB });

  console.log('Creating organizations...');
  const orgsData = await adminGraphQL(
    `mutation {
      a: insert_organizations_one(object: { name: "Org A", quota_limit: 20 }) { id }
      b: insert_organizations_one(object: { name: "Org B", quota_limit: 20 }) { id }
    }`
  );
  const orgA = orgsData.a.id;
  const orgB = orgsData.b.id;
  console.log('Orgs:', { orgA, orgB });

  console.log('Creating memberships...');
  await adminGraphQL(
    `mutation ($rows: [org_members_insert_input!]!) {
      insert_org_members(objects: $rows) { affected_rows }
    }`,
    {
      rows: [
        { org_id: orgA, user_id: ownerA, role: 'owner', email: 'owner_a@example.com' },
        { org_id: orgA, user_id: editorA, role: 'editor', email: 'editor_a@example.com' },
        { org_id: orgA, user_id: viewerA, role: 'viewer', email: 'viewer_a@example.com' },
        { org_id: orgB, user_id: ownerB, role: 'owner', email: 'owner_b@example.com' },
      ],
    }
  );

  console.log('Creating sample "Support Ticket Triage" workflow in Org A...');
  const wfData = await adminGraphQL(
    `mutation ($orgId: uuid!, $createdBy: uuid!) {
      insert_workflows_one(object: {
        org_id: $orgId, name: "Support Ticket Triage", description: "Classifies a ticket, escalates urgent ones after approval.",
        created_by: $createdBy
      }) { id }
    }`,
    { orgId: orgA, createdBy: ownerA }
  );
  const workflowId = wfData.insert_workflows_one.id;

  const secret = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  await adminGraphQL(
    `mutation ($rows: [workflow_steps_insert_input!]!) { insert_workflow_steps(objects: $rows) { affected_rows } }`,
    {
      rows: [
        {
          workflow_id: workflowId,
          step_order: 1,
          type: 'llm_call',
          config: {
            prompt:
              'Classify this support ticket as URGENT or NORMAL. Reply with just the one word.\n\nTicket: {{input}}',
          },
        },
        {
          workflow_id: workflowId,
          step_order: 2,
          type: 'conditional_branch',
          config: { field: 'text', operator: 'contains', value: 'URGENT', skip_if_false: 2 },
        },
        {
          workflow_id: workflowId,
          step_order: 3,
          type: 'approval_gate',
          config: {},
        },
        {
          workflow_id: workflowId,
          step_order: 4,
          type: 'http_request',
          config: { url: 'https://jsonplaceholder.typicode.com/posts', method: 'GET' },
        },
      ],
    }
  );

  await adminGraphQL(
    `mutation ($rows: [workflow_triggers_insert_input!]!) { insert_workflow_triggers(objects: $rows) { affected_rows } }`,
    {
      rows: [
        { workflow_id: workflowId, type: 'manual', config: {} },
        { workflow_id: workflowId, type: 'webhook', config: { secret } },
      ],
    }
  );

  console.log('\nDone.\n');
  console.log('Demo login (password for all): Password123!');
  console.log('  owner_a@example.com  / editor_a@example.com  / viewer_a@example.com   -> Org A');
  console.log('  owner_b@example.com                                                    -> Org B');
  console.log(`\nSample workflow id: ${workflowId}`);
  console.log(`Webhook secret: ${secret}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
