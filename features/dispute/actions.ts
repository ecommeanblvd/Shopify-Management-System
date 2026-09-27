'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { mapCongThanhToan, mapLyDo, mapTrangThai } from './chuan-hoa';
import { dongBoDispute } from './sync';
import type { NhapDisputeVao } from './types';

type Ket = { ok: boolean; loi?: string };

const duong = () => revalidatePath('/f/cx/tranh-chap');

const ngay = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const so = (v: string | null): string | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
};

/**
 * CX nhập tay một ca PayPal/Stripe — hai cổng này Shopify không biết, dispute nằm
 * trong dashboard riêng của họ nên không có đường nào khác.
 */
export async function nhapDispute(v: NhapDisputeVao): Promise<Ket & { id?: string }> {
  const actor = await requirePerm('manage_cx_dispute');

  const cong = mapCongThanhToan(v.congThanhToan);
  if (!cong) return { ok: false, loi: 'Cổng thanh toán không hợp lệ.' };
  // Ca Shopify Payments PHẢI đi qua sync: nhập tay là sinh bản thứ hai cho một ca
  // mà Shopify đã có, đúng cái trùng lặp spec này tồn tại để tránh.
  if (cong === 'shopify_payments') {
    return { ok: false, loi: 'Ca Shopify Payments tự về qua đồng bộ, không nhập tay.' };
  }
  const trangThai = mapTrangThai(v.trangThai);
  if (!trangThai) return { ok: false, loi: 'Trạng thái không hợp lệ.' };

  const soTien = so(v.soTien);
  if (soTien == null) return { ok: false, loi: 'Số tiền không hợp lệ.' };
  const tienTe = v.tienTe.trim().toUpperCase();
  // Đơn vị tiền là BẮT BUỘC: thiếu nó thì con số vô nghĩa và bị loại khỏi mọi
  // bảng tổng (xem tong-tien.ts) — thà chặn ngay còn hơn để CX tưởng đã ghi.
  if (!/^[A-Z]{3}$/.test(tienTe)) {
    return { ok: false, loi: 'Đơn vị tiền phải là mã 3 chữ, ví dụ USD hoặc EUR.' };
  }

  try {
    const id = await db.transaction(async (tx) => {
      const maDon = v.maDon?.trim().replace(/^#/, '') || null;
      // Nối sang đơn nếu tìm được — không tìm được vẫn ghi, vì đơn 2023 chưa sync.
      let orderId: string | null = null;
      if (maDon) {
        const [o] = ((await tx.execute(sql`
          SELECT id FROM shopify_orders
          WHERE store_id = ${v.storeId}::uuid
            AND regexp_replace(shopify_order_number, '^#', '') = ${maDon}
          LIMIT 1`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
        orderId = o ? String(o.id) : null;
      }

      const [d] = await tx.insert(schema.dispute).values({
        storeId: v.storeId,
        nguon: 'tay',
        congThanhToan: cong,
        loai: 'chargeback',
        trangThai,
        lyDo: mapLyDo(v.lyDo),
        soTien, tienTe,
        phiDispute: so(v.phiDispute),
        moLuc: ngay(v.moLuc),
        hanNop: ngay(v.hanNop),
        maHoSo: v.maHoSo?.trim() || null,
        orderId,
        maDon: maDon ? `#${maDon}` : null,
        khachEmail: v.khachEmail?.trim() || null,
        taoBoi: actor,
      }).returning({ id: schema.dispute.id });

      const gc = v.ghiChu?.trim();
      if (gc) {
        await tx.insert(schema.disputeGhiChu)
          .values({ disputeId: d!.id, noiDung: gc, taoBoi: actor });
      }
      return d!.id;
    });
    duong();
    return { ok: true, id };
  } catch (e) {
    console.error('[dispute] nhapDispute lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Nhập tranh chấp thất bại.' };
  }
}

/** Thêm ghi chú diễn biến. Append-only — ghi rồi không sửa. */
export async function themGhiChu(disputeId: string, noiDung: string): Promise<Ket> {
  const actor = await requirePerm('manage_cx_dispute');
  const s = noiDung.trim();
  if (!s) return { ok: false, loi: 'Ghi chú trống.' };
  try {
    await db.insert(schema.disputeGhiChu)
      .values({ disputeId, noiDung: s, taoBoi: actor });
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[dispute] themGhiChu lỗi:', e);
    return { ok: false, loi: 'Thêm ghi chú thất bại.' };
  }
}

/**
 * Sửa phần CX SỞ HỮU. Cố ý KHÔNG cho sửa trạng thái/số tiền/hạn nộp của ca sync:
 * những cột đó Shopify ghi lại ở lượt đồng bộ sau, nên sửa tay là mất công vô ích
 * và làm người dùng tin vào con số sẽ bị ghi đè.
 */
export async function suaPhanCx(
  id: string, maHoSo: string | null, phiDispute: string | null,
): Promise<Ket> {
  await requirePerm('manage_cx_dispute');
  const phi = so(phiDispute);
  if (phiDispute != null && phiDispute.trim() !== '' && phi == null) {
    return { ok: false, loi: 'Phí dispute không phải số.' };
  }
  try {
    await db.update(schema.dispute).set({
      maHoSo: maHoSo?.trim() || null,
      phiDispute: phi,
      updatedAt: new Date(),
    }).where(eq(schema.dispute.id, id));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[dispute] suaPhanCx lỗi:', e);
    return { ok: false, loi: 'Lưu thất bại.' };
  }
}

/** Chạy đồng bộ ngay từ UI. Cron vẫn chạy 6 giờ một lượt. */
export async function dongBoNgay(): Promise<Ket & { tin?: string[] }> {
  await requirePerm('manage_cx_dispute');
  try {
    const tin: string[] = [];
    await dongBoDispute((s) => tin.push(s));
    duong();
    return { ok: true, tin };
  } catch (e) {
    console.error('[dispute] dongBoNgay lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Đồng bộ thất bại.' };
  }
}
