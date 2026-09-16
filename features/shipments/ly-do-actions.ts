'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { layLyDo } from './ly-do-cham';
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
  const gia = {
    // Đổi lý do là phải đối chiếu lại từ đầu — kết quả cũ thuộc về lý do cũ.
    lyDoDoiChieu: null, lyDoBangChung: null, lyDoDoiChieuAt: null,
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
