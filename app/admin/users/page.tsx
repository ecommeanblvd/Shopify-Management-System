import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { canChangeRole, hasPermission, type Role } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';

export const dynamic = 'force-dynamic';

type RoleOrNone = Role | 'none';
const ROLE_OPTIONS: RoleOrNone[] = ['admin', 'operator', 'viewer', 'none'];

async function setRoleAction(callerUserId: string, formData: FormData) {
  'use server';
  const targetUserId = String(formData.get('userId') ?? '');
  const submitted = String(formData.get('role') ?? '') as RoleOrNone;
  if (!targetUserId || !ROLE_OPTIONS.includes(submitted)) return;

  const [callerRoleRow] = await db.select().from(schema.roles)
    .where(eq(schema.roles.userId, callerUserId)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) return;

  const newRole: Role | null = submitted === 'none' ? null : submitted as Role;
  if (!canChangeRole({ callerUserId, callerRole, targetUserId, newRole })) return;

  if (newRole === null) {
    await db.delete(schema.roles).where(eq(schema.roles.userId, targetUserId));
  } else {
    const existing = await db.select().from(schema.roles)
      .where(eq(schema.roles.userId, targetUserId)).limit(1);
    if (existing[0]) {
      await db.update(schema.roles).set({ role: newRole })
        .where(eq(schema.roles.userId, targetUserId));
    } else {
      await db.insert(schema.roles).values({ userId: targetUserId, role: newRole });
    }
  }

  await recordAudit({
    userId: callerUserId,
    action: 'change_role',
    target: targetUserId,
    requestSummary: `role=${submitted}`,
    result: 'success',
  });
}

export default async function AdminUsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [callerRoleRow] = await db.select().from(schema.roles)
    .where(eq(schema.roles.userId, session.user.id)).limit(1);
  const callerRole = callerRoleRow?.role as Role | undefined;
  if (!callerRole || !hasPermission(callerRole, 'manage_users')) {
    return <p>Forbidden.</p>;
  }

  const rows = await db
    .select({
      userId: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      role: schema.roles.role,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .leftJoin(schema.roles, eq(schema.roles.userId, schema.user.id))
    .orderBy(asc(schema.user.createdAt));

  const setBound = setRoleAction.bind(null, session.user.id);

  return (
    <main style={{ padding: 24 }}>
      <h1>Users</h1>
      <p style={{ color: '#666' }}>
        Assign a role to grant access. Removing a role blocks the user from every page.
      </p>
      <table>
        <thead>
          <tr>
            <th align="left">Email</th>
            <th align="left">Name</th>
            <th align="left">Current role</th>
            <th align="left">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelf = r.userId === session.user.id;
            return (
              <tr key={r.userId}>
                <td>{r.email}</td>
                <td>{r.name ?? '—'}</td>
                <td>{r.role ?? <em style={{ color: '#999' }}>none</em>}</td>
                <td>
                  <form action={setBound} style={{ display: 'inline-flex', gap: 8 }}>
                    <input type="hidden" name="userId" value={r.userId} />
                    <select name="role" defaultValue={r.role ?? 'none'}>
                      <option value="admin">admin</option>
                      <option value="operator" disabled={isSelf}>operator</option>
                      <option value="viewer" disabled={isSelf}>viewer</option>
                      <option value="none" disabled={isSelf}>none</option>
                    </select>
                    <button type="submit">Save</button>
                    {isSelf && <span style={{ color: '#999', marginLeft: 8 }}>(self — locked)</span>}
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
