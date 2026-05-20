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

export interface RunQueryArgs<T> {
  store: ConnectorStore;
  featureKey: string;
  requiredScopes: string[];
  query: string;
  variables?: Record<string, unknown>;
  deps: ConnectorDeps;
}

const MAX_RETRIES = 3;

/** The only path to Shopify. Read-only by design — there is no mutate() in this module. */
export async function runQuery<T = any>(args: RunQueryArgs<T>): Promise<T> {
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
  const missing = requiredScopes.filter((s) => !store.scopes.includes(s));
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
