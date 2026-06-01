import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Heart, Gift, Bell, TrendingDown, Sparkles, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { FUNCTIONS } from '@/lib/registry/functions';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const ICONS: Record<string, LucideIcon> = {
  Heart, Gift, Bell, TrendingDown, Sparkles,
};

export default async function FunctionsOverviewPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          Functions
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Storefront functions
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Pluggable, storefront-facing features the operator can apply to any
          connected Shopify store. Each function ships a customer-facing
          experience (e.g. wishlist heart icon, gift registry) plus the
          analytics + automations to support it.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FUNCTIONS.map((fn) => {
          const Icon = ICONS[fn.icon];
          return (
            <Link key={fn.key} href={fn.routes.admin} className="block group">
              <Card className="h-full transition-colors hover:bg-muted/30">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${fn.accent.bg} ${fn.accent.fg}`}>
                      <Icon className="size-5" />
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">{fn.name}</h2>
                    <p className="text-[10px] font-mono text-muted-foreground/80 mt-0.5">
                      v{fn.version}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {fn.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
