import { eq, asc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users, ShieldCheck } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission } from '@/lib/auth/rbac';
import { getRole, invalidateRoleInfo } from '@/lib/auth/role';
import { listRoles, roleGrantsUserManagement, userIdsWhoCanManageUsers } from '@/features/users/role-queries';
import { createInvite, listPendingInvites, revokeInvite } from '@/lib/auth/invites';
import { recordAudit } from '@/lib/logging/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

// Legacy enum values that can be written to roles.role
const LEGACY_KEYS = new Set(['admin', 'operator', 'viewer']);

async function setRoleAction(callerUserId: string, formData: FormData) {
  'use server';
  const targetUserId = String(formData.get('userId') ?? '');
  // submitted value is either an appRole UUID or the sentinel 'none'
  const submitted = String(formData.get('appRoleId') ?? '');
  if (!targetUserId || !submitted) return;

  // Gate: caller must have manage_users
  const callerRoleKey = await getRole(callerUserId);
  if (!hasPermission(callerRoleKey, 'manage_users')) return;

  // Resolve the target appRole (null = remove role)
  const isRemove = submitted === 'none';
  const [appRole] = isRemove
    ? [undefined]
    : await db.select().from(schema.appRoles).where(eq(schema.appRoles.id, submitted)).limit(1);

  if (!isRemove && !appRole) return; // unknown role id

  // Zero-admin invariant: block any change that would remove the last user
  // who holds `users_roles:edit` — covers self-demotion, demoting others,
  // and custom admin-capable roles (not just the literal 'admin' key).
  const newGrantsMgmt = (!isRemove && appRole)
    ? await roleGrantsUserManagement(appRole.id)
    : false;
  if (!newGrantsMgmt) {
    const managers = await userIdsWhoCanManageUsers();
    if (managers.length <= 1 && managers.includes(targetUserId)) {
      throw new Error('Không thể bỏ quyền quản lý user của người cuối cùng có quyền này');
    }
  }

  if (isRemove) {
    await db.delete(schema.roles).where(eq(schema.roles.userId, targetUserId));
  } else {
    // Determine what to write to the legacy role column (enum-constrained).
    // If the new role's key is one of the three legacy values, sync it.
    // Otherwise keep the current legacy value (or fall back to 'viewer').
    const legacyValue = (appRole && LEGACY_KEYS.has(appRole.key))
      ? (appRole.key as 'admin' | 'operator' | 'viewer')
      : await (async () => {
          const [cur] = await db.select({ role: schema.roles.role })
            .from(schema.roles).where(eq(schema.roles.userId, targetUserId)).limit(1);
          return cur?.role ?? 'viewer';
        })();

    const [existing] = await db.select({ userId: schema.roles.userId })
      .from(schema.roles).where(eq(schema.roles.userId, targetUserId)).limit(1);
    if (existing) {
      await db.update(schema.roles)
        .set({ roleId: appRole!.id, role: legacyValue })
        .where(eq(schema.roles.userId, targetUserId));
    } else {
      await db.insert(schema.roles).values({
        userId: targetUserId,
        roleId: appRole!.id,
        role: legacyValue,
      });
    }
  }

  invalidateRoleInfo(targetUserId);
  await recordAudit({
    userId: callerUserId, action: 'change_role', target: targetUserId,
    requestSummary: `appRoleId=${submitted}`, result: 'success',
  });
  revalidatePath('/admin/users');
}

async function inviteUserAction(callerUserId: string, formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const submitted = String(formData.get('appRoleId') ?? 'none');
  if (!email) return;

  const callerRoleKey = await getRole(callerUserId);
  if (!hasPermission(callerRoleKey, 'manage_users')) return;

  const roleId = submitted === 'none' ? null : submitted;
  await createInvite({ email, roleId, invitedByUserId: callerUserId });

  await recordAudit({
    userId: callerUserId, action: 'invite_user', target: email,
    requestSummary: `appRoleId=${submitted}`, result: 'success',
  });
  revalidatePath('/admin/users');
}

