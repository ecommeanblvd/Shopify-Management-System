import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { QUYEN_MOI_VAI_TRO, QUYEN_THEO_VAI_NGOAI_HAT_GIONG, SYSTEM_ROLE_SEEDS } from '@/lib/auth/permission-map';

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
  // Nền chung cho MỌI vai trò, gồm vai trò cấp tay trong Settings (vd `OC`) vốn không có
  // hạt giống nào — xem `QUYEN_MOI_VAI_TRO`. Cùng tinh thần THÊM-KHÔNG-XOÁ như trên:
  // `onConflictDoNothing` nên chạy lại bao nhiêu lần cũng không đụng quyền đang có.
  if (QUYEN_MOI_VAI_TRO.length) {
    for (const r of await db.select({ id: schema.appRoles.id }).from(schema.appRoles)) {
      await db.insert(schema.rolePermissions)
        .values(QUYEN_MOI_VAI_TRO.map((permissionKey) => ({ roleId: r.id, permissionKey })))
        .onConflictDoNothing();
    }
  }

  // Quyền cho vai CẤP TAY, khai theo đúng tên vai — xem `QUYEN_THEO_VAI_NGOAI_HAT_GIONG`.
  // Khác `QUYEN_MOI_VAI_TRO` ở trên: cái đó cấp cho MỌI vai, cái này đúng vai được gọi tên,
  // vì có quyền mà câu trả lời đúng KHÔNG phải "ai cũng có" (vd `tao_van_don` không cấp cho
  // `viewer`). Vai không tồn tại thì bỏ qua — seed không tạo vai cấp tay.
  for (const [vai, keys] of Object.entries(QUYEN_THEO_VAI_NGOAI_HAT_GIONG)) {
    if (!keys.length) continue;
    const [r] = await db.select({ id: schema.appRoles.id }).from(schema.appRoles)
      .where(eq(schema.appRoles.key, vai)).limit(1);
    if (!r) continue;
    await db.insert(schema.rolePermissions)
      .values(keys.map((permissionKey) => ({ roleId: r.id, permissionKey })))
      .onConflictDoNothing();
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
