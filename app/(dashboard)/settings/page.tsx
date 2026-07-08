import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ArrowRight, Settings as SettingsIcon } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { SETTINGS_ITEMS, SETTINGS_GROUPS, type SettingsNavItem } from '@/lib/nav';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }

  const visible = SETTINGS_ITEMS.filter((item) => hasPermission(role, item.requires));
  const groups = SETTINGS_GROUPS
    .map((group) => ({ group, items: visible.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <SettingsIcon className="size-3.5" />
          Settings
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Configuration and admin modules you set up once or check occasionally.
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here you can access.</p>
      ) : (
        groups.map(({ group, items }) => (
          <section key={group} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{group}</h2>
            <Card>
              <CardContent className="p-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => <SettingsLink key={item.href} item={item} />)}
              </CardContent>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}

function SettingsLink({ item }: { item: SettingsNavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors"
    >
      <div className="size-8 rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary flex items-center justify-center transition-colors">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{item.label}</div>
        <div className="text-xs text-muted-foreground leading-tight mt-0.5">{item.description}</div>
      </div>
      <ArrowRight className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}
