import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { SYSTEM_ROLE_SEEDS } from '@/lib/auth/permission-map';

/** Idempotently create/update seeded roles + their permission keys, and backfill
 *  roles.role_id from the legacy roles.role enum.
 *
 *  ADDITIVE-ONLY: seed là BASELINE tối thiểu — chỉ THÊM key mặc định còn thiếu,
 *  KHÔNG xoá key admin đã cấp thêm trong Settings. (Trước đây delete+reinsert →
 *  mỗi deploy wipe sạch quyền cấp tay — bug "quyền bị reset".) Muốn THU HỒI một
 *  quyền mặc định của system role: bỏ khỏi SYSTEM_ROLE_SEEDS *và* revoke trong
 *  Settings (seed không tự xoá). */
export async function seedRoles(): Promise<void> {
  for (const [key, seed] of Object.entries(SYSTEM_ROLE_SEEDS)) {
    const [existing] = await db.select({ id: schema.appRoles.id }).from(schema.appRoles)
      .where(eq(schema.appRoles.key, key)).limit(1);
    const id = existing?.id ?? (
      await db.insert(schema.appRoles)
        .values({ key, name: seed.name, description: seed.description, isSystem: seed.isSystem })
        .returning({ id: schema.appRoles.id })
    )[0].id;
    if (existing) {
      await db.update(schema.appRoles)
        .set({ name: seed.name, description: seed.description, isSystem: seed.isSystem })
        .where(eq(schema.appRoles.id, id));
    }
    if (seed.keys.length) {
      await db.insert(schema.rolePermissions)
        .values(seed.keys.map((permissionKey) => ({ roleId: id, permissionKey })))
        .onConflictDoNothing();
    }
  }
  const roleIdByKey = new Map<string, string>();
  for (const r of await db.select().from(schema.appRoles)) roleIdByKey.set(r.key, r.id);
  for (const ur of await db.select().from(schema.roles)) {
    if (!ur.roleId && ur.role && roleIdByKey.has(ur.role)) {
      await db.update(schema.roles).set({ roleId: roleIdByKey.get(ur.role)! })
        .where(eq(schema.roles.userId, ur.userId));
    }
  }
}
