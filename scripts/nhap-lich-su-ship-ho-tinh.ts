/**
 * Nhập các đơn ship hộ TINH của KỲ CŨ (7/2025 – 4/2026) vào lịch sử hệ thống.
 *
 * Vì sao không dùng `syncLarkDonShipHo` với mốc ngày cũ hơn (CEO 19/10/2026): bộ đồng bộ chung
 * không lọc theo brand, nên hạ mốc xuống 2025 sẽ dựng lại ~80 dòng của MỌI brand — đúng cái
 * `MOC_MAC_DINH` cảnh báo là "dựng lên lịch sử mà hệ thống chưa bao giờ quản". Việc được nhờ
 * chỉ là TINH, nên script này lọc theo brand và theo khung kỳ.
 *
 * BA CHỖ KHÁC bộ đồng bộ chung, cố ý:
 *
 *   1. KHÔNG bắn `order.received` sang MMP. `taoDon` của bộ chung bắn, và MMP sẽ CẤP mã mới rồi
 *      hệ thống nhận mã đó làm `code` (xem `planCodeAdoption`) — tức là mở hồ sơ mới bên đối
 *      tác ngoài cho 18 đơn từ 2025. Chính comment trong `sync-lark-don.ts` nói lượt đẩy bù
 *      kiểu đó "phải có người quyết". Đây là nhập vào hệ thống MÌNH, không phải mở hồ sơ bên MMP.
 *
 *   2. `code` mang tiền tố `LS-` (lịch sử). Bộ chung lấy thẳng mã Lark làm `code`, nhưng mã Lark
 *      và mã MMP CÙNG KHUÔN `YY-INSLG-SV-NNNN` và hai bên đánh số độc lập: Lark đã tới ~1010,
 *      mã MMP lớn nhất trong hệ thống là 0954. Lấy `26-INSLG-SV-0442` làm `code` là đặt mìn —
 *      hôm nào MMP cấp đúng số đó thì `planCodeAdoption` ghi vào và vỡ ràng buộc unique, mà
 *      nhánh đó KHÔNG có bước tránh trùng như `maDonTrong` lúc insert. Mã Lark vẫn nằm đủ ở
 *      `lark_order_number` — đó mới là mã vận hành nói chuyện (xem `ma-hien-thi.ts`).
 *
 *   3. CÓ ghi tiền từ Lark. Bộ chung cố ý không, vì đơn đang chạy thì giá thu do hệ thống báo và
 *      giá chi lấy từ hoá đơn carrier. Mấy đơn này ĐÃ ĐÓNG từ 2025 — không có hoá đơn nào sẽ về
 *      nữa, và CEO đã chốt 19/10/2026 là giữ nguyên format giá cũ. Lịch sử không có tiền thì
 *      không phải lịch sử.
 *
 * PHẠM VI: 13 đơn BÁN LẺ trong kỳ. Đơn WholeSale cố ý KHÔNG nhập — xem `BO_WHOLESALE` dưới.
 *
 * TIỀN lấy từ `scripts/du-lieu/doi-soat-lich-su-tinh.json` (bản CEO chốt 19/10/2026, cũng là số
 * TINH đang đọc trên sheet), KHÔNG lấy thẳng cột "Brand | Tổng Thu (đ)" của Lark: cột đó không
 * cộng phí xử lý hàng hoá 25.000đ. Chênh đó là BẤT BIẾN ĐƯỢC KIỂM TRA — mỗi đơn phải lệch đúng
 * `XLHH_VND`, lệch khác là DỪNG. Bù lặng đi thì hôm nào Lark đổi cách tính là nhập ra số sai mà
 * không ai biết.
 *
 * GIÁ VỐN lấy từ Lark (`INS | Giá tổng`) — khớp cột "Giá vốn (INS)" của file ở cả 13 đơn.
 *
 * CHẠY THỬ LÀ MẶC ĐỊNH. Có `--ap-dung` mới ghi thật.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/nhap-lich-su-ship-ho-tinh.ts
 *   railway run --service Shopify-Management-System npx tsx scripts/nhap-lich-su-ship-ho-tinh.ts --ap-dung
 */
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listShipHoDonRecords } from '@/features/lark/client';
import { docDongLark, ghepBrand, duDeTao, chuoi, COT, type DongLarkDon } from '@/features/ship-ho/lark-don';
import { hangTheoMaVanDon } from '@/lib/ma-van-don';

