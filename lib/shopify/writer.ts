export class WriterError extends Error {}

export interface WriterStore {
  id: string;
  shopDomain: string;
  apiVersion: string;
  status: 'active' | 'disconnected' | 'error';
  maintenanceMode: boolean;
  scopes: string[];
}

export interface WriterDeps {
  isEnabled: (featureKey: string, storeId: string) => Promise<boolean>;
  isReconciled: (storeId: string, domain: string) => Promise<boolean>;
  hasSnapshot: (storeId: string, domain: string, applyRunId: string) => Promise<boolean>;
  manifestHasWriteOps: (featureKey: string) => boolean;
  graphql: (args: { shopDomain: string; apiVersion: string; token: string; mutation: string; variables?: Record<string, unknown> }) => Promise<{ data: unknown; errors?: unknown }>;
  decryptToken: (storeId: string) => Promise<string>;
}

export interface RunMutationArgs {
  store: WriterStore;
  featureKey: string;
  requiredScopes: string[];
  applyRunId: string;
  domain: string;
  mutation: string;
  variables?: Record<string, unknown>;
  deps: WriterDeps;
}

const MAX_RETRIES = 3;

/** The only path that writes to Shopify. Four gates enforced in order. */
export async function runMutation(args: RunMutationArgs): Promise<unknown> {
  const { store, featureKey, requiredScopes, applyRunId, domain, mutation, variables, deps } = args;

  // Gate 1: read-time guards — store active, not in maintenance, flag on, scopes present.
  if (store.status !== 'active') {
    throw new WriterError(`Store ${store.shopDomain} is not active (${store.status})`);
  }
  if (store.maintenanceMode) {
    throw new WriterError(`Store ${store.shopDomain} is in maintenance mode`);
  }
  if (!(await deps.isEnabled(featureKey, store.id))) {
    throw new WriterError(`Feature "${featureKey}" is not enabled for ${store.shopDomain}`);
  }
  const missingScopes = requiredScopes.filter((s) => !store.scopes.includes(s));
  if (missingScopes.length > 0) {
    throw new WriterError(`Missing scope(s) for ${store.shopDomain}: ${missingScopes.join(', ')}`);
  }

  // Gate 2: manifest declares write operations.
  if (!deps.manifestHasWriteOps(featureKey)) {
    throw new WriterError(`Feature "${featureKey}" does not declare write operations`);
  }

  // Gate 3: reconciliation done for (store, domain).
  if (!(await deps.isReconciled(store.id, domain))) {
    throw new WriterError(`Reconciliation required for store ${store.shopDomain} / ${domain}`);
  }

  // Gate 4: snapshot captured for this apply run.
  if (!(await deps.hasSnapshot(store.id, domain, applyRunId))) {
    throw new WriterError(`Snapshot required before mutation (store ${store.shopDomain}, run ${applyRunId})`);
  }

  const token = await deps.decryptToken(store.id);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await deps.graphql({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, mutation, variables,
      });
      if (res.errors) throw new WriterError(`GraphQL error: ${JSON.stringify(res.errors)}`);
      return res.data;
    } catch (err) {
      lastError = err;
      const throttled = err instanceof Error && /throttl|429|rate/i.test(err.message);
      if (!throttled || attempt === MAX_RETRIES - 1) break;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
  throw lastError instanceof WriterError
    ? lastError
    : new WriterError(`Mutation failed: ${String(lastError)}`);
}
