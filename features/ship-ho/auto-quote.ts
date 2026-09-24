/**
 * Lấp giá dự tính (`carrier_cost_vnd`) cho đơn ship hộ chưa có.
 *
 * Vì sao cần: đơn về từ Lark được tạo với tiền để TRỐNG có chủ ý — D-073 chốt
 * "Lark không phải nguồn tiền", giá chi lấy từ hoá đơn carrier còn giá dự tính
 * do hệ thống báo. Nhưng chưa ai nối phần "hệ thống báo", nên 20/52 đơn Lark
 * không có ước tính, và đối soát không tính được delta cho chúng.
 *
 * Hai luật cứng:
 *  1. CHỈ LẤP CHỖ TRỐNG. Đơn đã có ước tính thì không bao giờ bị ghi đè — con số
 *     đó có thể do staff chọn line bằng tay (assignShipHoCarrier).
 *  2. Báo giá theo ĐÚNG HÃNG đã gửi đơn, không phải hãng rẻ nhất và không rơi về
 *     hãng mặc định. Xem chú thích đầu `auto-quote-logic.ts`.
 *
 * KHÔNG đụng `charged_vnd`: đó là tiền brand phải trả — một con số hợp đồng,
 * không phải ước tính nội bộ. Điền tự động là tự ý xuất hoá đơn cho đối tác.
 */
import { eq, isNull, and, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { rankCarrierQuotes, type AccountSnap } from '@/features/carrier-rates/compare/quote-order-carriers';
import { isDefaultResidential } from '@/features/carrier-rates/residential-default';
import { kyNhanTheoBaoGia } from './signature-from-quote';
import { chonDauVaoBaoGia, chonDongTheoHang, type DonCanBaoGia } from './auto-quote-logic';

export interface KetQuaBaoGiaTuDong {
  xet: number;
  daBaoGia: number;
  boQua: number;
  /** Đếm theo lý do — để nhật ký cron nói được vì sao còn đơn trống. */
  lyDo: Record<string, number>;
}

const MAC_DINH_LIMIT = 200;

export async function boSungUocTinhShipHo(opts?: { limit?: number }): Promise<KetQuaBaoGiaTuDong> {
  const limit = opts?.limit ?? MAC_DINH_LIMIT;

  const don = await db.select({
    id: schema.shipHoOrders.id,
    carrierKey: schema.shipHoOrders.carrierKey,
    country: schema.shipHoOrders.country,
    weightKg: schema.shipHoOrders.weightKg,
    smsWeightKg: schema.shipHoOrders.smsWeightKg,
    carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
    postcode: schema.shipHoOrders.postcode,
    city: schema.shipHoOrders.city,
    dimLengthCm: schema.shipHoOrders.dimLengthCm,
    dimWidthCm: schema.shipHoOrders.dimWidthCm,
    dimHeightCm: schema.shipHoOrders.dimHeightCm,
    smsDimLengthCm: schema.shipHoOrders.smsDimLengthCm,
    smsDimWidthCm: schema.shipHoOrders.smsDimWidthCm,
    smsDimHeightCm: schema.shipHoOrders.smsDimHeightCm,
    quoteBreakdown: schema.shipHoOrders.quoteBreakdown,
  })
    .from(schema.shipHoOrders)
    .where(and(isNull(schema.shipHoOrders.carrierCostVnd), isNotNull(schema.shipHoOrders.country)))
    .limit(limit);

  // Account đang bật — tra một lần cho cả lượt. KHÔNG lọc theo suspendedAt: đơn
  // đã gửi rồi thì hãng đó ĐÃ chở nó, việc ở đây là ước tính hãng ấy tính bao
  // nhiêu, không phải chọn hãng cho đơn mới.
  const accounts = await db.select({
    id: schema.carrierAccounts.id,
    name: schema.carrierAccounts.name,
    carrierKey: schema.carriers.key,
  })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));

  const ket: KetQuaBaoGiaTuDong = { xet: don.length, daBaoGia: 0, boQua: 0, lyDo: {} };
  const dem = (k: string) => { ket.lyDo[k] = (ket.lyDo[k] ?? 0) + 1; ket.boQua += 1; };

  for (const o of don) {
    const chon = chonDauVaoBaoGia(o as DonCanBaoGia);
    if (!chon.ok) { dem(chon.lyDo); continue; }
    const { dauVao } = chon;
    const hang = (o.carrierKey ?? '').trim();

    const acc = accounts.find((a) => a.carrierKey === hang);
    if (!acc) { dem('hang_khong_co_account'); continue; }

    // Nạp ĐÚNG một account, và chỉ dòng vùng xa của nước/mã bưu chính này —
    // nạp cả bảng là nguồn egress lớn nhất của hệ thống (D-025).
    const snap = await loadAccountSnapshot(acc.id, new Date(), {
      remoteCountry: dauVao.country,
      remotePostcodes: [dauVao.postcode],
    });
    if (!snap) { dem('chua_nap_bang_gia'); continue; }

    const entries: AccountSnap[] = [{
      carrierKey: acc.carrierKey ?? hang, carrierName: acc.name, accountId: acc.id, snap,
    }];
    const rows = rankCarrierQuotes(entries, {
      country: dauVao.country,
      weightKg: dauVao.weightKg,
      postcode: dauVao.postcode,
      city: dauVao.city,
      dimensions: dauVao.dimensions,
      isResidential: isDefaultResidential(dauVao.country),
      directSignature: kyNhanTheoBaoGia(o.quoteBreakdown),
    });

    const dong = chonDongTheoHang(rows, hang);
    if (!dong.ok) { dem(dong.lyDo); continue; }

    // Ghi có ĐIỀU KIỆN `carrier_cost_vnd IS NULL`: lượt cron này có thể chạy
    // song song với staff đang chọn line bằng tay cho cùng đơn. Ai ghi trước
    // thắng, và người thắng phải là con số có người đứng sau.
    const up = await db.update(schema.shipHoOrders)
      .set({
        carrierCostVnd: String(Math.round(dong.vndCost)),
        carrierAccountId: acc.id,
        quoteBreakdown: dong.breakdown,
        quotedAt: new Date(),
      })
      .where(and(eq(schema.shipHoOrders.id, o.id), isNull(schema.shipHoOrders.carrierCostVnd)));

    if ((up.rowCount ?? 0) > 0) ket.daBaoGia += 1;
    else dem('co_nguoi_ghi_truoc');
  }

  return ket;
}
