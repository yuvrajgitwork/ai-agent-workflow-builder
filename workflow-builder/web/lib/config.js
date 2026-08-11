// All of these are copy-pasted verbatim from your Nhost project dashboard
// (Settings -> General shows exact service URLs) — see CHECKLIST.md.
// We deliberately do NOT construct URLs from a subdomain/region pattern here,
// since that pattern is easy to get subtly wrong; paste the real ones instead.

export const GRAPHQL_URL = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
export const AUTH_URL = process.env.NEXT_PUBLIC_NHOST_AUTH_URL;

export function wsUrlFromGraphqlUrl(url) {
  if (!url) return url;
  return url.replace(/^http/, 'ws');
}
