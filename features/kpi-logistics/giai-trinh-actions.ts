'use server';

/**
 * Lưu / xoá giải trình đơn âm cước (tiêu chí 1.1). Quyền = quyền đối soát phí ship, cùng quyền
 * gán lý do giao chậm — đó là vị trí đang làm đối soát (CEO 16/09/2026).
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { layLyDoAmCuoc, quyTrachNhiem, type ChiTietGiaiTrinh, type MaLyDoAmCuoc } from './giai-trinh-am-cuoc';

async function quyen(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) throw new Error('Không có quyền giải trình đơn âm cước');
  return session.user.id;
}

/** Chỉ giữ ô đúng kiểu — không tin dữ liệu gửi lên từ trình duyệt. */
function lamSach(ct: ChiTietGiaiTrinh): ChiTietGiaiTrinh {
  const soDuong = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const chu = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null);
  const trongDs = <T extends string>(v: unknown, ds: readonly T[]): T | null => (ds.includes(v as T) ? (v as T) : null);
  return {
    soDo: soDuong(ct.soDo),
    skuCanSua: chu(ct.skuCanSua),
    phiVnd: soDuong(ct.phiVnd),
    nguonSaiDiaChi: trongDs(ct.nguonSaiDiaChi, ['khach', 'noi_bo', 'chua_ro'] as const),
    lyDoTach: trongDs(ct.lyDoTach, ['thieu_hang', 'khach_yeu_cau', 'do_kich_thuoc', 'chua_ro'] as const),
    soTienDoiVnd: soDuong(ct.soTienDoiVnd),
    lineHnc: ct.lineHnc === true,
  };
}

export async function luuGiaiTrinhAmCuoc(input: {
  orderId: string; lyDo: MaLyDoAmCuoc; chiTiet: ChiTietGiaiTrinh; ghiChu: string | null;
}): Promise<{ ok: true; thuocVe: string }> {
  const userId = await quyen();
  if (!layLyDoAmCuoc(input.lyDo)) throw new Error('Lý do không hợp lệ');
  const ghiChu = input.ghiChu?.trim() || null;
  if (input.lyDo === 'khac' && !ghiChu) throw new Error('Chọn "Khác" thì phải ghi rõ ở ghi chú');
  const chiTiet = lamSach(input.chiTiet);
  // Trách nhiệm do hệ thống quy, không nhận từ trình duyệt.
  const thuocVe = quyTrachNhiem(input.lyDo, chiTiet);
  const gia = { lyDo: input.lyDo, thuocVe, chiTiet, ghiChu, nguon: 'tay', updatedBy: userId, updatedAt: new Date() };
  await db.insert(schema.amCuocGiaiTrinh)
    .values({ orderId: input.orderId, ...gia, createdBy: userId })
    .onConflictDoUpdate({ target: schema.amCuocGiaiTrinh.orderId, set: gia });
  revalidatePath('/f/ship-report');
  revalidatePath('/f/kpi-logistics');
  return { ok: true, thuocVe };
}

export async function xoaGiaiTrinhAmCuoc(orderId: string): Promise<{ ok: true }> {
  await quyen();
  await db.delete(schema.amCuocGiaiTrinh).where(eq(schema.amCuocGiaiTrinh.orderId, orderId));
  revalidatePath('/f/ship-report');
  revalidatePath('/f/kpi-logistics');
  return { ok: true };
}
