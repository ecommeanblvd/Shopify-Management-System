/**
 * Dựng dữ liệu cho modal chi tiết từ các dòng CSDL: tính `xemAnh`, tra tên người, đổi `Date`
 * sang chuỗi ISO cho biên server→client.
 *
 * Tệp RIÊNG, KHÔNG `'use server'`: `actions.ts` mang chỉ thị đó nên mọi export ở đấy phải là
 * server action async — không đặt được một hàm dựng dùng chung. Và trang `/f/bao-loi` cần đúng
 * phép dựng này cho `?bl=`, nên để trong `actions.ts` là chép tay lần hai.
 */
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { AnhBaoLoi } from './anh';
import { xemDuocAnh } from './pham-vi';
import { suKienCuaCacBaoLoi, type BaoLoi } from './queries';
import type { DongBaoLoi, DongSuKien } from '@/components/issue-report/ModalChiTietBaoLoi';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface DuLieuModal {
  dong: DongBaoLoi[];
  suKien: Record<string, DongSuKien[]>;
  /** email → tên, để dòng thời gian hiện tên thay vì email đồng nghiệp. */
  tenNguoi: Record<string, string>;
}

export async function dungDuLieuModal(
  rows: readonly BaoLoi[],
  a: { roleKey: string; userId: string },
): Promise<DuLieuModal> {
  if (rows.length === 0) return { dong: [], suKien: {}, tenNguoi: {} };
  const suKien = await suKienCuaCacBaoLoi(rows.map((r) => r.id));

  /* Gộp email của người báo và của mọi dòng thời gian thành MỘT lượt đọc bảng `user`. */
  const email = new Set<string>();
  for (const r of rows) if (r.reporterEmail) email.add(r.reporterEmail);
  for (const ds of suKien.values()) for (const e of ds) email.add(e.nguoi);
  const tenNguoi: Record<string, string> = {};
  if (email.size > 0) {
    for (const u of await db.select({ email: schema.user.email, name: schema.user.name })
      .from(schema.user).where(inArray(schema.user.email, [...email]))) {
      if (u.name) tenNguoi[u.email] = u.name;
    }
  }

  return {
    tenNguoi,
    dong: rows.map((r) => ({
      id: r.id, so: r.so, module: r.module, pagePath: r.pagePath, title: r.title,
      description: r.description, mucDo: r.mucDo, trangThai: r.trangThai,
      anh: r.anh as AnhBaoLoi[],
      ghiChuXuLy: r.ghiChuXuLy, prUrl: r.prUrl,
      xuLyLanCuoi: iso(r.xuLyLanCuoi), createdAt: r.createdAt.toISOString(),
      tenNguoiBao: r.reporterEmail ? (tenNguoi[r.reporterEmail] ?? null) : null,
      emailNguoiBao: r.reporterEmail,
      // Ảnh siết hơn chữ (thiết kế §11) — tính Ở ĐÂY, client không đọc được cache quyền.
      xemAnh: xemDuocAnh({ roleKey: a.roleKey, laNguoiBao: r.reporterId === a.userId }),
    })),
    suKien: Object.fromEntries([...suKien.entries()].map(([id, ds]) => [
      id, ds.map((e) => ({
        id: e.id, luc: e.luc.toISOString(), nguoi: e.nguoi,
        tuTrangThai: e.tuTrangThai, denTrangThai: e.denTrangThai,
        ghiChu: e.ghiChu, prUrl: e.prUrl,
      })),
    ])),
  };
}
