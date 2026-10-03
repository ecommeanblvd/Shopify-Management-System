/**
 * Nạp `picked_up_at` — ngày hãng THẬT SỰ lấy hàng — từ lịch sử quét FedEx.
 *
 * Vì sao phải chạy đều: FedEx chỉ giữ dữ liệu track **90 ngày**. Đơn nào để quá hạn là mất
 * vĩnh viễn mốc đi hàng, và phụ phí xăng dầu của nó không còn cách nào đối chiếu theo tuần.
 * Đo 02/10/2026: 3/150 đơn đã rơi vào ca này.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { layLichSuQuet } from '@/lib/fedex/track';
import { layLichSuQuetUps } from '@/lib/ups/track';
import { mocLayHang, mocLayHangUps } from './ngay-lay-hang';

/** FedEx nhận tối đa 30 mã mỗi lượt gọi. */
const LO = 30;
/**
 * Chỉ thử đơn gửi trong vòng 85 ngày.
 *
 * Quá 90 ngày là FedEx trả NOTFOUND mãi mãi; không chặn thì mỗi lượt cron lại gọi lại đúng
 * những mã vô vọng đó, và chúng dồn lên theo thời gian cho tới khi chiếm hết hạn mức mỗi lượt,
 * đẩy đơn MỚI — thứ còn cứu được — ra khỏi lô. 85 chứ không 90 để còn biên an toàn.
 */
const NGAY_CON_TRA_DUOC = 85;

export interface KetQuaNapNgayLayHang { thu: number; co: number; khong: number; lech: number }

export async function napNgayLayHang(opts: { gioiHan?: number } = {}): Promise<KetQuaNapNgayLayHang> {
  const gioiHan = opts.gioiHan ?? 200;
  const don = await db.select({
    id: schema.shipHoOrders.id, awb: schema.shipHoOrders.trackingNumber,
    gui: schema.shipHoOrders.shippedAt, hang: schema.carrierAccounts.name,
  }).from(schema.shipHoOrders)
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.shipHoOrders.carrierAccountId))
    .where(and(
      isNotNull(schema.shipHoOrders.trackingNumber),
      isNull(schema.shipHoOrders.pickedUpAt),
      sql`(${schema.carrierAccounts.name} ILIKE 'FedEx%' OR ${schema.carrierAccounts.name} ILIKE 'UPS%')`,
      // `::int` BẮT BUỘC: không có nó Postgres không suy được kiểu tham số của phép trừ ngày
      // và từ chối cả câu lệnh (bắt lúc chạy thử trên DB thật, 02/10/2026).
      sql`${schema.shipHoOrders.shippedAt} >= CURRENT_DATE - ${NGAY_CON_TRA_DUOC}::int`,
    ))
    .limit(gioiHan);

  const ket: KetQuaNapNgayLayHang = { thu: don.length, co: 0, khong: 0, lech: 0 };
  const la = (ten: string | null, hang: string) => (ten ?? '').toLowerCase().startsWith(hang);

  /** Ghi mốc vào đơn và đếm. Mốc `null` = hãng chưa có dữ liệu quét — không phải lỗi. */
  const ghiMoc = async (d: { id: string; gui: string | null }, moc: Date | null): Promise<void> => {
    if (!moc) { ket.khong++; return; }
    ket.co++;
    if (moc.toISOString().slice(0, 10) !== String(d.gui)) ket.lech++;
    await db.update(schema.shipHoOrders).set({ pickedUpAt: moc })
      .where(eq(schema.shipHoOrders.id, d.id));
  };

  for (let i = 0; i < don.length; i += LO) {
    const lo = don.slice(i, i + LO);
    /* FedEx tra theo LÔ 30 mã một lượt; UPS chỉ tra được TỪNG MÃ MỘT (xem `layLichSuQuetUps`).
     * Tách hai nhánh thay vì gọi chung, để không ép FedEx xuống từng mã một. */
    const fedex = lo.filter((d) => la(d.hang, 'fedex'));
    const ups = lo.filter((d) => la(d.hang, 'ups'));

    if (fedex.length > 0) {
      const quet = await layLichSuQuet(fedex.map((d) => d.awb!));
      for (const d of fedex) {
        const r = quet.get(d.awb!);
        await ghiMoc(d, r && !('loi' in r) ? mocLayHang(r.suKien as { eventType?: string | null; date?: string | null }[]) : null);
      }
    }
    for (const d of ups) {
      const r = await layLichSuQuetUps(d.awb!);
      await ghiMoc(d, 'loi' in r ? null : mocLayHangUps(r.suKien as { eventType?: string | null; date?: string | null }[]));
    }
  }
  return ket;
}
