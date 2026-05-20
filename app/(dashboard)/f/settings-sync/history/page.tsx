import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'success') return 'default';
  if (s === 'failed' || s === 'partial') return 'destructive';
  if (s === 'rolled_back') return 'outline';
  return 'secondary';
}

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'view_settings_history')) return <p>Forbidden.</p>;

  const runs = await db.select().from(schema.applyRuns).orderBy(desc(schema.applyRuns.startedAt)).limit(50);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Apply history</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead><TableHead>Domain</TableHead><TableHead>Stores</TableHead><TableHead>Status</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.startedAt).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.domain}</TableCell>
                  <TableCell>{r.targetStoreIds.length}</TableCell>
                  <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                  <TableCell><Link className="text-[var(--color-primary)] hover:underline text-sm" href={`/f/settings-sync/history/${r.id}`}>Detail</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
