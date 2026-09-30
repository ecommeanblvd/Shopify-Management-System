'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { layLyDo, duyetTayDuoc } from './ly-do-cham';
import { dongBiKhoa, type TrangThaiNop } from '@/features/kpi-logistics/nop-1-2';
import { doiChieuLyDoCham } from './doi-chieu-ly-do';

/** Kiện thuộc luồng nào — quyết định ghi vào bảng nào. */
export type NguonKien = 'shopify' | 'ship_ho';

async function chuanBi(lyDo: string | null): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) throw new Error('Không có quyền gán lý do giao chậm');
  if (lyDo != null && !layLyDo(lyDo)) throw new Error('Lý do không hợp lệ');
  return session.user.id;
}

/**
 * CHẶN sửa lý do khi kỳ đã gửi đi duyệt (CEO 30/09/2026).
 *
 * Kiểm ở MÁY CHỦ chứ không chỉ khoá ô trên màn: ẩn nút mà hành động vẫn gọi được thì chưa phải
 * là khoá. Dòng được quản lý TRẢ LẠI vẫn sửa được — trả lại chính là mở khoá đúng chỗ cần sửa.
 */
async function chanKhiDaKhoa(nguon: NguonKien, id: string): Promise<void> {
  const { rows } = await (nguon === 'ship_ho'
    ? db.execute<{ ky: string | null; tra: string | null }>(sql`
        SELECT to_char(shipped_at, 'YYYY-MM') AS ky, ly_do_tra_lai AS tra FROM ship_ho_orders WHERE id = ${id}`)
    : db.execute<{ ky: string | null; tra: string | null }>(sql`
        SELECT to_char(label_created_at, 'YYYY-MM') AS ky, ly_do_tra_lai AS tra FROM shipments WHERE id = ${id}`));
  const r = rows[0];
  // Kiện chưa có ngày gửi thì không thuộc kỳ nào để mà khoá.
  if (!r?.ky) return;
  const [kyRow] = await db.select().from(schema.kpi12Nop).where(eq(schema.kpi12Nop.ky, r.ky));
  const trangThai = (kyRow?.trangThai as TrangThaiNop) ?? 'dang_lam';
  if (!dongBiKhoa(trangThai, r.tra != null)) return;
  throw new Error(trangThai === 'da_duyet'
    ? `Kỳ ${r.ky} đã duyệt xong — lý do đã chốt, muốn sửa thì quản lý phải mở lại kỳ`
    : `Kỳ ${r.ky} đang chờ quản lý duyệt nên các ô đã khoá. Quản lý trả lại dòng này thì mới sửa được`);
}

/**
 * Gán / bỏ lý do giao chậm cho một kiện. Ops có quyền đối soát phí ship là gán được.
 *
 * Nhận cả hai luồng: kiện Shopify ghi vào `shipments`, kiện ship hộ ghi vào `ship_ho_orders`.
 * Hai bảng, cùng bộ bốn cột, cùng một danh mục lý do — vì tiêu chí 1.2 chấm chung cả hai thì
 * cũng phải cho giải trình chung cả hai (CEO 14/09/2026).
 */
