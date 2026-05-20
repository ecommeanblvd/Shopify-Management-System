import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const runs = await db.select().from(schema.applyRuns).orderBy(desc(schema.applyRuns.startedAt)).limit(50);
  return (
    <main style={{ padding: 24 }}>
      <h1>Apply history</h1>
      <table>
        <thead><tr><th>When</th><th>Domain</th><th>Stores</th><th>Status</th><th /></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{r.startedAt.toString()}</td>
              <td>{r.domain}</td>
              <td>{r.targetStoreIds.length}</td>
              <td>{r.status}</td>
              <td><Link href={`/f/settings-sync/history/${r.id}`}>Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