async function revokeInviteAction(callerUserId: string, formData: FormData) {
  'use server';
  const inviteId = String(formData.get('inviteId') ?? '');
  if (!inviteId) return;

  const callerRoleKey = await getRole(callerUserId);
  if (!hasPermission(callerRoleKey, 'manage_users')) return;

  await revokeInvite(inviteId);
  await recordAudit({
    userId: callerUserId, action: 'revoke_invite', target: inviteId, result: 'success',
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

  const callerRoleKey = await getRole(session.user.id);
  if (!hasPermission(callerRoleKey, 'manage_users')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to manage users.</p>
      </div>
    );
  }

  const [rows, appRoles, invites] = await Promise.all([
    db
      .select({
        userId: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
        role: schema.roles.role,
        roleId: schema.roles.roleId,
        appRoleKey: schema.appRoles.key,
        appRoleName: schema.appRoles.name,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .leftJoin(schema.roles, eq(schema.roles.userId, schema.user.id))
      .leftJoin(schema.appRoles, eq(schema.appRoles.id, schema.roles.roleId))
      .orderBy(asc(schema.user.createdAt)),
    listRoles(),
    listPendingInvites(),
  ]);

  const setBound = setRoleAction.bind(null, session.user.id);
  const inviteBound = inviteUserAction.bind(null, session.user.id);
  const revokeBound = revokeInviteAction.bind(null, session.user.id);

  // Resolve the current appRole id for display/form default.
  // If roleId is set use it directly; otherwise try matching by legacy key.
  const keyToAppRoleId = new Map(appRoles.map((r) => [r.key, r.id]));

  // Count by resolved app_role key (source of truth), not legacy enum.
  // A user with a custom role (e.g. 'logistics') is counted in 'other', not 'viewer'.
  const admins = rows.filter((r) => r.appRoleKey === 'admin').length;
  const operators = rows.filter((r) => r.appRoleKey === 'operator').length;
  const viewers = rows.filter((r) => r.appRoleKey === 'viewer').length;
  const none = rows.filter((r) => !r.appRoleKey).length;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
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
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Mời người dùng</h2>
          </div>
          <form action={inviteBound} className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="invite-email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder="nguoi-moi@example.com"
                className="w-full border border-input bg-input/30 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="invite-role" className="text-xs uppercase tracking-wider text-muted-foreground">Role</label>
              <select
                id="invite-role"
                name="appRoleId"
                defaultValue="none"
                className="border border-input bg-input/30 rounded-md px-2 py-2 text-sm"
              >
                <option value="none">— chưa gán role —</option>
                {appRoles.map((ar) => (
                  <option key={ar.id} value={ar.id}>{ar.name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" className="h-9">Gửi lời mời</Button>
          </form>

          {invites.length > 0 && (
            <ul className="divide-y divide-border border-t border-border pt-2">
              {invites.map((inv) => (
                <li key={inv.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.roleName ?? 'chưa gán role'} · mời bởi {inv.invitedByEmail ?? '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">pending</Badge>
                    <form action={revokeBound}>
                      <input type="hidden" name="inviteId" value={inv.id} />
                      <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">Thu hồi</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{rows.length} {rows.length === 1 ? 'user' : 'users'}</h2>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const isSelf = r.userId === session.user.id;
              // The form value to pre-select: current appRole id (from join), or 'none'
              const currentAppRoleId = r.roleId ?? (r.role ? keyToAppRoleId.get(r.role) : undefined) ?? 'none';
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
                    <Badge variant={roleBadgeVariant(r.appRoleKey ?? null)} className="h-5 text-[10px] uppercase tracking-wider">
                      {r.appRoleName ?? 'no role'}
                    </Badge>
                    <form action={setBound} className="flex items-center gap-1.5">
                      <input type="hidden" name="userId" value={r.userId} />
                      <select
                        name="appRoleId"
                        defaultValue={currentAppRoleId}
                        className="border border-input bg-input/30 rounded-md px-2 py-1 text-xs"
                        disabled={isSelf}
                      >
                        {appRoles.map((ar) => (
                          <option key={ar.id} value={ar.id}>{ar.name}</option>
                        ))}
                        <option value="none">— remove role —</option>
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
