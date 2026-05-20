import Link from 'next/link';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import type { Role } from '@/lib/auth/rbac';
import { hasPermission } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <p>Please sign in.</p>;
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  const canEdit = role && hasPermission(role, 'manage_settings_template');

  const all = await db.select().from(schema.settingTemplates);
  const latestBy: Record<string, typeof all[number] | undefined> = {};
  for (const t of all) {
    const prev = latestBy[t.domain];
    if (!prev || t.version > prev.version) latestBy[t.domain] = t;
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Settings Templates</h1>
      {(['shipping', 'checkout_buyer_experience'] as const).map((domain) => {
        const t = latestBy[domain];
        return (
          <section key={domain} style={{ marginTop: 16, padding: 12, border: '1px solid #ddd' }}>
            <h2>{domain}</h2>
            <p>Latest version: {t ? `v${t.version} (${t.createdAt.toString()})` : 'none yet'}</p>
            {canEdit && <Link href={`/f/settings-sync/templates/${domain}/edit`}>Edit</Link>}
          </section>
        );
      })}
    </main>
  );
}
