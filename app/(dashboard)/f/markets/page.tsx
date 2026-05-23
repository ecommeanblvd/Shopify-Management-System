import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listTemplates, seedDefaultMarkets } from '@/features/markets/actions';

export const dynamic = 'force-dynamic';

export default async function MarketsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const markets = await listTemplates();
  const canManage = hasPermission(role, 'manage_markets_template');

  async function handleSeed() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!hasPermission(r, 'manage_markets_template')) throw new Error('forbidden');
    await seedDefaultMarkets(s.user.id);
    revalidatePath('/f/markets');
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Markets</h1>
        <div className="flex gap-3">
          {canManage && markets.length === 0 && (
            <form action={handleSeed}>
              <button
                type="submit"
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Seed default markets
              </button>
            </form>
          )}
          {canManage && (
            <Link
              href="/f/markets/new"
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
            >
              New market
            </Link>
          )}
          <Link
            href="/f/markets/apply"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Apply to stores…
          </Link>
        </div>
      </header>

      {markets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="mb-4">No markets configured.</p>
          {canManage && (
            <p className="text-sm">Click <strong>Seed default markets</strong> to start with the 11 default markets.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((m) => (
            <Link
              key={m.handle}
              href={`/f/markets/${m.handle}`}
              className="rounded-lg border p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">{m.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded ${m.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-zinc-200 text-zinc-700'}`}>
                  {m.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{m.handle}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-secondary">
                  {m.countries.length} {m.countries.length === 1 ? 'country' : 'countries'}
                </span>
                <span className="px-2 py-0.5 rounded bg-secondary">
                  {m.primaryCurrency}
                  {m.alternativeCurrencies.length > 0 && ` + ${m.alternativeCurrencies.length}`}
                </span>
                <span className="px-2 py-0.5 rounded bg-secondary">
                  {m.primaryLanguage.toUpperCase()}
                  {m.alternativeLanguages.length > 0 && ` + ${m.alternativeLanguages.length}`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
