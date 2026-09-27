'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { withUniqueRetry } from '@/features/receiving/perm';
import { nguoiGhi } from './nguoi';
import { boPhanHopLe, loaiHopLe, maTicket, nhomHopLe } from './phan-loai';
import { chuyenDuocTrangThai, ghiDuocPhanViec, laGhiHo, trangThaiVietHopLe } from './trang-thai';
import type { TaoTicketVao } from './types';

type Ket = { ok: boolean; loi?: string };

const TOI_DA_TIEU_DE = 300;

/**
 * Tạo ticket + phần việc từng bộ phận + ghi chú mở đầu, trong MỘT transaction.
 *
 * Mã ticket sinh từ `max` rồi dựa vào UNIQUE + `withUniqueRetry` để xử lý đua —
 * đúng cách các mã tuần tự khác trong hệ thống đang làm (xem features/receiving/perm.ts).
 */
export async function taoTicket(v: TaoTicketVao): Promise<Ket & { id?: string; ma?: string }> {
  const nguoi = await nguoiGhi();

  const tieuDe = v.tieuDe.trim();
  if (!tieuDe) return { ok: false, loi: 'Cần nhập tiêu đề.' };
  if (tieuDe.length > TOI_DA_TIEU_DE) return { ok: false, loi: `Tiêu đề quá dài (tối đa ${TOI_DA_TIEU_DE} ký tự).` };
  if (!nhomHopLe(v.nhom) || !loaiHopLe(v.nhom, v.loai)) return { ok: false, loi: 'Nhóm/loại vấn đề không hợp lệ.' };
  if (!boPhanHopLe(v.boPhanNeu)) return { ok: false, loi: 'Bộ phận nêu vấn đề không hợp lệ.' };

  const nhan = [...new Set(v.boPhanNhan)];
  if (nhan.length === 0) return { ok: false, loi: 'Cần chọn ít nhất một bộ phận nhận.' };
  if (nhan.some((b) => !boPhanHopLe(b))) return { ok: false, loi: 'Bộ phận nhận không hợp lệ.' };

  // Không toàn quyền thì chỉ được nêu vấn đề DƯỚI TÊN bộ phận mình — nếu không
  // thì một người có thể ghi vấn đề rồi quy cho bộ phận khác nêu.
  if (!nguoi.toanQuyen && v.boPhanNeu !== nguoi.boPhan) {
    return { ok: false, loi: 'Bạn chỉ nêu vấn đề dưới tên bộ phận của mình.' };
  }

  const lineIds = [...new Set(v.lineIds)];

  try {
    const ket = await withUniqueRetry(() => db.transaction(async (tx) => {
      // Store + email khách suy từ dòng đơn đầu tiên: ticket gắn đơn thì hai
      // thông tin này phải khớp đơn, không để người nhập gõ lệch.
      let storeId: string | null = null;
      let email = v.khachEmail?.trim() || null;
      if (lineIds.length > 0) {
        const d = (await tx.execute(sql`
          SELECT o.store_id, o.customer_email
          FROM shopify_order_lines l JOIN shopify_orders o ON o.id = l.order_id
          WHERE l.id IN ${lineIds}
          ORDER BY o.processed_at_shopify DESC NULLS LAST
          LIMIT 1`).then((r) => ((r as { rows?: Record<string, unknown>[] }).rows ?? [])))[0];
        if (!d) throw new Error('Dòng đơn không tồn tại.');
        storeId = String(d.store_id);
        email = email ?? ((d.customer_email as string) ?? null);
      }

      const [m] = (await tx.execute(sql`
        SELECT COALESCE(max((regexp_match(ma_ticket, '^CXT-(\\d+)$'))[1]::int), 0) AS n
        FROM cx_ticket WHERE ma_ticket ~ '^CXT-\\d+$'`)
        .then((r) => ((r as { rows?: Record<string, unknown>[] }).rows ?? [])));
      const ma = maTicket(Number(m?.n ?? 0) + 1);

      const [t] = await tx.insert(schema.cxTicket).values({
        maTicket: ma, tieuDe, nhom: v.nhom, loai: v.loai,
        boPhanNeu: v.boPhanNeu, trangThai: 'moi',
        hanXuLy: v.hanXuLy || null,
        maTicketCs: v.maTicketCs?.trim() || null,
        storeId, khachEmail: email,
        nguon: 'he_thong', taoBoi: nguoi.userId,
      }).returning({ id: schema.cxTicket.id });
      const id = t!.id;

      if (lineIds.length > 0) {
        await tx.insert(schema.cxTicketDong)
          .values(lineIds.map((lineId) => ({ ticketId: id, orderLineId: lineId })));
      }
      await tx.insert(schema.cxTicketPhanViec)
        .values(nhan.map((boPhan) => ({ ticketId: id, boPhan, trangThai: 'dang_xu_ly' })));

      const ghi = v.ghiChuDau?.trim();
      if (ghi) {
        await tx.insert(schema.cxTicketGhiChu).values({
          ticketId: id, boPhan: v.boPhanNeu, noiDung: ghi,
          taoBoi: nguoi.userId, ghiHo: laGhiHo(nguoi.boPhan, v.boPhanNeu),
        });
      }
      return { id, ma };
    }));
    revalidatePath('/f/cx');
    return { ok: true, ...ket };
  } catch (e) {
    console.error('[cx-ticket] taoTicket lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Tạo ticket thất bại.' };
  }
}

