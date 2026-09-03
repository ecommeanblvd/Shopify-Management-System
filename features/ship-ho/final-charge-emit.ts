import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { emitShipHoEvent, type ShipHoEmitOrder } from './mmp-events';

/**
 * Chặn bắn TRÙNG `order.reconciled` sang MMP.
 *
 * Sự kiện này là "giá thu cuối đã chốt / vừa đổi", nên MMP xử lý idempotent theo
 * giá. Nhưng upload lại hoá đơn hãng làm đơn bị reset trạng thái đối soát → cờ
 * "lần đầu" bật lại và bắn lại đúng y giá cũ (4/143 lần trong outbox tới 03/09).
 * Ở đây so với giá ĐÃ GỬI THẬT đọc từ outbox, không so với cột trên đơn — cột đó
 * bị ghi đè theo lượt chạy nên không phản ánh thứ MMP đã nhận.
 *
 * Khoá so sánh gồm cả `reconcileResolution`: cùng giá nhưng KHÁC kết luận
 * (operator chấp nhận sai lệch, claim được hoàn / bị từ chối) vẫn phải báo — đó
 * là thông tin mới với MMP, không phải bắn thừa.
 */
export interface GiaCuoiDaGui {
  finalChargedVnd: number;
  reconcileResolution: string | null;
}

/**
 * THUẦN: có nên bắn không. Chưa gửi lần nào → bắn. Giá đổi → bắn. Kết luận MỚI
 * khác kết luận đã gửi → bắn.
 *
 * Kết luận VẮNG MẶT không tính là đổi: cron re-bill không gửi kèm
 * `reconcileResolution`, nên nếu coi `null` là "khác 'internal_error'" thì mọi
 * đơn operator từng duyệt tay sẽ bị bắn lại mỗi lượt — đúng cái đang cần chặn
 * (chạy thử trên dữ liệu thật: 20/50 đơn dính bẫy này).
 */
export function nenBanGiaCuoi(
  giaCuoi: number | null | undefined,
  ketLuan: string | null | undefined,
  daGui: GiaCuoiDaGui | null | undefined,
): boolean {
  if (giaCuoi == null) return false;
  if (!daGui) return true;
  if (ketLuan != null && ketLuan !== daGui.reconcileResolution) return true;
  return Math.round(giaCuoi) !== Math.round(daGui.finalChargedVnd);
}

const doc = (payload: unknown): GiaCuoiDaGui | null => {
  const p = payload as { finalChargedVnd?: unknown; reconcileResolution?: unknown } | null;
  const gia = Number(p?.finalChargedVnd);
  if (!Number.isFinite(gia)) return null;
  const kl = p?.reconcileResolution;
  return { finalChargedVnd: gia, reconcileResolution: typeof kl === 'string' ? kl : null };
};

/** Giá cuối ĐÃ GỬI gần nhất của từng đơn, đọc từ outbox. Rỗng → chưa gửi lần nào. */
export async function giaCuoiDaGuiTheoDon(orderIds: string[]): Promise<Map<string, GiaCuoiDaGui>> {
  const out = new Map<string, GiaCuoiDaGui>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({ orderId: schema.shipHoOrderEvents.orderId, payload: schema.shipHoOrderEvents.payload })
    .from(schema.shipHoOrderEvents)
    .where(and(
      inArray(schema.shipHoOrderEvents.orderId, orderIds),
      eq(schema.shipHoOrderEvents.event, 'order.reconciled'),
    ))
    .orderBy(desc(schema.shipHoOrderEvents.occurredAt));
  for (const r of rows) {
    if (out.has(r.orderId)) continue; // đã lấy bản mới nhất của đơn này
    const g = doc(r.payload);
    if (g) out.set(r.orderId, g);
  }
  return out;
}

/** Giá cuối đã gửi của MỘT đơn (dùng cho action lẻ, không batch). */
export async function giaCuoiDaGuiMotDon(orderId: string): Promise<GiaCuoiDaGui | null> {
  const [row] = await db
    .select({ payload: schema.shipHoOrderEvents.payload })
    .from(schema.shipHoOrderEvents)
    .where(and(
      eq(schema.shipHoOrderEvents.orderId, orderId),
      eq(schema.shipHoOrderEvents.event, 'order.reconciled'),
    ))
    .orderBy(desc(schema.shipHoOrderEvents.occurredAt))
    .limit(1);
  return row ? doc(row.payload) : null;
}

/**
 * Bắn `order.reconciled` — BỎ QUA khi trùng giá + kết luận với lần đã gửi.
 * `daGui` truyền sẵn khi caller đã batch-load; bỏ trống thì tự tra.
 * Trả về true nếu thực sự bắn.
 */
export async function banGiaCuoiNeuDoi(
  order: ShipHoEmitOrder,
  data: { finalChargedVnd: number; reconcileResolution?: string | null } & Record<string, unknown>,
  daGui?: GiaCuoiDaGui | null,
): Promise<boolean> {
  const truoc = daGui === undefined ? await giaCuoiDaGuiMotDon(order.id) : daGui;
  if (!nenBanGiaCuoi(data.finalChargedVnd, data.reconcileResolution ?? null, truoc)) return false;
  await emitShipHoEvent(order, 'order.reconciled', data);
  return true;
}
