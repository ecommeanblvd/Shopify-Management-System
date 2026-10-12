/**
 * Sửa + bổ sung cấu hình phụ phí UPS, theo đúng những gì HOÁ ĐƠN THẬT nói.
 *
 * Vì sao cần: chạy lại cả 37 lô của hoá đơn 100000813108 (kỳ 03–30/09/2026) qua chính engine
 * mà module "Đóng hàng" dùng để so cước, thì engine báo 60.370.725đ còn UPS thu 69.111.385đ —
 * THIẾU 12,6%. Giá nền thì đúng gần như từng đồng (788.222 vs 788.190), nên chênh nằm hết ở
 * phụ phí. Bảng so cước vì vậy báo UPS rẻ hơn thực tế, mà UPS lại đang là hãng rẻ nhất ở nhiều
 * tuyến → đủ để chọn sai line ship.
 *
 * Ba việc, cả ba đều đo được trên hoá đơn:
 *
 *  1. PHÍ XỬ LÝ QUỐC TẾ (`country_fixed` 58.750đ, mã UPS `ACC/FIP`) — khai hiệu lực từ
 *     01/10/2026 nên MỌI lô tháng 9 không được tính. Hoá đơn thu khoản này từ lô đi 03/09.
 *     Chỉ sửa NGÀY. Phạm vi nước ['US'] là ĐÚNG, giữ nguyên: 33/33 lô đi Mỹ có khoản này,
 *     4/4 lô đi AU·CA·PT·TH KHÔNG có.
 *
 *  2. KÝ NHẬN (`addon_fixed` 65.330đ, mã UPS `ACC/DCS`) — khai `when_billed` nên chỉ là số
 *     tham chiếu, không vào giá so sánh. Hoá đơn thu 37/37 lô. Đổi sang `always` +
 *     `service_key='direct_signature'`, đúng cách FedEx/DHL đang khai: áp mọi đơn, trừ khi
 *     người gọi truyền `directSignature: false` (ship hộ, khi brand không chọn ký nhận).
 *
 *  3. SURGE EMERGENCY FEE (mã UPS `ACC/PFR` nhà dân / `ACC/PFC` thương mại) — CHƯA có trong
 *     hệ thống, tháng 9 là 1.648.525đ. Đo trên hoá đơn thì nó là MỘT MỨC TIỀN TRÊN MỖI KG cân
 *     tính cước, không phải phí phẳng mỗi lô:
 *
 *        đi Mỹ, lô đi ≤ 25/09 : 11.750 đ/kg  (29 lô, không lô nào lệch)
 *        đi Mỹ, lô đi ≥ 28/09 : 39.950 đ/kg  (8 lô)   ← khớp đúng ngày UPS công bố 27/09/2026
 *        đi Canada            : 11.750 đ/kg  (1 lô, 11/09)
 *        đi Bồ Đào Nha        :  7.050 đ/kg  (1 lô, 09/09)
 *        đi Úc · Thái Lan     :  2.350 đ/kg  (2 lô, 09/09 và 29/09)
 *
 *     Dùng `kind='demand_per_kg'` — đúng loại: tiền/kg, chia theo nước, và `isFuelable` cho
 *     nó TRUE, trùng với câu UPS in trên chính tài liệu surge: "Surge Emergency Fees are
 *     subject to the Fuel Surcharge and will apply based on the billable weight".
 *
 *     THẬN TRỌNG về nhóm nước: mức của Mỹ dựa trên 37 lô nên chắc. Ba nhóm còn lại mỗi nhóm
 *     dựa trên MỘT–HAI lô, và nhóm nước lấy theo danh sách vùng do chính UPS in trong tài
 *     liệu surge (Europe, Rest of Asia). Tức mức tiền là số ĐO ĐƯỢC, còn việc "cả vùng cùng
 *     mức" là SUY RA. Mỗi dòng ghi rõ chỗ dựa trong `note`; tờ hoá đơn sau sẽ xác nhận hoặc
 *     bác bỏ (xem báo cáo báo-giá-vs-hoá-đơn).
 *
 * Mặc định chạy thử (dry-run), in ra từng thay đổi. Thêm --apply để ghi.
 *
 *   npx dotenv -- npx tsx scripts/sua-phu-phi-ups.ts
 *   npx dotenv -- npx tsx scripts/sua-phu-phi-ups.ts --apply
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const UPS_ACCOUNT = '46fa242a-d9e6-4bbc-a0ae-2549b84c9ade';
/** Hoá đơn làm bằng chứng cho mọi con số dưới đây. */
const HOA_DON = '100000813108';