/** Ticket nhập từ Lark là hồ sơ lịch sử — mọi hành động ghi phải đi qua cửa này. */
async function chanTicketLark(id: string): Promise<{ nguon: string; trangThai: string } | null> {
  const [t] = await db.select({
    nguon: schema.cxTicket.nguon, trangThai: schema.cxTicket.trangThai,
  }).from(schema.cxTicket).where(eq(schema.cxTicket.id, id)).limit(1);
  return t ?? null;
}

/** Ghi chú + đổi trạng thái phần việc của MỘT bộ phận. Ghi chú append-only. */
export async function ghiPhanViec(
  ticketId: string, boPhan: string, trangThai: string, noiDung: string,
): Promise<Ket> {
  const nguoi = await nguoiGhi();
  if (!boPhanHopLe(boPhan)) return { ok: false, loi: 'Bộ phận không hợp lệ.' };
  if (!trangThaiVietHopLe(trangThai)) return { ok: false, loi: 'Trạng thái không hợp lệ.' };
  if (!ghiDuocPhanViec(nguoi.toanQuyen, nguoi.boPhan, boPhan)) {
    return { ok: false, loi: 'Bạn chỉ ghi được phần việc của bộ phận mình.' };
  }
  const ghi = noiDung.trim();

  try {
    const t = await chanTicketLark(ticketId);
    if (!t) return { ok: false, loi: 'Không tìm thấy ticket.' };
    if (t.nguon === 'lark') return { ok: false, loi: 'Ticket nhập từ Lark chỉ để đọc.' };
    if (t.trangThai === 'xong') return { ok: false, loi: 'Ticket đã đóng, không ghi thêm được.' };

    await db.transaction(async (tx) => {
      // Bộ phận chưa được gán mà giờ có người ghi vào → gán luôn. Trên Lark
      // chuyện này xảy ra thường xuyên (LOG nhận việc giữa đường), và ép phải
      // sửa danh sách bộ phận trước khi ghi chỉ làm người dùng bỏ qua ô ghi chú.
      await tx.insert(schema.cxTicketPhanViec)
        .values({ ticketId, boPhan, trangThai, nguoiPhuTrach: nguoi.userId,
          xongLuc: trangThai === 'da_xu_ly' ? new Date() : null })
        .onConflictDoUpdate({
          target: [schema.cxTicketPhanViec.ticketId, schema.cxTicketPhanViec.boPhan],
          set: {
            trangThai, nguoiPhuTrach: nguoi.userId, updatedAt: new Date(),
            // Quay lại "đang xử lý" thì XOÁ mốc xong, không để mốc cũ nằm lại
            // rồi báo cáo tính là đã xong.
            xongLuc: trangThai === 'da_xu_ly' ? new Date() : null,
          },
        });

      if (ghi) {
        await tx.insert(schema.cxTicketGhiChu).values({
          ticketId, boPhan, noiDung: ghi, taoBoi: nguoi.userId,
          ghiHo: laGhiHo(nguoi.boPhan, boPhan),
        });
      }
      // Ticket còn `moi` mà đã có người xử lý thì đẩy sang `dang_xu_ly` — không
      // ai phải bấm thêm một nút chỉ để nói "tôi đã bắt đầu".
      await tx.update(schema.cxTicket)
        .set({ trangThai: 'dang_xu_ly', updatedAt: new Date() })
        .where(sql`${schema.cxTicket.id} = ${ticketId} AND ${schema.cxTicket.trangThai} = 'moi'`);
    });
    revalidatePath('/f/cx');
    return { ok: true };
  } catch (e) {
    console.error('[cx-ticket] ghiPhanViec lỗi:', e);
    return { ok: false, loi: 'Ghi phần việc thất bại.' };
  }
}

