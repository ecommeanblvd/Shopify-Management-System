/**
 * CẤP quyền `fulfillment.logistics:create` (quyền app-level `tao_van_don`) cho bốn vai
 * admin · logistics · OC · operator, và DỌN hai khoá chết `fulfillment.logistics:view`
 * / `:delete` khỏi `role_permissions`.
 *
 *   npx dotenv -- npx tsx scripts/quyen-tao-van-don.ts                    # CHẠY THỬ, không ghi gì
 *   npx dotenv -- npx tsx scripts/quyen-tao-van-don.ts --ap-dung          # cấp quyền (BƯỚC 1)
 *   npx dotenv -- npx tsx scripts/quyen-tao-van-don.ts --don-o-chet            # chạy thử bước dọn
 *   npx dotenv -- npx tsx scripts/quyen-tao-van-don.ts --don-o-chet --ap-dung  # dọn thật (BƯỚC CUỐI)
 *
 * VÌ SAO có script thay vì gõ SQL tay: thao tác này đổi ai-làm-được-gì trên hệ thống đang
 * chạy, nên phải chạy lại được (idempotent) và phải để lại dấu vết đọc được trong repo.
 *
 * THỨ TỰ ÁP BẮT BUỘC — sai là 6 người mất việc giữa ca:
 *   1. Chạy `--ap-dung` (cấp quyền) TRƯỚC khi deploy mã đổi cổng. Lúc đó chưa chỗ nào kiểm
 *      `fulfillment.logistics:create` nên cấp sớm là vô hại hoàn toàn. Đo 21/10/2026: vai
 *      `OC` (1 người) và `operator` (5 người) đang tạo vận đơn được NHỜ
 *      `fulfillment.operations:edit` mà KHÔNG có `fulfillment.logistics:create` — mã lên
 *      trước quyền thì cổng mới chặn đúng 6 người này ngay lúc deploy.
 *   2. Kiểm bằng chính script này (phần "SAU KHI CẤP" của báo cáo) rằng đủ 4 vai đã có.
 *   3. Rồi mới deploy mã đổi cổng.
 *   4. `--don-o-chet` chạy SAU CÙNG, sau khi (3) đã lên: `:view`/`:delete` là dòng mồ côi
 *      (không chỗ nào kiểm) nên xoá sớm cũng không sao, nhưng xoá NHẦM `:create` thì hỏng —
 *      vì vậy bước dọn tách riêng sau một cờ khác, và chỉ liệt kê đúng hai khoá cần xoá.
 *
 * Vì sao không dùng `QUYEN_MOI_VAI_TRO`: cơ chế đó cấp cho MỌI vai, kể cả `viewer` — mà
 * quyền này CỐ Ý không cấp cho `viewer` (CEO 21/10/2026 chỉ nói logistics và operator).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const APDUNG = process.argv.includes('--ap-dung');
const DON_O_CHET = process.argv.includes('--don-o-chet');

/** Khoá quyền mới — đúng ô `fulfillment.logistics:create` đang chết, không đẻ khoá mới. */
const KHOA_TAO_VAN_DON = 'fulfillment.logistics:create';

/** Bốn vai được cấp. KHÔNG có `viewer` — người chỉ-xem không được nhập mã vận đơn.
 *  `OC` cấp TAY trên production, không nằm trong `SYSTEM_ROLE_SEEDS`, nên chỉ script này
 *  (và `QUYEN_THEO_VAI_NGOAI_HAT_GIONG` trong permission-map.ts) với tới được nó. */
const VAI_DUOC_CAP = ['admin', 'logistics', 'OC', 'operator'] as const;

/** Hai ô chết bỏ khỏi danh mục: không chỗ nào trong hệ thống kiểm chúng. Dọn THEO KHOÁ,
 *  KHÔNG theo vai: đo 21/10/2026 `:delete` nằm ở `admin` + `logistics`, còn `:view` nằm ở
 *  `admin` + `logistics` + `OC` — dọn theo vai là bỏ sót đúng vai cấp tay. */
const KHOA_CHET = ['fulfillment.logistics:view', 'fulfillment.logistics:delete'];

