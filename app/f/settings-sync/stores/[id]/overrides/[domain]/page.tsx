import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';
type Domain = 'shipping' | 'checkout_buyer_experience';

async function addOverrideAction(storeId: string, domain: Domain, userId: string, formData: FormData) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  const path = String(formData.get('path') ?? '').trim();
  const rawValue = String(formData.get('value') ?? '');
  if (!path) return;
  let value: unknown;
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  await db.insert(schema.settingOverrides).values({
    storeId, domain, path, value: value as object, updatedBy: userId,
  }).onConflictDoUpdate({
    target: [schema.settingOverrides.storeId, schema.settingOverrides.domain, schema.settingOverrides.path],
    set: { value: value as object, updatedBy: userId, updatedAt: new Date() },
  });
}

async function removeOverrideAction(userId: string, formData: FormData) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  const id = String(formData.get('id'));
  await db.delete(schema.settingOverrides).where(eq(schema.settingOverrides.id, id));
}

export default async function OverridesPage({ params }: { params: Promise<{ id: string; domain: string }> }) {
  const { id: storeId, domain } = await params;
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') return <p>Unknown domain.</p>;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  const canEdit = role && hasPermission(role, 'apply_settings');

  const overrides = await db.select().from(schema.settingOverrides).where(and(
    eq(schema.settingOverrides.storeId, storeId),
    eq(schema.settingOverrides.domain, domain as Domain),
  ));

  const addBound = addOverrideAction.bind(null, storeId, domain as Domain, session.user.id);
  const removeBound = removeOverrideAction.bind(null, session.user.id);

  return (
    <main style={{ padding: 24 }}>
      <h1>{domain} overrides for store {storeId}</h1>
      <table>
        <thead><tr><th>Path</th><th>Value</th><th /></tr></thead>
        <tbody>
          {overrides.map((o) => (
            <tr key={o.id}>
              <td><code>{o.path}</code></td>
              <td><pre style={{ margin: 0 }}>{JSON.stringify(o.value)}</pre></td>
              <td>{canEdit && (
                <form action={removeBound}>
                  <input type="hidden" name="id" value={o.id} />
                  <button type="submit">Remove</button>
                </form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <form action={addBound} style={{ marginTop: 16 }}>
          <input name="path" placeholder="zones.Domestic.rates.Standard.price" style={{ width: 360 }} />
          {' '}<input name="value" placeholder='35000 or {"price":35000}' style={{ width: 200 }} />
          {' '}<button type="submit">Add / update</button>
        </form>
      )}
    </main>
  );
}
