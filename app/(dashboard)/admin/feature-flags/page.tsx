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
import { ShieldCheck, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to manage feature flags.</p>
      </div>
    );
  }

  const stores = await db.select().from(schema.stores).orderBy(asc(schema.stores.shopDomain));
  const flagRows = await db.select().from(schema.featureFlags);
  const flagMap = new Map<string, boolean>();
  for (const f of flagRows) flagMap.set(`${f.storeId}::${f.featureKey}`, f.enabled);

  const toggleBound = toggleFlagAction.bind(null, session.user.id);

  const totalEnabled = flagRows.filter((f) => f.enabled).length;
  const totalCells = stores.length * FEATURES.length;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" />
          Administration
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Feature flags</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Toggle each feature per connected store. Disabled features reject every read and write at the connector gate — the feature page surfaces a clear error rather than failing silently.
        </p>
      </header>

      {stores.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <StatTile label="Stores" value={String(stores.length)} sub="Connected" />
          <StatTile label="Features" value={String(FEATURES.length)} sub="Registered" />
          <StatTile label="Enabled" value={`${totalEnabled}/${totalCells}`} sub="Across all stores" />
        </div>
      )}

      {stores.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ToggleRight className="size-8 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-medium">No stores connected yet</div>
            <div className="text-xs text-muted-foreground mt-1">Connect a store before granting feature access.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {stores.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-5 md:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{s.shopDomain}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {FEATURES.map((f) => {
                    const enabled = flagMap.get(`${s.id}::${f.key}`) ?? false;
                    return (
                      <form key={f.key} action={toggleBound} className="rounded-xl border border-border p-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors">
                        <input type="hidden" name="storeId" value={s.id} />
                        <input type="hidden" name="featureKey" value={f.key} />
                        <input type="hidden" name="next" value={enabled ? 'false' : 'true'} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{f.name}</div>
                          <div className="text-[10px] font-mono text-muted-foreground truncate">{f.key}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={enabled ? 'default' : 'outline'} className="h-5 text-[10px] uppercase tracking-wider">
                            {enabled ? 'on' : 'off'}
                          </Badge>
                          <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
                            {enabled ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </form>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({
  label, value, sub,
}: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
