import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getUserPermissions, can } from '@/lib/auth/access';
import { CATALOG } from '@/lib/auth/permissions';
import { listRoles } from '@/features/users/role-queries';
import { RoleMatrix } from '@/components/admin/RoleMatrix';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const perms = await getUserPermissions(session.user.id);
  if (!can(perms, 'users_roles:view')) redirect('/');
  const roles = await listRoles();
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Roles &amp; Permissions</h1>
        <p className="text-sm text-muted-foreground">Phân quyền theo module × action cho từng role.</p>
      </div>
      <RoleMatrix
        roles={roles}
        catalog={CATALOG}
        canEdit={can(perms, 'users_roles:edit')}
        canCreate={can(perms, 'users_roles:create')}
        canDelete={can(perms, 'users_roles:delete')}
      />
    </div>
  );
}