async function main() {
  const vai = await db.select().from(schema.appRoles);
  const idTheoKhoa = new Map(vai.map((r) => [r.key, r.id]));
  const khoaTheoId = new Map(vai.map((r) => [r.id, r.key]));

  if (DON_O_CHET) {
    const canXoa = await db.select().from(schema.rolePermissions)
      .where(inArray(schema.rolePermissions.permissionKey, KHOA_CHET));
    console.log(`DỌN Ô CHẾT — ${KHOA_CHET.join(' · ')}`);
    console.log(`Tìm thấy ${canXoa.length} dòng mồ côi:`);
    for (const d of canXoa) {
      console.log(`  - vai ${khoaTheoId.get(d.roleId) ?? d.roleId} : ${d.permissionKey}`);
    }
    // Khẳng định AN TOÀN: `:create` không được nằm trong danh sách xoá. Hai khoá chỉ khác
    // nhau một từ, và xoá nhầm `:create` là gỡ đúng quyền vừa cấp.
    if (KHOA_CHET.includes(KHOA_TAO_VAN_DON)) {
      throw new Error(`CHẶN: ${KHOA_TAO_VAN_DON} lọt vào danh sách xoá`);
    }
    const conLai = await db.select().from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.permissionKey, KHOA_TAO_VAN_DON));
    console.log(`\n${KHOA_TAO_VAN_DON} hiện có ở ${conLai.length} vai: ${
      conLai.map((d) => khoaTheoId.get(d.roleId) ?? d.roleId).sort().join(', ')} (KHÔNG xoá)`);
    if (!APDUNG) {
      console.log('\n=== CHẠY THỬ — KHÔNG ghi gì. Thêm --ap-dung để xoá thật. ===');
      process.exit(0);
    }
    if (canXoa.length) {
      await db.delete(schema.rolePermissions)
        .where(inArray(schema.rolePermissions.permissionKey, KHOA_CHET));
    }
    const sot = await db.select().from(schema.rolePermissions)
      .where(inArray(schema.rolePermissions.permissionKey, KHOA_CHET));
    console.log(`\n✓ ĐÃ XOÁ ${canXoa.length} dòng. Còn sót: ${sot.length}`);
    const giuLai = await db.select().from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.permissionKey, KHOA_TAO_VAN_DON));
    console.log(`✓ ${KHOA_TAO_VAN_DON} vẫn ở ${giuLai.length} vai: ${
      giuLai.map((d) => khoaTheoId.get(d.roleId) ?? d.roleId).sort().join(', ')}`);
    process.exit(0);
  }

  console.log(`CẤP ${KHOA_TAO_VAN_DON} (tao_van_don) cho: ${VAI_DUOC_CAP.join(' · ')}`);
  console.log('(KHÔNG cấp cho viewer — cố ý.)\n');

  const thieuVai = VAI_DUOC_CAP.filter((k) => !idTheoKhoa.has(k));
  if (thieuVai.length) {
    // Hỏng ỒN ÀO: vai không tồn tại thì người của vai đó sẽ mất cổng lúc deploy mã mới,
    // và đó đúng là thứ phải thấy TRƯỚC, không phải sau.
    throw new Error(`CHẶN: không tìm thấy vai ${thieuVai.join(', ')} trong app_roles`);
  }

  const daCo = new Set((await db.select().from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.permissionKey, KHOA_TAO_VAN_DON)))
    .map((d) => khoaTheoId.get(d.roleId) ?? ''));

  console.log('TRƯỚC:');
  for (const k of VAI_DUOC_CAP) console.log(`  ${daCo.has(k) ? 'CÓ SẴN' : 'THIẾU '} ${k}`);
  const canCap = VAI_DUOC_CAP.filter((k) => !daCo.has(k));
  console.log(`\nCần cấp cho ${canCap.length} vai: ${canCap.join(', ') || '(không vai nào)'}`);

  if (!APDUNG) {
    console.log('\n=== CHẠY THỬ — KHÔNG ghi gì. Thêm --ap-dung để cấp thật. ===');
    process.exit(0);
  }

  if (canCap.length) {
    // `onConflictDoNothing`: chạy lại bao nhiêu lần cũng không đụng gì đang có, cùng tinh
    // thần THÊM-KHÔNG-XOÁ của `seedRoles()`.
    await db.insert(schema.rolePermissions)
      .values(canCap.map((k) => ({ roleId: idTheoKhoa.get(k)!, permissionKey: KHOA_TAO_VAN_DON })))
      .onConflictDoNothing();
  }

  console.log('\nSAU KHI CẤP (đọc lại từ CSDL):');
  let duCa4 = true;
  for (const k of VAI_DUOC_CAP) {
    const [co] = await db.select().from(schema.rolePermissions).where(and(
      eq(schema.rolePermissions.roleId, idTheoKhoa.get(k)!),
      eq(schema.rolePermissions.permissionKey, KHOA_TAO_VAN_DON),
    )).limit(1);
    if (!co) duCa4 = false;
    console.log(`  ${co ? '✓ CÓ   ' : '✗ THIẾU'} ${k}`);
  }
  // `viewer` phải vẫn KHÔNG có — kiểm thẳng, không suy ra từ việc "mình không cấp".
  const idViewer = idTheoKhoa.get('viewer');
  if (idViewer) {
    const [vco] = await db.select().from(schema.rolePermissions).where(and(
      eq(schema.rolePermissions.roleId, idViewer),
      eq(schema.rolePermissions.permissionKey, KHOA_TAO_VAN_DON),
    )).limit(1);
    console.log(`  ${vco ? '✗ LỖI: viewer CÓ quyền này' : '✓ viewer KHÔNG có (đúng)'}`);
    if (vco) duCa4 = false;
  }
  console.log(duCa4 ? '\n✓ ĐỦ 4 VAI — an toàn deploy mã đổi cổng.' : '\n✗ CHƯA ĐỦ — ĐỪNG deploy mã đổi cổng.');
  process.exit(duCa4 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