/** Vùng "Europe" theo đúng danh sách UPS in trong tài liệu Surge Emergency Fee. */
const EUROPE = [
  'AD', 'AL', 'AM', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES',
  'FI', 'FR', 'GB', 'GE', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IL', 'IS', 'IT', 'JE', 'LT',
  'LU', 'LV', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI',
  'SK', 'SM', 'TR', 'UA', 'XK',
];
/** Vùng "Rest of Asia" của UPS + Úc · New Zealand · Ấn Độ (UPS gộp cùng dòng với Rest of Asia). */
const CHAU_A_TBD = [
  'AS', 'AU', 'BN', 'BT', 'FJ', 'GU', 'ID', 'IN', 'JP', 'KH', 'KR', 'LA', 'MM', 'MN', 'MO',
  'MP', 'MY', 'NC', 'NZ', 'PF', 'PH', 'SG', 'TH', 'TW', 'VN', 'WS',
];

/** 27/09/2026 — ngày UPS công bố mức mới cho tuyến đi Mỹ; hoá đơn đổi mức đúng từ lô 28/09. */
const MOC_27_09 = new Date('2026-09-27T00:00:00Z');
/** Lô sớm nhất trên hoá đơn có Phí xử lý quốc tế. Không có bằng chứng nó áp trước ngày này. */
const LO_SOM_NHAT = new Date('2026-09-03T00:00:00Z');

interface DongSurge {
  value: number; countryCodes: string[]; startsAt: Date | null; endsAt: Date | null; note: string;
}
const SURGE: DongSurge[] = [
  { value: 11750, countryCodes: ['US'], startsAt: null, endsAt: MOC_27_09,
    note: `UPS Surge Emergency Fee đi Mỹ 11.750đ/kg (lô đi trước 27/09/2026) — đo trên hoá đơn ${HOA_DON}, 29/29 lô khớp` },
  { value: 39950, countryCodes: ['US'], startsAt: MOC_27_09, endsAt: null,
    note: `UPS Surge Emergency Fee đi Mỹ 39.950đ/kg (từ 27/09/2026, UPS công bố) — đo trên hoá đơn ${HOA_DON}, 8/8 lô khớp` },
  { value: 11750, countryCodes: ['CA'], startsAt: null, endsAt: null,
    note: `UPS Surge Emergency Fee đi Canada 11.750đ/kg — đo trên hoá đơn ${HOA_DON} nhưng CHỈ 1 lô (11/09); chưa có lô nào sau 27/09 để biết có tăng như tuyến Mỹ không` },
  { value: 7050, countryCodes: EUROPE, startsAt: null, endsAt: null,
    note: `UPS Surge Emergency Fee đi châu Âu 7.050đ/kg — mức đo trên hoá đơn ${HOA_DON} từ MỘT lô (PT, 09/09); nhóm nước lấy theo danh sách "Europe" UPS in trong tài liệu surge` },
  { value: 2350, countryCodes: CHAU_A_TBD, startsAt: null, endsAt: null,
    note: `UPS Surge Emergency Fee đi châu Á–TBD 2.350đ/kg — mức đo trên hoá đơn ${HOA_DON} từ HAI lô (AU 09/09, TH 29/09); nhóm nước lấy theo danh sách "Rest of Asia" + Úc/NZ/Ấn của UPS` },
];

const apply = process.argv.includes('--apply');
const vnd = (n: number) => n.toLocaleString('vi-VN');

