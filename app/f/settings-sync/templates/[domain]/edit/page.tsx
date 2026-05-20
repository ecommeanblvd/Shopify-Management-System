import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import type { Role } from '@/lib/auth/rbac';
import { hasPermission } from '@/lib/auth/rbac';
import { getLatestTemplate, saveTemplate } from '@/features/settings-sync/actions';

export const dynamic = 'force-dynamic';

type Domain = 'shipping' | 'checkout_buyer_experience';

async function save(domain: Domain, userId: string, formData: FormData) {
  'use server';
  const raw = formData.get('payload') as string;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Payload must be valid JSON');
  }
  await saveTemplate(domain, parsed, userId);
  redirect('/f/settings-sync/templates');
}

export default async function EditTemplatePage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') {
    return <p>Unknown domain.</p>;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'manage_settings_template')) return <p>Forbidden.</p>;

  const current = await getLatestTemplate(domain as Domain);

  // Bind domain and userId to the server action
  const boundSave = save.bind(null, domain as Domain, session.user.id);

  return (
    <main style={{ padding: 24 }}>
      <h1>Edit {domain} template</h1>
      <form action={boundSave}>
        <textarea
          name="payload"
          rows={20}
          style={{ width: '100%', fontFamily: 'monospace' }}
          defaultValue={current ? JSON.stringify(current.payload, null, 2) : '{\n  "zones": {}\n}'}
        />
        <button type="submit" style={{ marginTop: 12 }}>Save new version</button>
      </form>
    </main>
  );
}
