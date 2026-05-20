import { eq, asc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { canChangeRole, hasPermission, type Role } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

export default async function AdminUsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [callerRoleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Forbidden</h1>
        <p className="text-sm">You do not have permission to manage users.</p>
      </div>
    );
  }

  const rows = await db
    .select({ userId: schema.user.id, email: schema.user.email, name: schema.user.name, role: schema.roles.role, createdAt: schema.user.createdAt })
    .from(schema.user)
    .leftJoin(schema.roles, eq(schema.roles.userId, schema.user.id))
    .orderBy(asc(schema.user.createdAt));

  const setBound = setRoleAction.bind(null, session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">Assign a role to grant access. Removing a role blocks the user from every page.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Current role</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isSelf = r.userId === session.user.id;
                return (
                  <TableRow key={r.userId}>
                    <TableCell className="font-mono text-xs">{r.email}</TableCell>
                    <TableCell>{r.name ?? '—'}</TableCell>
                    <TableCell><Badge variant={roleBadgeVariant(r.role)}>{r.role ?? 'none'}</Badge></TableCell>
                    <TableCell>
                      <form action={setBound} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={r.userId} />
                        <select
                          name="role"
                          defaultValue={r.role ?? 'none'}
                          className="border rounded-sm px-2 py-1 text-sm bg-[var(--color-input)]"
                        >
                          <option value="admin">admin</option>
                          <option value="operator" disabled={isSelf}>operator</option>
                          <option value="viewer" disabled={isSelf}>viewer</option>
                          <option value="none" disabled={isSelf}>none</option>
                        </select>
                        <Button type="submit" size="sm" variant="outline">Save</Button>
                        {isSelf && <span className="text-xs text-[var(--color-muted)]">(self — locked)</span>}
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
