import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { previewApply, executeApply } from '@/features/settings-sync/actions';
import {
  SHIPPING_QUERY,
  SHIPPING_MUTATION,
  normalizeShopifyDeliveryProfile,
  denormalizeToMutationInput,
} from '@/features/settings-sync/domain/shipping';
import {
  BUYER_EXPERIENCE_QUERY,
  BUYER_EXPERIENCE_MUTATION,
  normalizeBuyerExperience,
  denormalizeBuyerExperience,
} from '@/features/settings-sync/domain/checkout-buyer-experience';
import type { DomainAdapter } from '@/features/settings-sync/apply';

export const dynamic = 'force-dynamic';

type Domain = 'shipping' | 'checkout_buyer_experience';

// Adapters are defined at module scope so they are available inside the
// server action without being captured by closure across the action boundary.
const SHIPPING_ADAPTER: DomainAdapter = {
  fetchQuery: SHIPPING_QUERY,
  normalize: (data) => {
    const n = normalizeShopifyDeliveryProfile(data);
    return {
      tree: n.tree as unknown as Record<string, unknown>,
      shopifyIds: n.shopifyIds as unknown as Record<string, unknown>,
    };
  },
  buildMutation: (current, effective) => {
    const input = denormalizeToMutationInput(
      { tree: current.tree as never, shopifyIds: current.shopifyIds as never },
      effective as never,
    );
    return { mutation: SHIPPING_MUTATION, variables: { id: input.profileId, profile: input } };
  },
};

const BUYER_EXP_ADAPTER: DomainAdapter = {
  fetchQuery: BUYER_EXPERIENCE_QUERY,
  normalize: (data) => ({
    tree: normalizeBuyerExperience(data) as unknown as Record<string, unknown>,
    shopifyIds: {},
  }),
  buildMutation: (current, effective) => {
    const diff = denormalizeBuyerExperience(current.tree as never, effective as never);
    return { mutation: BUYER_EXPERIENCE_MUTATION, variables: { input: diff } };
  },
};

function adapterFor(domain: Domain): DomainAdapter {
  return domain === 'shipping' ? SHIPPING_ADAPTER : BUYER_EXP_ADAPTER;
}

// Server action — accepts only JSON-serialisable arguments.
// The adapter is selected inside the action by domain key so that no
// function references cross the Next.js server-action serialisation boundary.
async function runApplyAction(userId: string, formData: FormData) {
  'use server';
  const ids = formData.getAll('storeIds').map(String);
  const d = formData.get('domain') as Domain;
  const v = Number(formData.get('version'));
  await executeApply(ids, d, v, adapterFor(d), userId);
  redirect('/f/settings-sync/history');
}

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; storeId?: string; version?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [roleRow] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.userId, session.user.id))
    .limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return <p>Forbidden.</p>;

  const stores = await db.select().from(schema.stores);
  const templates = await db
    .select()
    .from(schema.settingTemplates)
    .orderBy(desc(schema.settingTemplates.version));

  const domain = (sp.domain ?? 'shipping') as Domain;
  const storeId = sp.storeId ?? stores[0]?.id ?? '';
  const version = sp.version
    ? Number(sp.version)
    : templates.find((t) => t.domain === domain)?.version;

  let preview: unknown = null;
  if (storeId && version != null) {
    try {
      preview = await previewApply(storeId, domain, version, adapterFor(domain));
    } catch (err) {
      preview = {
        error: 'Preview failed',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const submitBound = runApplyAction.bind(null, session.user.id);

  return (
    <main style={{ padding: 24 }}>
      <h1>Apply settings</h1>

      <form method="get" style={{ marginBottom: 24 }}>
        <label>
          Domain:{' '}
          <select name="domain" defaultValue={domain}>
            <option value="shipping">shipping</option>
            <option value="checkout_buyer_experience">checkout_buyer_experience</option>
          </select>
        </label>
        {' '}
        <label>
          Store:{' '}
          <select name="storeId" defaultValue={storeId}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {' '}
        <label>
          Version:{' '}
          <select name="version" defaultValue={version ?? ''}>
            {templates
              .filter((t) => t.domain === domain)
              .map((t) => (
                <option key={t.id} value={t.version}>
                  v{t.version}
                </option>
              ))}
          </select>
        </label>
        {' '}
        <button type="submit">Preview</button>
      </form>

      <h2>Preview diff</h2>
      <pre style={{ background: '#f5f5f5', padding: 12 }}>
        {JSON.stringify(preview, null, 2)}
      </pre>

      <h2>Confirm apply</h2>
      <form action={submitBound}>
        <input type="hidden" name="domain" value={domain} />
        <input type="hidden" name="version" value={version ?? ''} />
        <p>Select target stores:</p>
        {stores.map((s) => (
          <label key={s.id} style={{ display: 'block' }}>
            <input
              type="checkbox"
              name="storeIds"
              value={s.id}
              defaultChecked={s.id === storeId}
            />{' '}
            {s.name}
          </label>
        ))}
        <button type="submit" style={{ marginTop: 12 }}>
          Apply to selected stores
        </button>
      </form>
    </main>
  );
}
