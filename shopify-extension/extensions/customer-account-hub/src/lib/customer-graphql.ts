// Thin client for the Customer Account GraphQL API. Auth is applied automatically
// by the Shopify runtime for the `shopify://customer-account/...` URL — no session
// token is attached here.
//
// NOTE: pin the API version deliberately. Some fields (e.g. `storeCreditAccounts`)
// are only present on newer versions; callers should try/catch and degrade
// gracefully. See docs/customer-account-deploy.md.
const CUSTOMER_ACCOUNT_GRAPHQL_URL = 'shopify://customer-account/api/2025-07/graphql.json';

export async function customerGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(CUSTOMER_ACCOUNT_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Customer Account API: ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors && body.errors.length > 0) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  if (!body.data) throw new Error('Customer Account API: empty response');
  return body.data;
}
