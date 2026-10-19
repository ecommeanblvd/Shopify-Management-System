/**
 * MỜI người dùng vào hệ thống theo email, kèm vai trò.
 *
 *   railway run npx tsx scripts/moi-nguoi-dung.ts --vai-tro=operator a@x.com b@y.com
 *   railway run npx tsx scripts/moi-nguoi-dung.ts --vai-tro=operator a@x.com --ap-dung
 *
 * Lời mời KHÔNG tự cấp quyền: nó chỉ chờ sẵn: người được mời đăng nhập Google bằng đúng email
 * đó thì mới thành tài khoản và nhận vai trò (xem `lib/auth/invites.ts`). Chưa đăng nhập thì
 * không có gì xảy ra, và thu hồi lời mời là xong.
 *
 * Dùng LẠI `createInvite` chứ không tự ghi bảng: hàm đó chuẩn hoá email và idempotent theo
 * email (mời lại người đã mời thì mở lại lời mời cũ, không đẻ dòng thứ hai). Tự `INSERT` ở
 * đây là dựng định nghĩa "mời" thứ hai, lệch lúc nào không biết.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { createInvite, findPendingInvite } from '@/lib/auth/invites';
import { user } from '@/db/auth-schema';

const args = process.argv.slice(2);
const APDUNG = args.includes('--ap-dung');
const vaiTro = args.find((a) => a.startsWith('--vai-tro='))?.slice(10);
const emails = args.filter((a) => !a.startsWith('--')).map((e) => e.trim()).filter(Boolean);
/** Người đứng tên mời — mặc định là chủ hệ thống. */
const NGUOI_MOI = process.env.EMAIL_NGUOI_MOI ?? 'lmtiep@gmail.com';

async function main() {
  if (!vaiTro || emails.length === 0) {
    console.error('Dùng: moi-nguoi-dung.ts --vai-tro=<khoá> <email...> [--ap-dung]');
    process.exit(1);
  }
  const [vt] = await db.select({ id: schema.appRoles.id, ten: schema.appRoles.name, boPhan: schema.appRoles.boPhan })
    .from(schema.appRoles).where(eq(schema.appRoles.key, vaiTro)).limit(1);
  if (!vt) {
    const ds = await db.select({ key: schema.appRoles.key, ten: schema.appRoles.name }).from(schema.appRoles);
    console.error(`Không có vai trò "${vaiTro}". Các vai trò đang có: ${ds.map((x) => `${x.key} (${x.ten})`).join(', ')}`);
    process.exit(1);
  }
  const [nm] = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, NGUOI_MOI)).limit(1);
  if (!nm) { console.error(`Không tìm thấy người mời ${NGUOI_MOI}`); process.exit(1); }

  console.log(`Vai trò: ${vaiTro} — ${vt.ten}${vt.boPhan ? ` · bộ phận ${vt.boPhan}` : ''}`);
  console.log(`Người đứng tên mời: ${nm.email}\n`);

  for (const email of emails) {
    const [daCo] = await db.select({ id: user.id, ten: user.name }).from(user).where(eq(user.email, email)).limit(1);
    const moi = await findPendingInvite(email);
    const tinh = daCo
      ? `ĐÃ CÓ TÀI KHOẢN (${daCo.ten ?? '—'}) — lời mời không đổi vai trò người đã vào, phải sửa ở màn phân quyền`
      : moi ? 'đã có lời mời đang chờ — sẽ ghi đè vai trò mới' : 'chưa có gì — sẽ tạo lời mời mới';
    console.log(`${email.padEnd(34)} ${tinh}`);
    if (APDUNG && !daCo) {
      await createInvite({ email, roleId: vt.id, invitedByUserId: nm.id });
      console.log(`${''.padEnd(34)} ✓ đã tạo lời mời`);
    }
  }
  console.log(APDUNG ? '\n=== ĐÃ GHI ===' : '\n=== CHẠY THỬ — chưa ghi gì. Thêm --ap-dung để tạo thật. ===');
  process.exit(0);
}
main();
