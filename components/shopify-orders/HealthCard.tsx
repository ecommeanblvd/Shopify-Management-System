import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { Card, CardContent } from '@/components/ui/card';

interface HealthCardProps { storeId: string }

export async function HealthCard({ storeId }: HealthCardProps) {
  const [state] = await db
    .select().from(schema.shopifySyncState)
    .where(eq(schema.shopifySyncState.storeId, storeId));
  const countsRes = await db.execute<{ ok: string; failed: string }>(sql`
    SELECT SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END)::text AS ok,
           SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END)::text AS failed
      FROM shopify_webhook_log
     WHERE store_id = ${storeId} AND received_at > NOW() - INTERVAL '24 hours';
  `);
  const counts = countsRes as unknown as Array<{ ok: string; failed: string }>;

  // React 19's purity rule flags Date.now() during render. Server-component
  // request handlers genuinely need the wall clock here; suppress narrowly.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const ago = (d: Date | null | undefined): string =>
    d ? `${Math.round((nowMs - new Date(d).getTime()) / 60000)} min ago` : '—';

  return (
    <Card>
      <CardContent className="p-4 text-xs space-y-1">
        <div className="uppercase tracking-wider text-muted-foreground mb-2">Sync health</div>
        <div>Last webhook: <span className="font-mono">{ago(state?.lastWebhookAt)}</span></div>
        <div>Last cron: <span className="font-mono">{ago(state?.lastCronSyncAt)}</span></div>
        <div>Backfill: <span className="font-mono">{state?.backfillStatus ?? 'idle'}</span></div>
        <div>
          Webhooks 24h: <span className="font-mono">{counts[0]?.ok ?? '0'} ok</span>
          {' · '}
          <span className="font-mono text-destructive">{counts[0]?.failed ?? '0'} failed</span>
        </div>
      </CardContent>
    </Card>
  );
}
