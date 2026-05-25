import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { ChevronLeft, FileText, Save, Info } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { getLatestTemplate, saveTemplate } from '@/features/settings-sync/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
  if (domain !== 'shipping' && domain !== 'checkout_buyer_experience') {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Unknown domain</h1>
        <p className="text-sm text-muted-foreground">Expected <span className="font-mono">shipping</span> or <span className="font-mono">checkout_buyer_experience</span>.</p>
      </div>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'manage_settings_template')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to edit templates.</p>
      </div>
    );
  }

  const current = await getLatestTemplate(domain as Domain);
  const bound = saveAction.bind(null, domain as Domain, session.user.id);

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/settings-sync/templates"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Templates
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FileText className="size-3.5" />
          Template editor
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">{domain}</h1>
          {current && (
            <Badge variant="secondary" className="h-6 text-[10px] uppercase tracking-wider">
              Editing on v{current.version}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground max-w-xl">
          {current
            ? <>Last saved {new Date(current.createdAt).toLocaleString()}. Saving creates a new immutable version — the old one stays available for rollback.</>
            : 'Authoring the first version. Save creates v1.'}
        </p>
      </header>

      <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 px-5 py-3.5 flex items-start gap-3 text-sm">
        <Info className="size-4 shrink-0 mt-0.5" />
        <div>
          Payload must be valid JSON. Shipping uses <span className="font-mono text-xs">{`{ "zones": { … } }`}</span>; checkout follows the buyer-experience schema. Validation runs server-side before saving.
        </div>
      </div>

      <Card>
        <CardContent className="p-6 md:p-8">
          <form action={bound} className="space-y-4">
            <Textarea
              name="payload"
              rows={24}
              className="font-mono text-xs leading-relaxed"
              defaultValue={current ? JSON.stringify(current.payload, null, 2) : '{\n  "zones": {}\n}'}
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Link
                href="/f/settings-sync/templates"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Link>
              <Button type="submit" className="gap-2">
                <Save className="size-4" />
                Save new version
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
