// Thin admin GraphQL client. Every Action / Event Trigger / Cron Trigger handler
// uses this to read and write data, bypassing Hasura permissions on purpose —
// permission checks for the *caller* are done explicitly in each handler before
// any of these calls are made (see triggerWorkflowRun.js / approveStep.js).

const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;

async function adminGraphQL(query, variables = {}) {
  if (!GRAPHQL_URL) {
    throw new Error('NHOST_GRAPHQL_URL is not set (see CHECKLIST.md)');
  }
  if (!ADMIN_SECRET) {
    throw new Error('NHOST_ADMIN_SECRET is not set (see CHECKLIST.md)');
  }

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Hasura returned non-JSON response (HTTP ${res.status})`);
  }

  if (json.errors) {
    throw new Error(`Hasura GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

module.exports = { adminGraphQL };