const AP = process.argv.includes('--ap-dung');
const BRAND = 'tinh';
const TU = '2025-07-01';
const DEN = '2026-04-30';
const KIEM = 'scripts/du-lieu/doi-soat-lich-su-tinh.json';

/** Phí xử lý hàng hoá — khoản mà cột "Brand | Tổng Thu (đ)" của Lark không cộng vào. */
const XLHH_VND = 25_000;

/**
 * Tên nước trên Lark mà `nuocLarkSangIso` không đọc được, chỉ gặp ở khối TINH kỳ cũ.
 *
 * Cố ý để RIÊNG ở đây, không nhét vào `nuocLarkSangIso` dùng chung: "UK" và "USA" là mã/tên
 * người gõ tay vào ô tự do năm 2025, còn "London, England" là tên THÀNH PHỐ nằm trong ô quốc
 * gia. Sửa luật chung để nuốt mấy chuỗi đó là dạy hệ thống đoán mò trên dữ liệu đang chạy.
 *
 * "UK" đáng chú ý: `nuocLarkSangIso('UK')` trả thẳng "UK" — KHÔNG phải ISO-2 (Anh là GB). Đơn
 * mang country="UK" thì engine cước không báo được giá. Mấy đơn này đã đóng nên không re-quote
 * nữa, nhưng ghi vào cho đúng thì rẻ hơn là để lại một ô sai.
 */
const NUOC_VA: Record<string, string> = {
  'UK': 'GB',
  'USA': 'US',
  'London, England': 'GB',
  'Panama': 'PA',
};

/**
 * Đơn WholeSale KHÔNG nhập lượt này, và vì sao.
 *
 * Năm dòng WholeSale có mặt trong bảng ship hộ Lark đều THIẾU dữ liệu bắt buộc của một đơn ship
 * hộ: 0442 không có cân; 0286, 0411, 0443, 0566 không có cân lẫn mã vận đơn (0411/0566/0286 cả
 * tổng thu cũng 0). Sáu dòng còn lại (0284, 0285, 0287, 0554, 0564, 0565) không nằm trong bảng
 * ship hộ, chỉ có ở sheet "Tổng hợp đơn WholeSale".
 *
 * WholeSale tính theo phí tờ khai + uỷ quyền + stationary — mô hình đơn ship hộ không có chỗ
 * cho mấy khoản đó. Nhồi vào đây là phải bịa cân và bịa mã vận đơn cho 11 đơn. Cả 11 đơn đang
 * nằm đủ trên sheet TINH ở tab "WholeSale 11.2025-4.2026".
 */
const BO_WHOLESALE = 'đơn WholeSale — không nhập, xem ghi chú BO_WHOLESALE';

/** Tiền tố `code` cho đơn nhập lịch sử — xem đầu file, mục 2. */
const tienToLichSu = (maLark: string | null, recordId: string) => `LS-${maLark ?? recordId}`;

async function accountCuaHang(carrierKey: string | null): Promise<string | null> {
  if (!carrierKey) return null;
  const [r] = await db.select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, carrierKey), eq(schema.carrierAccounts.enabled, true)))
    .limit(1);
  return r?.id ?? null;
}

/** ISO-2 cho dòng này: bảng vá thắng, vì nó có cả chỗ Lark trả mã sai như "UK". */
function isoCuaDong(d: DongLarkDon, nuocRaw: string | null): string | null {
  if (nuocRaw && NUOC_VA[nuocRaw]) return NUOC_VA[nuocRaw];
  return d.nuoc;
}

/** Lark ghi trạng thái dispatch bằng chữ tự do; chỉ "delivery completed" mới coi là đã giao. */
const daGiao = (s: string | null) => (s ?? '').toLowerCase().includes('delivery completed');

