import Link from 'next/link';
import { db, schema } from '@/db/client';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const stores = await db.select().from(schema.stores);
  return (
    <main style={{ padding: 24 }}>
      <h1>Shopify Management</h1>
      <p><Link href="/stores/connect">+ Connect a store</Link></p>
      <p><Link href="/f/settings-viewer">Open Settings Viewer</Link></p>
      <h2>Connected stores ({stores.length})</h2>
      <ul>
        {stores.map((s) => (
          <li key={s.id}>{s.name} — {s.shopDomain} — <strong>{s.status}</strong></li>
        ))}
      </ul>
    </main>
  );
}
