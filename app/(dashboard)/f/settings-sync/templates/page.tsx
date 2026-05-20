import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const canEdit = roleRow && hasPermission(roleRow.role as Role, 'manage_settings_template');

  const all = await db.select().from(schema.settingTemplates);
  const latestBy: Record<string, typeof all[number] | undefined> = {};
  for (const t of all) {
    const prev = latestBy[t.domain];
    if (!prev || t.version > prev.version) latestBy[t.domain] = t;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings Templates</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['shipping', 'checkout_buyer_experience'] as const).map((domain) => {
          const t = latestBy[domain];
          return (
            <Card key={domain}>
              <CardHeader>
                <CardTitle className="font-mono text-base">{domain}</CardTitle>
                <CardDescription>{t ? `Latest version: v${t.version}` : 'No template yet'}</CardDescription>
              </CardHeader>
              <CardContent>
                {t && <p className="text-xs text-[var(--color-muted)]">Last updated {new Date(t.createdAt).toLocaleString()}</p>}
                {canEdit && (
                  <Link href={`/f/settings-sync/templates/${domain}/edit`} className={buttonVariants({ variant: 'outline' }) + ' mt-3 inline-flex'}>
                    {t ? 'Edit' : 'Create'}
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