/**
 * Đổi trạng thái ticket. Đóng khi còn bộ phận chưa xử lý là ĐƯỢC — CEO 25/09:
 * "không muốn chặn cứng mà chỉ hiện lên thông báo noti để người dùng biết".
 * Cảnh báo do UI hiện từ `boPhanConTac`, không phải action chặn.
 */
export async function doiTrangThaiTicket(id: string, den: string): Promise<Ket> {
  const nguoi = await nguoiGhi();
  if (!nguoi.toanQuyen) return { ok: false, loi: 'Chỉ CX đổi được trạng thái ticket.' };
  try {
    const t = await chanTicketLark(id);
    if (!t) return { ok: false, loi: 'Không tìm thấy ticket.' };
    if (t.nguon === 'lark') return { ok: false, loi: 'Ticket nhập từ Lark chỉ để đọc.' };
    if (!chuyenDuocTrangThai(t.trangThai, den)) {
      return { ok: false, loi: `Không chuyển được từ "${t.trangThai}" sang "${den}".` };
    }
    await db.update(schema.cxTicket).set({
      trangThai: den, updatedAt: new Date(),
      dongLuc: den === 'xong' ? new Date() : null,
    }).where(eq(schema.cxTicket.id, id));
    revalidatePath('/f/cx');
    return { ok: true };
  } catch (e) {
    console.error('[cx-ticket] doiTrangThaiTicket lỗi:', e);
    return { ok: false, loi: 'Đổi trạng thái thất bại.' };
  }
}

/** Gắn thêm / bỏ một dòng đơn khỏi ticket. */
export async function ganDongDon(ticketId: string, lineId: string): Promise<Ket> {
  const nguoi = await nguoiGhi();
  if (!nguoi.toanQuyen) return { ok: false, loi: 'Chỉ CX gắn được dòng đơn.' };
  try {
    const t = await chanTicketLark(ticketId);
    if (!t) return { ok: false, loi: 'Không tìm thấy ticket.' };
    if (t.nguon === 'lark') return { ok: false, loi: 'Ticket nhập từ Lark chỉ để đọc.' };
    await db.insert(schema.cxTicketDong).values({ ticketId, orderLineId: lineId })
      .onConflictDoNothing();
    revalidatePath('/f/cx');
    return { ok: true };
  } catch (e) {
    console.error('[cx-ticket] ganDongDon lỗi:', e);
    return { ok: false, loi: 'Gắn dòng đơn thất bại.' };
  }
}

export async function boDongDon(ticketId: string, lineId: string): Promise<Ket> {
  const nguoi = await nguoiGhi();
  if (!nguoi.toanQuyen) return { ok: false, loi: 'Chỉ CX bỏ được dòng đơn.' };
  try {
    const t = await chanTicketLark(ticketId);
    if (!t) return { ok: false, loi: 'Không tìm thấy ticket.' };
    if (t.nguon === 'lark') return { ok: false, loi: 'Ticket nhập từ Lark chỉ để đọc.' };
    await db.delete(schema.cxTicketDong).where(
      sql`${schema.cxTicketDong.ticketId} = ${ticketId} AND ${schema.cxTicketDong.orderLineId} = ${lineId}`);
    revalidatePath('/f/cx');
    return { ok: true };
  } catch (e) {
    console.error('[cx-ticket] boDongDon lỗi:', e);
    return { ok: false, loi: 'Bỏ dòng đơn thất bại.' };
  }
}
