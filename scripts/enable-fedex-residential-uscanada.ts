/**
 * Bật + chuẩn hoá phụ phí Residential (giao địa chỉ nhà dân) của FedEx, scope
 * US & Canada — để matrix giá thu khách (đẩy lên Shopify) nung sẵn phí này.
 *
 * Tài liệu FedEx VN: residential CHỈ áp dụng nơi nhận US & Canada, 84.400 ₫/lô
 * (lô thường). Dữ liệu billed xác nhận: chỉ US (210 đơn) + CA (22 đơn) bị thu,
 * không nước nào khác. Row residential_fixed hiện đang active=false + value cũ
 * sai (150.000) → bật, set value=84.400, country_codes=['US','CA'].
 *
 * Engine chỉ cộng residential cho nước trong country_codes (xem quote.ts), và
 * recalc truyền isResidential=true khi dựng matrix → chỉ ô US/CA tăng giá.
 * KHÔNG đụng phí lô hàng nặng (2.702.500 — chưa có đơn nào) và ODA (bỏ qua).
 *
 * Idempotent. Update qua Drizzle → updated_at bump → cache reconcile tự tính lại.
 *   railway run -- npx tsx scripts/enable-fedex-residential-uscanada.ts [--apply]
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const VALUE = '84400.0000';
const COUNTRIES = ['US', 'CA'];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await db.select({
    id: schema.carrierSurcharges.id,
    value: schema.carrierSurcharges.value,
    active: schema.carrierSurcharges.active,
    cc: schema.carrierSurcharges.countryCodes,
  }).from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, FEDEX),
      eq(schema.carrierSurcharges.kind, 'residential_fixed'),
    ));

  if (rows.length === 0) {
    console.error('Không tìm thấy row residential_fixed cho FedEx — kiểm tra lại account/kind.');
    process.exit(1);
  }
  if (rows.length > 1) {
    console.warn(`⚠ Có ${rows.length} row residential_fixed — sẽ chuẩn hoá TẤT CẢ về cùng cấu hình.`);
  }

  for (const r of rows) {
    const cur = ((r.cc as string[]) ?? []).slice().sort();
    const wantCc = COUNTRIES.slice().sort();
    const same = r.active === true && r.value === VALUE
      && cur.length === wantCc.length && cur.every((c, i) => c === wantCc[i]);
    console.log(
      `row ${r.id.slice(0, 8)}: active ${r.active}→true | value ${r.value}→${VALUE} | `
      + `country_codes [${cur.join(',') || '—'}]→[${wantCc.join(',')}]`
      + (same ? '  (đã đúng)' : ''),
    );
    if (apply && !same) {
      await db.update(schema.carrierSurcharges)
        .set({ active: true, value: VALUE, countryCodes: COUNTRIES, note: 'FedEx Residential US/CA — 84.400₫/lô thường (tài liệu FedEx VN + billed xác nhận)' })
        .where(eq(schema.carrierSurcharges.id, r.id));
    }
  }

  console.log(apply ? '\n✓ Đã cập nhật. Bước tiếp: recalc + push matrix lên Shopify.' : '\n[DRY-RUN] Thêm --apply để ghi.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
