import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { getLatestTemplate, saveTemplate } from '@/features/settings-sync/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
type Domain = 'shipping' | 'checkout_buyer_experience';

async function saveAction(domain: Domain, userId: string, formData: FormData) {
  'use server';
  const raw = String(formData.get('payload') ?? '');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Payload must be valid JSON'); }
  await saveTemplate(domain, parsed, userId);
  redirect('/f/settings-sync/templates');
}

export default async function EditTemplatePage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') return <p>Unknown domain.</p>;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'manage_settings_template')) return <p>Forbidden.</p>;

  const current = await getLatestTemplate(domain as Domain);
  const bound = saveAction.bind(null, domain as Domain, session.user.id);

  return (
    <div className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="font-mono">{domain}</CardTitle>
          <CardDescription>
            {current ? `Editing on top of v${current.version} (${new Date(current.createdAt).toLocaleString()}).` : 'Creating the first template version.'} Saving creates a new immutable version.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={bound} className="space-y-4">
            <Textarea
              name="payload"
              rows={24}
              className="font-mono text-xs"
              defaultValue={current ? JSON.stringify(current.payload, null, 2) : '{\n  "zones": {}\n}'}
            />
            <Button type="submit">Save new version</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
