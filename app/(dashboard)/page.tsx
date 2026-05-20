import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

function statusVariant(status: string): 'default' | 'destructive' | 'secondary' {
  if (status === 'active') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

export default async function HomePage() {
  const stores = await db.select().from(schema.stores);
  const pendingReconciliation = await db.select().from(schema.reconciliationStatus)
    .where(eq(schema.reconciliationStatus.status, 'pending'));
  const recentRuns = await db.select().from(schema.applyRuns).limit(50);

  const active = stores.filter((s) => s.status === 'active').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link href="/stores/connect" className={buttonVariants()}>
          <Plus className="size-4 mr-1" /> Connect a store
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-[var(--color-muted)]">Stores</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{stores.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-[var(--color-muted)]">Active</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{active}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-[var(--color-muted)]">Pending reconciliation</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{pendingReconciliation.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-[var(--color-muted)]">Recent apply runs</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{recentRuns.length}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Connected stores</CardTitle></CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">No stores connected yet. Click "Connect a store" to begin.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.shopDomain}</TableCell>
                    <TableCell><Badge variant={statusVariant(s.status)}>{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
