import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronLeft, FileText, Truck, Wrench, ArrowRight, Plus, Edit3 } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const DOMAIN_META: Record<string, { label: string; desc: string; icon: React.ReactNode }> = {
  shipping: {
    label: 'Shipping',
    desc: 'Zones, countries, and rate definitions pushed via deliveryProfile mutations.',
    icon: <Truck className="size-4" />,
  },
  checkout_buyer_experience: {
    label: 'Checkout branding',
    desc: 'Buyer-facing colors, typography, and form treatments via Checkout Extensibility.',
    icon: <Wrench className="size-4" />,
  },
};

export default async function TemplatesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const canEdit = !!roleRow && hasPermission(roleRow.role as Role, 'manage_settings_template');

  const all = await db.select().from(schema.settingTemplates);
  const latestBy: Record<string, typeof all[number] | undefined> = {};
  for (const t of all) {
    const prev = latestBy[t.domain];
    if (!prev || t.version > prev.version) latestBy[t.domain] = t;
  }

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/settings-sync"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Settings Sync
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FileText className="size-3.5" />
          Templates
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Settings templates</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          One canonical definition per domain. Apply pushes the latest version to each selected store; rollback reverts to the previous one.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['shipping', 'checkout_buyer_experience'] as const).map((domain) => {
          const t = latestBy[domain];
          const meta = DOMAIN_META[domain];
          const exists = !!t;
          return (
            <Card key={domain}>
              <CardContent className="p-6 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={'size-10 rounded-xl flex items-center justify-center ' + (exists ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-semibold tracking-tight">{meta.label}</h2>
                      <div className="text-xs font-mono text-muted-foreground truncate">{domain}</div>
                    </div>
                  </div>
                  <Badge variant={exists ? 'secondary' : 'outline'} className="h-5 text-[10px] uppercase tracking-wider shrink-0">
                    {exists ? `v${t!.version}` : 'Not set'}
                  </Badge>
                </div>

                <p className="text-sm text-muted-foreground">{meta.desc}</p>

                <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {exists
                      ? <>Last updated <span className="text-foreground/80">{new Date(t!.createdAt).toLocaleDateString()}</span></>
                      : 'No template authored yet'}
                  </div>
                  {canEdit && (
                    <Link
                      href={`/f/settings-sync/templates/${domain}/edit`}
                      className={buttonVariants({ variant: exists ? 'outline' : 'default', size: 'sm' }) + ' gap-1.5'}
                    >
                      {exists ? <Edit3 className="size-3.5" /> : <Plus className="size-3.5" />}
                      {exists ? 'Edit' : 'Create'}
                    </Link>
                  )}
                  {!canEdit && exists && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      Read-only
                      <ArrowRight className="size-3" />
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
