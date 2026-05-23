export class ConnectorError extends Error {}

export interface ConnectorStore {
  id: string;
  shopDomain: string;
  apiVersion: string;
  status: 'active' | 'disconnected' | 'error';
  maintenanceMode: boolean;
  scopes: string[];
}

export interface ConnectorDeps {
  isEnabled: (featureKey: string, storeId: string) => Promise<boolean>;
  graphql: (args: { shopDomain: string; apiVersion: string; token: string; query: string; variables?: Record<string, unknown> }) => Promise<{ data: unknown; errors?: unknown }>;
  decryptToken: (storeId: string) => Promise<string>;
}

export interface RunQueryArgs {
  store: ConnectorStore;
  featureKey: string;
  requiredScopes: string[];
  query: string;
  variables?: Record<string, unknown>;
  deps: ConnectorDeps;
}

const MAX_RETRIES = 3;

/**
 * The only path to Shopify. Read-only by design — there is no mutate() in this module.
 * `T = any` is a deliberate ergonomic default so callers can access fields without
 * boilerplate casts; specify T explicitly when the response shape is known.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runQuery<T = any>(args: RunQueryArgs): Promise<T> {
  const { store, featureKey, requiredScopes, query, variables, deps } = args;

  if (store.status !== 'active') {
    throw new ConnectorError(`Store ${store.shopDomain} is not active (${store.status})`);
  }
  if (store.maintenanceMode) {
    throw new ConnectorError(`Store ${store.shopDomain} is in maintenance mode`);
  }
  if (!(await deps.isEnabled(featureKey, store.id))) {
    throw new ConnectorError(`Feature "${featureKey}" is not enabled for ${store.shopDomain}`);
  }
  // Shopify grants read access implicitly when write access is granted. A required
  // `read_X` scope is satisfied by `write_X` in the store's installed scope set.
  const hasScope = (s: string): boolean => {
    if (store.scopes.includes(s)) return true;
    if (s.startsWith('read_') && store.scopes.includes('write_' + s.slice(5))) return true;
    return false;
  };
  const missing = requiredScopes.filter((s) => !hasScope(s));
  if (missing.length > 0) {
    throw new ConnectorError(`Missing scope(s) for ${store.shopDomain}: ${missing.join(', ')}`);
  }

  const token = await deps.decryptToken(store.id);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await deps.graphql({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query, variables,
      });
      if (res.errors) {
        throw new ConnectorError(`GraphQL error: ${JSON.stringify(res.errors)}`);
      }
      return res.data as T;
    } catch (err) {
      lastError = err;
      const throttled = err instanceof Error && /throttl|429|rate/i.test(err.message);
      if (!throttled || attempt === MAX_RETRIES - 1) break;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
  throw lastError instanceof ConnectorError
    ? lastError
    : new ConnectorError(`Query failed for ${store.shopDomain}: ${String(lastError)}`);
}
