import Link from 'next/link';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, Play, History } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SettingsSyncHome() {
  await auth.api.getSession({ headers: await headers() });
  const pending = await db.select().from(schema.reconciliationStatus).where(eq(schema.reconciliationStatus.status, 'pending'));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings Sync</h1>
      {pending.length > 0 && (
        <Alert>
          <AlertDescription>
            {pending.length} store/domain pair{pending.length === 1 ? '' : 's'} need reconciliation before applies can run.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { href: '/f/settings-sync/templates', title: 'Templates', desc: 'Manage shipping + checkout templates.', icon: FileText },
          { href: '/f/settings-sync/apply',     title: 'Apply',     desc: 'Preview and apply templates to stores.', icon: Play },
          { href: '/f/settings-sync/history',   title: 'History',   desc: 'View past apply runs and rollback.',    icon: History },
        ].map(({ href, title, desc, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="hover:bg-[var(--color-muted-surface)] transition-colors h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Icon className="size-4" />{title}</CardTitle>
                <CardDescription>{desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
