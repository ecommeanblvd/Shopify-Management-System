'use server';

import { eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { canTransition, type RequestKind, type RequestStatus } from '@/features/customer-account/request-status';
import { lyDoHopLe, nhanLyDo, maRma } from './ly-do';
import type { TaoYeuCauVao } from './types';

async function quyen(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) {
    throw new Error('Không có quyền quản lý đổi trả.');
  }
  return session.user.id;
}

/**
 * CX tạo yêu cầu trả THAY KHÁCH (CEO 27/09).
 *
 * Khác kênh khách tự gửi ở hai chỗ: không bắt ảnh (ảnh khách gửi qua email/chat
 * nên CX đính sau), và ghi lại `taoBoi` để còn truy ai nhập.
 *
 * MỘT DÒNG = MỘT MÓN, đúng hình CX đang dùng trên Lark.
 */
export async function taoYeuCauTra(v: TaoYeuCauVao): Promise<{ ok: boolean; id?: string; rma?: string; loi?: string }> {
  const nguoi = await quyen();
  if (!lyDoHopLe(v.lyDoChinh, v.lyDoPhu)) return { ok: false, loi: 'Lý do không hợp lệ.' };
  if (!Number.isInteger(v.soLuong) || v.soLuong < 1) return { ok: false, loi: 'Số lượng phải là số nguyên ≥ 1.' };

  try {
    const ket = await db.transaction(async (tx) => {
      const [d] = await tx.execute(sql`
        SELECT l.id, l.sku, l.product_title, l.variant_title, l.quantity, l.unit_price,
               o.id AS order_id, o.store_id, o.shopify_order_number AS ma_don,
               o.total_price, o.currency, o.customer_email,
               COALESCE((SELECT sum(r.quantity)::int FROM customer_order_requests r
                          WHERE r.order_line_id = l.id AND r.status <> 'cancelled'), 0) AS da_tra
        FROM shopify_order_lines l
        JOIN shopify_orders o ON o.id = l.order_id
        WHERE l.id = ${v.lineId}::uuid
        FOR UPDATE OF l`).then((r) => ((r.rows ?? r) as Record<string, unknown>[]));
      if (!d) throw new Error('Không tìm thấy dòng đơn.');

      // Không cho trả quá số đã mua — trả 3 trên đơn mua 2 là hoàn tiền thừa.
      const con = Number(d.quantity) - Number(d.da_tra);
      if (v.soLuong > con) {
        throw new Error(`Dòng này chỉ còn ${con}/${d.quantity} món chưa có yêu cầu trả.`);
      }

      // Mã RMA: thêm hậu tố khi đơn đã có yêu cầu trước — 224/1.096 đơn bên Lark
      // có nhiều hơn một dòng trả.
      const maDon = String(d.ma_don);
      const [dem] = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM customer_order_requests
        WHERE order_id = ${String(d.order_id)}::uuid`).then((r) => ((r.rows ?? r) as { n: number }[])));
      const rma = maRma(maDon, (dem?.n ?? 0) + 1);

      const donGia = Number(d.unit_price);
      const [row] = await tx.insert(schema.customerOrderRequests).values({
        storeId: String(d.store_id),
        orderId: String(d.order_id),
        // Kênh CX nhập hộ: chưa chắc có tài khoản khách, nên để chuỗi rỗng thay
        // vì bịa một id không tồn tại.
        shopifyCustomerId: '',
        orderNumber: maDon,
        kind: 'claim',
        status: 'submitted',
        reasonCodes: [v.lyDoChinh],
        description: v.ghiChu?.trim() || nhanLyDo(v.lyDoChinh, v.lyDoPhu),
        photoKeys: [],
        orderTotal: String(d.total_price ?? '0'),
        refundPercent: 100,
        refundAmount: (donGia * v.soLuong).toFixed(2),
        currency: String(d.currency ?? 'USD'),
        rmaCode: rma,
        orderLineId: v.lineId,
        sku: (d.sku as string) ?? null,
        itemName: [d.product_title, d.variant_title].filter(Boolean).join(' · ') || null,
        quantity: v.soLuong,
        itemValue: (donGia * v.soLuong).toFixed(2),
        refundTo: v.noiHoan,
        returnCategory: v.loai,
        lyDoChinh: v.lyDoChinh,
        lyDoPhu: v.lyDoPhu,
        taoBoi: nguoi,
      }).returning({ id: schema.customerOrderRequests.id });
      return { id: row!.id, rma };
    });

    revalidatePath('/f/customer-account/requests');
    return { ok: true, ...ket };
  } catch (e) {
    console.error('[doi-tra] taoYeuCauTra lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Tạo yêu cầu thất bại.' };
  }
}

/**
 * Huỷ yêu cầu. Đi được từ MỌI trạng thái chưa hoàn tiền — đo Lark: 142/1.414
 * yêu cầu ở CANCEL (10%), khách rút yêu cầu ở bất kỳ khâu nào là chuyện thường.
 */
export async function huyYeuCau(id: string, lyDo: string): Promise<{ ok: boolean; loi?: string }> {
  await quyen();
  try {
    const [r] = await db.select({
      kind: schema.customerOrderRequests.kind,
      status: schema.customerOrderRequests.status,
    }).from(schema.customerOrderRequests)
      .where(eq(schema.customerOrderRequests.id, id)).limit(1);
    if (!r) return { ok: false, loi: 'Không tìm thấy yêu cầu.' };
    if (!canTransition(r.kind as RequestKind, r.status as RequestStatus, 'cancelled')) {
      return { ok: false, loi: `Không huỷ được từ trạng thái "${r.status}".` };
    }
    await db.update(schema.customerOrderRequests)
      .set({
        status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()`,
        rejectedReason: lyDo.trim() || null,
      })
      .where(eq(schema.customerOrderRequests.id, id));
    revalidatePath('/f/customer-account/requests');
    return { ok: true };
  } catch (e) {
    console.error('[doi-tra] huyYeuCau lỗi:', e);
    return { ok: false, loi: 'Huỷ thất bại.' };
  }
}
