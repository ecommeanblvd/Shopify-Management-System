import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { desc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const rows = await db.select().from(schema.marketApplyHistory)
    .orderBy(desc(schema.marketApplyHistory.createdAt))
    .limit(100);

  const stores = new Map(
    (await db.select().from(schema.stores)).map((s) => [s.id, s.name] as const),
  );

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Markets apply history</h1>
      <ul className="divide-y border rounded-lg">
        {rows.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">No apply history yet.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">
                  {stores.get(r.storeId) ?? r.storeId}
                  <span className="text-xs text-muted-foreground ml-2">{r.action}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${
                r.status === 'success' ? 'bg-emerald-100 text-emerald-800' :
                r.status === 'partial_error' ? 'bg-amber-100 text-amber-800' :
                'bg-red-100 text-red-800'
              }`}>
                {r.status}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
