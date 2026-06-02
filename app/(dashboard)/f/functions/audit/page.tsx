import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronLeft, ScrollText, ToggleLeft, Settings, Sparkles } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FUNCTIONS } from '@/lib/registry/functions';
import { listAuditEntries, type AuditEntry } from '@/features/functions/audit-log';

export const dynamic = 'force-dynamic';

const ACTION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; accent: string }> = {
  toggle: { label: 'Toggle', icon: ToggleLeft, accent: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  config_update: { label: 'Config update', icon: Settings, accent: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
};

function functionDisplay(key: string): string {
  return FUNCTIONS.find((f) => f.key === key)?.name ?? key;
}

function formatTime(d: Date): string {
  try {
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return d.toISOString(); }
}

function describePayload(entry: AuditEntry): string {
  const p = entry.payload as Record<string, unknown> | null;
  if (!p) return '';
  if (entry.action === 'toggle' && typeof p.from === 'boolean' && typeof p.to === 'boolean') {
    if (p.from === p.to) return `unchanged (${p.to ? 'on' : 'off'})`;
    return p.to ? 'turned on' : 'turned off';
  }
  if (entry.action === 'config_update') return 'updated settings';
  return '';
}

export default async function FunctionsAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ fn?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const sp = await searchParams;
  const fnFilter = sp.fn?.trim() || undefined;
  const entries = await listAuditEntries({ functionKey: fnFilter, limit: 200 });

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <Link
        href="/f/functions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Functions
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <ScrollText className="size-3.5" />
          Audit log
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Functions audit log</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every operator action on a function &mdash; toggles, settings
          updates &mdash; is recorded here with the user, the store, and
          the before/after state. Append-only.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterPill href="/f/functions/audit" active={!fnFilter} label="All functions" icon={<Sparkles className="size-3" />} />
        {FUNCTIONS.map((fn) => (
          <FilterPill
            key={fn.key}
            href={`/f/functions/audit?fn=${encodeURIComponent(fn.key)}`}
            active={fnFilter === fn.key}
            label={fn.name}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {fnFilter ? `${functionDisplay(fnFilter)} entries` : 'All entries'}
            </h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {entries.length}{entries.length === 200 ? '+' : ''}
            </Badge>
          </div>
          {entries.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No audit entries yet. Toggle a function or update its settings to see one here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((e) => {
                const meta = ACTION_META[e.action] ?? {
                  label: e.action,
                  icon: ScrollText,
                  accent: 'text-muted-foreground bg-muted',
                };
                const Icon = meta.icon;
                return (
                  <li key={e.id} className="px-5 py-3 flex items-center gap-4">
                    <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${meta.accent}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{meta.label}</span>
                        <Badge variant="outline" className="h-4 text-[9px] font-mono">
                          {functionDisplay(e.functionKey)}
                        </Badge>
                        {describePayload(e) && (
                          <span className="text-xs text-muted-foreground">{describePayload(e)}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {e.storeName ? (
                          <>
                            <span className="font-medium">{e.storeName}</span>
                            <span className="font-mono ml-1.5">{e.shopDomain}</span>
                          </>
                        ) : (
                          <span className="italic">no store</span>
                        )}
                        <span className="mx-1.5">·</span>
                        <span>{e.actorEmail ?? <span className="italic">system</span>}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono tabular-nums shrink-0 text-right">
                      {formatTime(e.createdAt)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterPill({
  href, active, label, icon,
}: { href: string; active: boolean; label: string; icon?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ' +
        (active
          ? 'bg-foreground text-background border-foreground'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40')
      }
    >
      {icon}
      {label}
    </Link>
  );
}