async function main() {
  console.log(apply ? '>>> GHI THẬT (--apply)\n' : '>>> CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi.\n');

  // ---- 1. Phí xử lý quốc tế: chỉ sửa ngày hiệu lực ----
  const fip = await db.select().from(schema.carrierSurcharges).where(and(
    eq(schema.carrierSurcharges.carrierAccountId, UPS_ACCOUNT),
    eq(schema.carrierSurcharges.kind, 'country_fixed'),
  ));
  for (const r of fip) {
    const cu = r.startsAt ? r.startsAt.toISOString().slice(0, 10) : 'null';
    const moi = LO_SOM_NHAT.toISOString().slice(0, 10);
    if (cu === moi) { console.log(`1. Phí xử lý quốc tế ${vnd(Number(r.value))}đ — ngày hiệu lực đã đúng (${moi}), bỏ qua`); continue; }
    console.log(`1. Phí xử lý quốc tế ${vnd(Number(r.value))}đ · nước ${JSON.stringify(r.countryCodes)} — hiệu lực ${cu} → ${moi}`);
    if (apply) {
      await db.update(schema.carrierSurcharges)
        .set({ startsAt: LO_SOM_NHAT, note: `${r.note ?? ''} · hiệu lực lùi về 03/09/2026 theo hoá đơn ${HOA_DON}` })
        .where(eq(schema.carrierSurcharges.id, r.id));
    }
  }

  // ---- 2. Ký nhận: when_billed → always ----
  const kyNhan = (await db.select().from(schema.carrierSurcharges).where(and(
    eq(schema.carrierSurcharges.carrierAccountId, UPS_ACCOUNT),
    eq(schema.carrierSurcharges.kind, 'addon_fixed'),
  ))).filter((r) => Number(r.value) === 65330);
  if (kyNhan.length !== 1) {
    console.log(`2. DỪNG: tìm thấy ${kyNhan.length} dòng ký nhận 65.330đ, chờ đúng 1 — không đoán, kiểm tay rồi chạy lại`);
  } else {
    const r = kyNhan[0];
    if (r.applyMode === 'always' && r.serviceKey === 'direct_signature') {
      console.log('2. Ký nhận 65.330đ — đã always + direct_signature, bỏ qua');
    } else {
      console.log(`2. Ký nhận 65.330đ — apply_mode ${r.applyMode} → always · service_key ${r.serviceKey ?? 'null'} → direct_signature`);
      if (apply) {
        await db.update(schema.carrierSurcharges).set({
          applyMode: 'always', serviceKey: 'direct_signature',
          note: `${r.note ?? ''} · áp MỌI đơn từ 12/10/2026: hoá đơn ${HOA_DON} thu 37/37 lô`,
        }).where(eq(schema.carrierSurcharges.id, r.id));
      }
    }
  }

  // ---- 3. Surge Emergency Fee: thêm demand_per_kg ----
  const daCo = (await db.select().from(schema.carrierSurcharges).where(and(
    eq(schema.carrierSurcharges.carrierAccountId, UPS_ACCOUNT),
    eq(schema.carrierSurcharges.kind, 'demand_per_kg'),
  )));
  if (daCo.length > 0) {
    console.log(`3. DỪNG: UPS đã có ${daCo.length} dòng demand_per_kg — không thêm chồng. Kiểm tay rồi quyết.`);
  } else {
    for (const d of SURGE) {
      const w = `${d.startsAt ? d.startsAt.toISOString().slice(0, 10) : '—'} → ${d.endsAt ? d.endsAt.toISOString().slice(0, 10) : '—'}`;
      console.log(`3. + Surge ${vnd(d.value)}đ/kg · ${d.countryCodes.length} nước (${d.countryCodes.slice(0, 4).join(',')}${d.countryCodes.length > 4 ? '…' : ''}) · ${w}`);
      if (apply) {
        await db.insert(schema.carrierSurcharges).values({
          carrierAccountId: UPS_ACCOUNT, kind: 'demand_per_kg', value: String(d.value),
          countryCodes: d.countryCodes, startsAt: d.startsAt, endsAt: d.endsAt,
          applyMode: 'always', active: true, note: d.note,
        });
      }
    }
  }

  console.log(apply ? '\nXong — đã ghi.' : '\nXong — chưa ghi gì.');
  process.exit(0);
}
void main();
