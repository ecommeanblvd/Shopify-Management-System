/**
 * SUY TỈ GIÁ USD→VND của tài khoản Aramex HN TỪ HOÁ ĐƠN THẬT, rồi (khi được duyệt) ghi lại
 * vào `carrier_accounts.fx_cost_per_display`.
 *
 *   railway run npx tsx scripts/cap-nhat-ty-gia-aramex.ts            # CHẠY THỬ, không ghi gì
 *   railway run npx tsx scripts/cap-nhat-ty-gia-aramex.ts --ap-dung  # ghi thật
 *
 * Vì sao cần (CEO 16/10/2026): ô bảng giá Aramex lưu bằng USD, tài khoản giữ một tỉ giá tĩnh
 * cập nhật lần cuối 02/07/2026. Đo 15 kiện có hoá đơn: giá hệ thống cao hơn hoá đơn đúng
 * 12,3–12,4% ở hầu hết kiện — tách ra thì ~8% là do cộng thừa VAT (giá HNC đã gồm VAT) và
 * ~4,1% là tỉ giá trôi.
 *
 * CÁCH SUY: với mỗi kiện có hoá đơn, hỏi engine bằng ĐÚNG cân tính phí của hoá đơn để ô bảng
 * giá rơi đúng bậc, lấy `breakdown.base` (USD) rồi chia `shipment_charges.base` (VND) cho nó.
 * Kiện nào engine rơi bậc khác hoá đơn sẽ cho tỉ giá vô lý — vì vậy báo cáo dùng TRUNG VỊ và
 * nêu riêng các kiện lệch xa, KHÔNG lấy trung bình cộng (một kiện lệch bậc kéo cả con số).
 *
 * KHÔNG đụng chuyện VAT — đó là thay đổi khác, phải có dry-run riêng.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { baoGiaBangGiaMotHang } from '@/features/carrier-rates/compare/quote-order-carriers';

const APDUNG = process.argv.includes('--ap-dung');
const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Trung vị — chống kiện lệch bậc kéo con số, khác hẳn trung bình cộng. */
function trungVi(ds: number[]): number | null {
  if (ds.length === 0) return null;
  const s = [...ds].sort((a, b) => a - b);
  const g = Math.floor(s.length / 2);
  return s.length % 2 ? s[g] : (s[g - 1] + s[g]) / 2;
}

interface Diem { ky: string; ma: string; tyGia: number; billBase: number; oUsd: number }

