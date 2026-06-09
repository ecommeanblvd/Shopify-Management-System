'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getUserPermissions, can, refreshRoleCache } from '@/lib/auth/access';
import { isValidKey } from '@/lib/auth/permissions';

async function requireKey(key: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const perms = await getUserPermissions(session.user.id);
  if (!can(perms, key)) throw new Error('Forbidden');
}

export async function createRole(input: { key: string; name: string; description?: string }): Promise<void> {
  await requireKey('users_roles:create');
  await db.insert(schema.appRoles).values({
    key: input.key.trim(), name: input.name.trim(), description: input.description ?? null, isSystem: false,
  });
  await refreshRoleCache();
  revalidatePath('/admin/roles');
}

export async function setRolePermissions(roleId: string, keys: string[]): Promise<void> {
  await requireKey('users_roles:edit');
  const valid = keys.filter((k) => isValidKey(k));
  const [role] = await db.select().from(schema.appRoles).where(eq(schema.appRoles.id, roleId)).limit(1);
  if (!role) throw new Error('Role not found');
  if (role.key === 'admin' && !valid.includes('users_roles:edit')) {
    throw new Error('Không thể bỏ quyền quản lý user của Admin');
  }
  await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
  if (valid.length) {
    await db.insert(schema.rolePermissions).values(valid.map((permissionKey) => ({ roleId, permissionKey })));
  }
  await refreshRoleCache();
  revalidatePath('/admin/roles');
}

export async function deleteRole(roleId: string): Promise<void> {
  await requireKey('users_roles:delete');
  const [role] = await db.select().from(schema.appRoles).where(eq(schema.appRoles.id, roleId)).limit(1);
  if (!role) return;
  if (role.isSystem) throw new Error('Không thể xoá role hệ thống');
  const [assigned] = await db.select({ uid: schema.roles.userId }).from(schema.roles).where(eq(schema.roles.roleId, roleId)).limit(1);
  if (assigned) throw new Error('Còn user đang gán role này — gỡ trước khi xoá');
  await db.delete(schema.appRoles).where(eq(schema.appRoles.id, roleId));
  await refreshRoleCache();
  revalidatePath('/admin/roles');
}
