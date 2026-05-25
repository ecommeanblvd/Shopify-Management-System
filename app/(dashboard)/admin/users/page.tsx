import { eq, asc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users, ShieldCheck } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { canChangeRole, hasPermission, type Role } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
type RoleOrNone = Role | 'none';
const ROLE_OPTIONS: RoleOrNone[] = ['admin', 'operator', 'viewer', 'none'];

async function setRoleAction(callerUserId: string, formData: FormData) {
  'use server';
  const targetUserId = String(formData.get('userId') ?? '');
  const submitted = String(formData.get('role') ?? '') as RoleOrNone;
  if (!targetUserId || !ROLE_OPTIONS.includes(submitted)) return;

  const [callerRoleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, callerUserId)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) return;

  const newRole: Role | null = submitted === 'none' ? null : submitted as Role;
  if (!canChangeRole({ callerUserId, callerRole, targetUserId, newRole })) return;

  const [targetRoleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, targetUserId)).limit(1);
  const currentRole = targetRoleRow?.role as Role | undefined;
  const isNoOp = (newRole === null && !currentRole) || (newRole !== null && currentRole === newRole);
  if (isNoOp) return;

  if (newRole === null) {
    await db.delete(schema.roles).where(eq(schema.roles.userId, targetUserId));
  } else {
    const existing = await db.select().from(schema.roles).where(eq(schema.roles.userId, targetUserId)).limit(1);
    if (existing[0]) {
      await db.update(schema.roles).set({ role: newRole }).where(eq(schema.roles.userId, targetUserId));
    } else {
      await db.insert(schema.roles).values({ userId: targetUserId, role: newRole });
    }
  }

  await recordAudit({
    userId: callerUserId, action: 'change_role', target: targetUserId,
    requestSummary: `role=${submitted}`, result: 'success',
  });
  revalidatePath('/admin/users');
}

function roleBadgeVariant(role: string | null): 'default' | 'secondary' | 'outline' {
  if (role === 'admin') return 'default';
  if (!role) return 'outline';
  return 'secondary';
}

function roleInitial(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return source.slice(0, 1).toUpperCase();
}

export default async function AdminUsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [callerRoleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to manage users.</p>
      </div>
    );
  }

  const rows = await db
    .select({ userId: schema.user.id, email: schema.user.email, name: schema.user.name, role: schema.roles.role, createdAt: schema.user.createdAt })
    .from(schema.user)
    .leftJoin(schema.roles, eq(schema.roles.userId, schema.user.id))
    .orderBy(asc(schema.user.createdAt));

  const setBound = setRoleAction.bind(null, session.user.id);

  const admins = rows.filter((r) => r.role === 'admin').length;
  const operators = rows.filter((r) => r.role === 'operator').length;
  const viewers = rows.filter((r) => r.role === 'viewer').length;
  const none = rows.filter((r) => !r.role).length;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" />
          Administration
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Users &amp; roles</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Assign a role to grant access. Removing a role blocks the user from every feature page; they keep their account but can&rsquo;t see anything.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Admins" value={String(admins)} sub="Full access" />
        <StatTile label="Operators" value={String(operators)} sub="Run features + apply" />
        <StatTile label="Viewers" value={String(viewers)} sub="Read-only" />
        <StatTile label="Pending" value={String(none)} sub={none === 0 ? 'All assigned' : 'No role yet'} tone={none > 0 ? 'warning' : 'default'} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{rows.length} {rows.length === 1 ? 'user' : 'users'}</h2>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const isSelf = r.userId === session.user.id;
              return (
                <li key={r.userId} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-medium shrink-0">
                      {roleInitial(r.name, r.email)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {r.name ?? r.email.split('@')[0]}
                        {isSelf && <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border rounded-full px-1.5 py-0.5">You</span>}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{r.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={roleBadgeVariant(r.role)} className="h-5 text-[10px] uppercase tracking-wider">
                      {r.role ?? 'no role'}
                    </Badge>
                    <form action={setBound} className="flex items-center gap-1.5">
                      <input type="hidden" name="userId" value={r.userId} />
                      <select
                        name="role"
                        defaultValue={r.role ?? 'none'}
                        className="border border-input bg-input/30 rounded-md px-2 py-1 text-xs"
                        disabled={isSelf}
                      >
                        <option value="admin">admin</option>
                        <option value="operator">operator</option>
                        <option value="viewer">viewer</option>
                        <option value="none">none</option>
                      </select>
                      <Button type="submit" size="sm" variant="outline" disabled={isSelf} className="h-7 px-3 text-xs">
                        Save
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label, value, sub, tone = 'default',
}: { label: string; value: string; sub: string; tone?: 'default' | 'warning' }) {
  const c = tone === 'warning' ? 'text-amber-600 dark:text-amber-500' : '';
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${c}`}>{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}