async function main() {
  const [acc] = await db.select({
    id: schema.carrierAccounts.id, ten: schema.carrierAccounts.name,
    fx: schema.carrierAccounts.fxCostPerDisplay, fxLuc: schema.carrierAccounts.fxUpdatedAt,
    costCcy: schema.carrierAccounts.costCurrency,
  }).from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carriers.key, 'aramex')).limit(1);
  if (!acc) { console.error('Không tìm thấy tài khoản Aramex.'); process.exit(1); }
  if (acc.costCcy !== 'USD') { console.error(`Tài khoản lưu giá bằng ${acc.costCcy}, không phải USD — dừng.`); process.exit(1); }

  const hienTai = 1 / Number(acc.fx);
  console.log(`${acc.ten}: đang dùng 1 USD = ${vnd(hienTai)} đ (cập nhật ${String(acc.fxLuc).slice(0, 10)})\n`);

  const ds = await db.select({
    id: schema.shipments.id, tracking: schema.shipments.trackingNumber,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    ngay: schema.shipments.labelCreatedAt, taoLuc: schema.shipments.createdAt,
    country: schema.shopifyOrders.shipCountry, postcode: schema.shopifyOrders.shipPostcode,
    city: schema.shopifyOrders.shipCity, addrClass: schema.shopifyOrders.addrClass,
    billBase: schema.shipmentCharges.base, canBill: schema.shipmentCharges.billingWeightKg,
  }).from(schema.shipments)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.shipmentCharges, eq(schema.shipmentCharges.shipmentId, schema.shipments.id))
    .where(and(
      eq(schema.shipments.carrierKey, 'aramex'),
      isNotNull(schema.shipmentCharges.base),
      isNotNull(schema.shipmentCharges.billingWeightKg),
    ));

  const diem: Diem[] = [];
  let boQua = 0;
  for (const k of ds) {
    const can = Number(k.canBill);
    const bill = Number(k.billBase);
    if (!(can > 0) || !(bill > 0) || !k.country) { boQua++; continue; }
    const ngay = k.ngay ?? k.taoLuc;
    const row = await baoGiaBangGiaMotHang('aramex', {
      country: k.country, weightKg: can, postcode: k.postcode, city: k.city,
      dimensions: null, effectiveDate: ngay,
      isResidential: k.addrClass === 'RESIDENTIAL',
    });
    const oUsd = row?.ok ? row.breakdown?.base : null;
    if (oUsd == null || !(oUsd > 0)) { boQua++; continue; }
    diem.push({
      // `ngay` là Date — `String(date).slice(0,7)` ra "Fri Aug", không phải kỳ. Phải qua ISO.
      ky: new Date(ngay).toISOString().slice(0, 7),
      ma: `${k.maDon ?? ''} ${k.tracking ?? ''}`.trim(),
      tyGia: bill / oUsd, billBase: bill, oUsd,
    });
  }

  if (diem.length === 0) { console.error('Không suy được điểm nào — dừng, KHÔNG ghi gì.'); process.exit(1); }

  const theoKy = new Map<string, number[]>();
  for (const d of diem) theoKy.set(d.ky, [...(theoKy.get(d.ky) ?? []), d.tyGia]);
  console.log('TỈ GIÁ SUY TỪ HOÁ ĐƠN, theo kỳ:');
  for (const ky of [...theoKy.keys()].sort()) {
    const v = theoKy.get(ky)!;
    const tv = trungVi(v)!;
    const trong = v.filter((x) => Math.abs(x / tv - 1) <= 0.02).length;
    console.log(`  ${ky}: ${String(v.length).padStart(3)} kiện · trung vị 1 USD = ${vnd(tv).padStart(7)} đ`
      + ` · ${trong}/${v.length} kiện nằm trong ±2% quanh trung vị`
      + ` · thấp nhất ${vnd(Math.min(...v))} / cao nhất ${vnd(Math.max(...v))}`);
  }

  const kyMoi = [...theoKy.keys()].sort().at(-1)!;
  const deXuat = trungVi(theoKy.get(kyMoi)!)!;
  const lech = (deXuat / hienTai - 1) * 100;
  console.log(`\nĐỀ XUẤT (trung vị kỳ mới nhất ${kyMoi}): 1 USD = ${vnd(deXuat)} đ`);
  console.log(`  so với đang dùng ${vnd(hienTai)} đ → giá hệ thống sẽ ${lech < 0 ? 'GIẢM' : 'TĂNG'} ${Math.abs(lech).toFixed(2)}%`);

  const xa = diem.filter((d) => Math.abs(d.tyGia / deXuat - 1) > 0.05)
    .sort((a, b) => Math.abs(b.tyGia / deXuat - 1) - Math.abs(a.tyGia / deXuat - 1));
  if (xa.length > 0) {
    console.log(`\n⚠️  ${xa.length}/${diem.length} kiện cho tỉ giá lệch > 5% — gần như chắc là LỆCH BẬC CÂN,`);
    console.log('    không phải tỉ giá. KHÔNG dùng chúng để chốt số; soi riêng:');
    for (const d of xa.slice(0, 8)) {
      console.log(`    ${d.ma.padEnd(30)} hoá đơn base ${vnd(d.billBase).padStart(10)} đ · ô bảng giá ${d.oUsd} USD → suy ra ${vnd(d.tyGia)} đ/USD`);
    }
  }
  if (boQua > 0) console.log(`\n(${boQua} kiện bỏ qua: thiếu cân tính phí trên hoá đơn hoặc engine không ra giá)`);

  if (!APDUNG) {
    console.log('\n=== CHẠY THỬ — KHÔNG ghi gì. Thêm --ap-dung để ghi thật. ===');
    process.exit(0);
  }
  await db.update(schema.carrierAccounts)
    .set({ fxCostPerDisplay: String(1 / deXuat), fxUpdatedAt: new Date() })
    .where(eq(schema.carrierAccounts.id, acc.id));
  console.log(`\n✓ ĐÃ GHI: 1 USD = ${vnd(deXuat)} đ`);
  process.exit(0);
}
main();
