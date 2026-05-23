import { and, eq, asc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { settingsViewerManifest } from '@/features/settings-viewer/manifest';
import { settingsSyncManifest } from '@/features/settings-sync/manifest';
import { marketsManifest } from '@/features/markets/manifest';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const FEATURES = [settingsViewerManifest, settingsSyncManifest, marketsManifest];

async function toggleFlagAction(callerUserId: string, formData: FormData) {
  'use server';
  const storeId = String(formData.get('storeId') ?? '');
  const featureKey = String(formData.get('featureKey') ?? '');
  const next = String(formData.get('next') ?? '') === 'true';
  if (!storeId || !featureKey) return;

  const [callerRoleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, callerUserId)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) return;

  const [existing] = await db.select().from(schema.featureFlags).where(and(
    eq(schema.featureFlags.featureKey, featureKey),
    eq(schema.featureFlags.storeId, storeId),
  )).limit(1);

  if (existing) {
    await db.update(schema.featureFlags)
      .set({ enabled: next, updatedBy: callerUserId, updatedAt: new Date() })
      .where(eq(schema.featureFlags.id, existing.id));
  } else {
    await db.insert(schema.featureFlags).values({
      featureKey, storeId, enabled: next, updatedBy: callerUserId,
    });
  }

  await recordAudit({
    userId: callerUserId, storeId, featureKey,
    action: 'toggle_feature_flag', target: featureKey,
    requestSummary: `enabled=${next}`, result: 'success',
  });
  revalidatePath('/admin/feature-flags');
}

export default async function AdminFeatureFlagsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [callerRoleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Forbidden</h1>
        <p className="text-sm">You do not have permission to manage feature flags.</p>
      </div>
    );
  }

  const stores = await db.select().from(schema.stores).orderBy(asc(schema.stores.shopDomain));
  const flagRows = await db.select().from(schema.featureFlags);
  const flagMap = new Map<string, boolean>();
  for (const f of flagRows) flagMap.set(`${f.storeId}::${f.featureKey}`, f.enabled);

  const toggleBound = toggleFlagAction.bind(null, session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Feature flags</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Enable or disable each feature per connected store. Disabled features reject all reads + writes at the connector gate.
        </p>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                {FEATURES.map((f) => (
                  <TableHead key={f.key}>
                    <div>{f.name}</div>
                    <div className="text-xs font-normal text-[var(--color-muted)]">{f.key}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={FEATURES.length + 1} className="text-center text-sm text-[var(--color-muted)] py-6">
                    No stores connected yet.
                  </TableCell>
                </TableRow>
              ) : (
                stores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="font-mono text-xs text-[var(--color-muted)]">{s.shopDomain}</div>
                    </TableCell>
                    {FEATURES.map((f) => {
                      const enabled = flagMap.get(`${s.id}::${f.key}`) ?? false;
                      return (
                        <TableCell key={f.key}>
                          <form action={toggleBound} className="flex items-center gap-2">
                            <input type="hidden" name="storeId" value={s.id} />
                            <input type="hidden" name="featureKey" value={f.key} />
                            <input type="hidden" name="next" value={enabled ? 'false' : 'true'} />
                            <Badge variant={enabled ? 'default' : 'outline'}>
                              {enabled ? 'enabled' : 'disabled'}
                            </Badge>
                            <Button type="submit" size="sm" variant="outline">
                              {enabled ? 'Disable' : 'Enable'}
                            </Button>
                          </form>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
