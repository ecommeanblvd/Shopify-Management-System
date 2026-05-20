import { mergeEffective, type OverrideRow } from './merge';
import { diffTrees, type Operations } from './diff';

export interface ApplyStore {
  id: string; shopDomain: string; apiVersion: string;
  status: 'active' | 'disconnected' | 'error';
  maintenanceMode: boolean; scopes: string[];
}

export interface DomainAdapter {
  fetchQuery: string;
  normalize: (data: unknown) => { tree: Record<string, unknown>; shopifyIds: Record<string, unknown> };
  buildMutation: (
    current: { tree: Record<string, unknown>; shopifyIds: Record<string, unknown> },
    effective: Record<string, unknown>,
  ) => { mutation: string; variables: Record<string, unknown> };
}

export interface ApplyDeps {
  isReconciled: (storeId: string, domain: string) => Promise<boolean>;
  readCurrent: (store: ApplyStore, query: string) => Promise<unknown>;
  captureSnapshot: (args: { storeId: string; domain: string; payload: unknown; applyRunId: string }) => Promise<void>;
  runMutation: (args: {
    store: ApplyStore;
    applyRunId: string;
    domain: string;
    mutation: string;
    variables: Record<string, unknown>;
  }) => Promise<unknown>;
  listOverrides: (storeId: string, domain: string) => Promise<OverrideRow[]>;
  recordAudit: (entry: {
    storeId: string; applyRunId: string; domain: string;
    action: string; result: 'success' | 'error'; errorDetail?: string | null;
    requestSummary?: string | null;
  }) => Promise<void>;
}

export interface ApplyArgs {
  store: ApplyStore;
  applyRunId: string;
  domain: string;
  template: Record<string, unknown>;
  adapter: DomainAdapter;
  dryRun: boolean;
  deps: ApplyDeps;
}

export type ApplyResult =
  | { kind: 'preview'; ops: Operations }
  | { kind: 'applied'; ops: Operations };

export async function runApplyForStore(args: ApplyArgs): Promise<ApplyResult> {
  const { store, applyRunId, domain, template, adapter, dryRun, deps } = args;

  if (!(await deps.isReconciled(store.id, domain))) {
    throw new Error(`Reconciliation required for store ${store.shopDomain} / ${domain}`);
  }

  const rawCurrent = await deps.readCurrent(store, adapter.fetchQuery);
  const current = adapter.normalize(rawCurrent);
  const overrides = await deps.listOverrides(store.id, domain);
  const effective = mergeEffective(template, overrides);
  const ops = diffTrees(current.tree, effective);

  if (dryRun) {
    return { kind: 'preview', ops };
  }

  await deps.captureSnapshot({ storeId: store.id, domain, payload: current.tree, applyRunId });

  const { mutation, variables } = adapter.buildMutation(current, effective);
  try {
    await deps.runMutation({ store, applyRunId, domain, mutation, variables });
  } catch (err) {
    await deps.recordAudit({
      storeId: store.id, applyRunId, domain,
      action: 'apply_settings', result: 'error', errorDetail: String(err),
    });
    throw err;
  }
  await deps.recordAudit({
    storeId: store.id, applyRunId, domain,
    action: 'apply_settings', result: 'success',
    requestSummary: `creates=${ops.creates.length} updates=${ops.updates.length} deletes=${ops.deletes.length}`,
  });
  return { kind: 'applied', ops };
}