interface Xet {
  d: DongLarkDon;
  /** Ngày Lark — nguồn chuẩn, xem `lay-ngay-lark-tinh.ts`. */
  ngay: string;
  /** Tiền THU theo bản CEO đã chốt (đã gồm XLHH). */
  thuVnd: number;
  /** Giá vốn theo Lark. */
  vonVnd: number | null;
}

async function main(): Promise<void> {
  const kiem = JSON.parse(readFileSync(KIEM, 'utf8')) as {
    chot: string;
    banLe: Array<{ ma: string; ngay: string; tongThu: number; xlhh: number }>;
  };
  const theoMa = new Map(kiem.banLe.map((x) => [x.ma, x]));

  const brands = await db.select({ slug: schema.mmpBrands.slug, ten: schema.mmpBrands.displayName })
    .from(schema.mmpBrands).where(eq(schema.mmpBrands.status, 'active'));

  const hienCo = await db.select({
    code: schema.shipHoOrders.code,
    tracking: schema.shipHoOrders.trackingNumber,
    larkRecordId: schema.shipHoOrders.larkRecordId,
  }).from(schema.shipHoOrders);
  const coTracking = new Set(hienCo.map((x) => x.tracking?.trim()).filter(Boolean) as string[]);
  const coRecord = new Set(hienCo.map((x) => x.larkRecordId).filter(Boolean) as string[]);
  const coCode = new Set(hienCo.map((x) => x.code));

  const recs = await listShipHoDonRecords();
  const cuaTinh = recs
    .map((r) => ({ d: docDongLark(r.record_id, r.fields), nuocRaw: chuoi(r.fields[COT.nuoc]) }))
    .filter((x) => ghepBrand(x.d.brandText, brands) === BRAND
      && x.d.ngayGui != null && x.d.ngayGui >= TU && x.d.ngayGui <= DEN);

  const se: Xet[] = [];
  const daCo: string[] = [];
  const boQua: string[] = [];
  const loi: string[] = [];

  for (const { d, nuocRaw } of cuaTinh) {
    const ma = d.maLark ?? d.recordId;
    const nhan = `${ma.padEnd(18)} ${d.ngayGui}`;
    const f = theoMa.get(ma);
    if (!f) { boQua.push(`${nhan} — ${BO_WHOLESALE}`); continue; }
    if ((d.trackingNumber && coTracking.has(d.trackingNumber)) || coRecord.has(d.recordId)
        || coCode.has(tienToLichSu(d.maLark, d.recordId))) { daCo.push(nhan); continue; }

    const iso = isoCuaDong(d, nuocRaw);
    const thieu = duDeTao({ ...d, nuoc: iso }, BRAND);
    if (thieu) { boQua.push(`${nhan} — ${thieu}`); continue; }

    /* Hai bất biến. Lệch là DỪNG cả lượt, không nhập một phần: nửa lô vào hệ thống còn nửa kia
     * không là trạng thái không ai dò lại được. */
    if (d.ngayGui !== f.ngay) loi.push(`${ma}: ngày Lark ${d.ngayGui} ≠ file ${f.ngay}`);
    const chenh = Math.round(f.tongThu) - Math.round(d.thuBrandThamKhaoVnd ?? 0);
    if (chenh !== XLHH_VND) {
      loi.push(`${ma}: file ${Math.round(f.tongThu)} − Lark ${Math.round(d.thuBrandThamKhaoVnd ?? 0)} = ${chenh}, chờ đúng ${XLHH_VND} (XLHH)`);
    }
    if (Math.round(f.xlhh) !== XLHH_VND) loi.push(`${ma}: cột XLHH trong file là ${Math.round(f.xlhh)}, chờ ${XLHH_VND}`);

    se.push({ d: { ...d, nuoc: iso }, ngay: d.ngayGui!, thuVnd: Math.round(f.tongThu), vonVnd: d.vonThamKhaoVnd == null ? null : Math.round(d.vonThamKhaoVnd) });
  }

  console.log(`${AP ? 'ÁP DỤNG' : 'CHẠY THỬ'} — nhập lịch sử ship hộ brand "${BRAND}", ngày gửi ${TU} → ${DEN}`);
  console.log(`Bảng Lark ${recs.length} dòng · của ${BRAND} trong khung ${cuaTinh.length} · nguồn tiền ${KIEM} chốt ${kiem.chot}\n`);

  console.log(`SẼ TẠO ${se.length} đơn:`);
  for (const x of se) {
    const hang = x.d.carrierKey ?? hangTheoMaVanDon(x.d.trackingNumber);
    console.log(`  ${tienToLichSu(x.d.maLark, x.d.recordId).padEnd(24)} ${x.ngay}  ${String(hang ?? '—').padEnd(6)} ${String(x.d.nuoc).padEnd(3)} ${String(x.d.canKg).padStart(5)}kg  thu ${x.thuVnd.toLocaleString('vi-VN').padStart(12)}  vốn ${(x.vonVnd ?? 0).toLocaleString('vi-VN').padStart(12)}`);
  }
  if (daCo.length > 0) console.log(`\nĐÃ CÓ TRONG HỆ THỐNG, bỏ qua (${daCo.length}):\n  ${daCo.join('\n  ')}`);
  if (boQua.length > 0) console.log(`\nKHÔNG NHẬP (${boQua.length}):\n  ${boQua.join('\n  ')}`);

  const thieuTrongLark = kiem.banLe.filter((x) => !se.some((y) => y.d.maLark === x.ma) && !daCo.some((t) => t.startsWith(x.ma)));
  console.log(`\nKIỂM TRA CHÉO: ${se.length} + ${daCo.length} đã có / ${kiem.banLe.length} đơn bán lẻ của file`);
  if (thieuTrongLark.length > 0) loi.push(`${thieuTrongLark.length} đơn trong file không tìm được trên Lark: ${thieuTrongLark.map((x) => x.ma).join(', ')}`);
  const tongThu = se.reduce((a, b) => a + b.thuVnd, 0);
  console.log(`  tổng thu lô sẽ tạo ${tongThu.toLocaleString('vi-VN')} đ`);

  if (loi.length > 0) {
    console.error(`\nDỪNG — ${loi.length} chỗ không khớp, không ghi gì:\n  ${loi.join('\n  ')}`);
    process.exit(1);
  }
  console.log('  ✓ ngày khớp Lark · chênh tiền đúng bằng XLHH ở mọi đơn');

  if (!AP) { console.log('\nChưa ghi gì cả. Thêm --ap-dung để ghi thật.'); process.exit(0); }

  let ok = 0;
  for (const { d, ngay, thuVnd, vonVnd } of se) {
    const carrierKey = d.carrierKey ?? hangTheoMaVanDon(d.trackingNumber);
    await db.insert(schema.shipHoOrders).values({
      code: tienToLichSu(d.maLark, d.recordId),
      partnerBrandSlug: BRAND,
      recipientName: d.nguoiNhan,
      recipientPhone: d.dienThoai,
      recipientEmail: d.email,
      country: d.nuoc!,
      city: d.thanhPho,
      postcode: d.maBuuChinh,
      address1: d.diaChi,
      houseNumber: d.soNha,
      weightKg: String(d.canKg),
      source: 'lark',
      carrierKey,
      carrierAccountId: await accountCuaHang(carrierKey),
      trackingNumber: d.trackingNumber,
      shippedAt: ngay,
      chargedVnd: String(thuVnd),
      carrierCostVnd: vonVnd == null ? null : String(vonVnd),
      larkRecordId: d.recordId,
      larkOrderNumber: d.maLark,
      brandReference: d.brandReference,
      larkSyncedAt: new Date(),
      deliveryStatus: daGiao(d.trangThaiGiao) ? 'delivered' : null,
      /* 'delivered' chứ không 'billed': 'billed' nghĩa là đã thuộc một bảng kê trong hệ thống,
       * mà mấy đơn này đối soát qua sheet TINH chứ chưa có bảng kê nào. */
      status: daGiao(d.trangThaiGiao) ? 'delivered' : 'shipped',
    });
    ok += 1;
  }
  console.log(`\n✓ đã tạo ${ok} đơn. KHÔNG gắn bảng kê, KHÔNG bắn sự kiện sang MMP.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