export async function datLyDoCham(input: {
  shipmentId: string; lyDo: string | null; ghiChu?: string | null; nguon?: NguonKien;
}): Promise<{ ok: true }> {
  const userId = await chuanBi(input.lyDo);
  await chanKhiDaKhoa(input.nguon ?? 'shopify', input.shipmentId);
  const gia = {
    // Đổi lý do là phải đối chiếu lại từ đầu — kết quả cũ thuộc về lý do cũ.
    lyDoDoiChieu: null, lyDoBangChung: null, lyDoDoiChieuAt: null,
    // ...và quyết định duyệt tay cũng thuộc về lý do cũ. Giữ lại là để một lượt duyệt cho
    // "khách hẹn lại" tự động hợp thức hoá một lý do khác hẳn được gán sau đó.
    lyDoDuyet: null, lyDoDuyetGhiChu: null, lyDoDuyetBoi: null, lyDoDuyetAt: null,
    lyDoCham: input.lyDo,
    lyDoChamGhiChu: input.lyDo == null ? null : (input.ghiChu?.trim() || null),
    lyDoChamBy: input.lyDo == null ? null : userId,
    lyDoChamAt: input.lyDo == null ? null : new Date(),
  };
  if (input.nguon === 'ship_ho') {
    await db.update(schema.shipHoOrders).set(gia).where(eq(schema.shipHoOrders.id, input.shipmentId));
  } else {
    await db.update(schema.shipments).set(gia).where(eq(schema.shipments.id, input.shipmentId));
  }

  // Đối chiếu NGAY với FedEx để người gán thấy kết quả liền, không phải chờ lượt cron.
  // Lỗi mạng / thiếu khoá thì bỏ qua — cron sẽ làm lại.
  if (input.lyDo) {
    try { await doiChieuLyDoCham({ chi: { nguon: input.nguon ?? 'shopify', id: input.shipmentId } }); }
    catch (e) { console.error('[ly-do] đối chiếu ngay lỗi, để cron làm lại:', (e as Error).message); }
  }

  revalidatePath('/f/ship-report');
  revalidatePath('/f/kpi-logistics');
  return { ok: true };
}

/**
 * DUYỆT TAY một kiện mà máy không kiểm được (CEO 29/09/2026).
 *
 * Chỉ ADMIN, và chỉ ở đúng chỗ máy mù: `duyetTayDuoc` chặn cả ca hãng đã tra và không thấy dấu
 * hiệu nào khớp — bằng chứng ngược thì người không được phép nói khác. Kiểm lại trạng thái NGAY
 * TRƯỚC KHI GHI, không tin vào thứ giao diện gửi lên: giao diện có thể đã cũ vài phút, và trong
 * khoảng đó cron có thể đã tra ra kết quả thật.
 */
export async function duyetLyDoCham(input: {
  shipmentId: string; nguon?: NguonKien; quyetDinh: 'duyet' | 'tu_choi'; ghiChu?: string | null;
}): Promise<{ ok: true }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin') throw new Error('Chỉ quản lý được duyệt lý do giao chậm');
  if (input.quyetDinh !== 'duyet' && input.quyetDinh !== 'tu_choi') throw new Error('Quyết định không hợp lệ');

  const shipHo = input.nguon === 'ship_ho';
  const [kien] = shipHo
    ? await db.select({ lyDo: schema.shipHoOrders.lyDoCham, doiChieu: schema.shipHoOrders.lyDoDoiChieu })
        .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, input.shipmentId)).limit(1)
    : await db.select({ lyDo: schema.shipments.lyDoCham, doiChieu: schema.shipments.lyDoDoiChieu })
        .from(schema.shipments).where(eq(schema.shipments.id, input.shipmentId)).limit(1);
  if (!kien) throw new Error('Không tìm thấy kiện');
  if (!duyetTayDuoc(kien.lyDo, kien.doiChieu)) {
    throw new Error(
      kien.doiChieu === 'khong_thay'
        ? 'Hãng đã tra và không thấy dấu hiệu nào khớp lý do này — không duyệt tay được'
        : kien.doiChieu === 'xac_nhan'
          ? 'Hãng đã xác nhận rồi, không cần duyệt'
          : 'Chỉ duyệt được kiện mà hệ thống không kiểm được, và lý do phải thuộc nhóm ngoài tầm kiểm soát',
    );
  }

  const gia = {
    lyDoDuyet: input.quyetDinh,
    lyDoDuyetGhiChu: input.ghiChu?.trim() || null,
    lyDoDuyetBoi: session.user.id,
    lyDoDuyetAt: new Date(),
  };
  if (shipHo) await db.update(schema.shipHoOrders).set(gia).where(eq(schema.shipHoOrders.id, input.shipmentId));
  else await db.update(schema.shipments).set(gia).where(eq(schema.shipments.id, input.shipmentId));

  revalidatePath('/f/ship-report');
  revalidatePath('/f/kpi-logistics');
  return { ok: true };
}
