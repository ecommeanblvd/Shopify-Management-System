/**
 * Đẩy đối soát ship hộ các KỲ CŨ (7/2025 – 4/2026) lên sheet đối soát của TINH Atelier.
 *
 * Vì sao đẩy tay chứ không qua lệnh phát hành (CEO 19/10/2026: "cần TINH xem gấp"): hệ thống
 * dựng tab từ bảng kê trong SMS, mà SMS không có đơn TINH nào trước 10/07/2026. Các kỳ cũ chỉ
 * có Lark làm nguồn, và bản đã soát + CEO chốt là file `doi-soat-tinh-atelier.xlsx` (19/10).
 * Lượt đẩy này đọc JSON do `du-lieu/trich-doi-soat-tinh.py` trích ra từ chính file đó.
 *
 * HAI CHỖ KHÁC FILE EXCEL, cố ý — sheet này BRAND ĐỌC:
 *   1. KHÔNG mang cột "Giá vốn (INS)" và "Lãi thuần (INS)" lên. Bước trích đã cắt từ gốc, nên
 *      giá vốn không có đường nào chạy lên sheet brand.
 *   2. Cột "Đã thu?" để TRỐNG cho TINH điền. CEO nói "hình như đều chưa thu" — là phỏng đoán,
 *      chưa đối chiếu sổ thu. In "CHƯA THU" lên sheet brand là đòi tiền một đơn có thể đã thu.
 *
 * TÊN TAB cố ý KHÔNG khớp khuôn `<tháng>.<năm>` mà `tenTabKy` sinh ra, nên lệnh phát hành của
 * hệ thống về sau KHÔNG xoá đè mấy tab này.
 *
 * Bố cục 21 cột đầu của tab bán lẻ trùng ĐÚNG VỊ TRÍ với `COT_SHEET` — tab 8.26/9.26 mà TINH
 * đang đọc cùng bố cục, nên đặt cạnh nhau so được từng cột.
 *
 * CHẠY THỬ LÀ MẶC ĐỊNH. Có `--ap-dung` mới ghi thật.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/day-doi-soat-lich-su-tinh.ts
 *   railway run --service Shopify-Management-System npx tsx scripts/day-doi-soat-lich-su-tinh.ts --ap-dung
 */
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goiSheets, serialNgay } from '@/lib/google/sheets';
import { dayLoatTab, khoiThang, nhayTab, type TabLichSu } from '@/features/ship-ho/day-tab-lich-su';

const AP = process.argv.includes('--ap-dung');
const BRAND = 'tinh';
const NGUON = 'scripts/du-lieu/doi-soat-lich-su-tinh.json';

const TAB_TH = 'Tổng hợp 7.2025-4.2026';
const TAB_BL = 'Bán lẻ 7.2025-3.2026';
const TAB_WS = 'WholeSale 11.2025-4.2026';

interface DonBanLe {
  ma: string; ky: string; ngay: string | null; tracking: string; hang: string; nuoc: string;
  nhan: string; canKhai: number; canTinh: number; dim: string; giao: string;
  cuoc: number; pctFuel: number; fuel: number; vungXa: number; xlhh: number; kyNhan: number;
  vatKhac: number; tongThu: number;
}
interface DonWs {
  ma: string; ngay: string | null; line: string; tracking: string; ref: string; loaiHinh: string;
  phapNhan: string; aiTra: string; nhan: string; nuoc: string; kl: number; kien: string;
  toKhai: number; uyQuyen: number; stationary: number; cuoc: number; pctFuel: number;
  fuel: number; vatKhac: number; daTra: number; canThu: number; ghiChu: string;
}

/* 21 cột đầu = `COT_SHEET` y nguyên vị trí, chỉ đổi NHÃN hai cột:
 *   17 'VAT (8%)' → 'VAT / Phí khác': format giá cũ gộp VAT với phí khác vào một ô, tách ra
 *      bây giờ là bịa số.
 *   20 'Mã SMS' → trống: các đơn này chưa vào SMS. Nhập lịch sử xong thì điền được. */
const COT_BL = [
  'STT', 'Mã đơn', 'Mã tracking', 'Couriers', 'Ngày gửi', 'Cân nặng tính cước', 'Quốc gia',
  'Cước vận chuyển', '% PP Nhiên liệu', 'PP Nhiên liệu', 'PP kí nhận trực tiếp', 'PP Nhu cầu',
  'PP vùng sâu xa', 'Phí Giao nhà dân', 'PP xử lý hàng nhập', 'PP Address Correction',
  'Phụ phí khác', 'VAT / Phí khác', 'PP Xử lý hàng hóa', 'Tổng thu', 'Mã SMS',
  'Đã thu? (TINH điền)', 'Người nhận', 'Cân khai (kg)', 'Kích thước', 'Trạng thái giao',
] as const;
const TIEN_BL = [7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;
const NGAY_BL = 4;

const COT_WS = [
  'STT', 'Mã đơn', 'Ngày', 'Line ship', 'Mã tracking', 'Reference', 'Loại hình', 'Pháp nhân',
  'Bên trả cước', 'Người nhận', 'Quốc gia', 'KL (kg)', 'Số kiện | Kích thước',
  'Phí xử lý tờ khai', 'Phí uỷ quyền', 'Stationary', 'Cước vận chuyển', '% PP Nhiên liệu',
  'PP Nhiên liệu', 'VAT / Phí khác', 'Đã thanh toán', 'TỔNG CẦN THU', 'Ghi chú',
  'Đã thu? (TINH điền)',
] as const;
const TIEN_WS = [13, 14, 15, 16, 18, 19, 20, 21] as const;
const NGAY_WS = 2;

const tien = (n: number) => Math.round(n);
const pct = (n: number) => (n === 0 ? '' : `${(n * 100).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const ngayO = (iso: string | null) => (iso ? serialNgay(iso) : '');

function hangBanLe(ds: readonly DonBanLe[]): (string | number)[][] {
  return ds.map((d, i) => [
    i + 1, d.ma, d.tracking, d.hang, ngayO(d.ngay), d.canTinh, d.nuoc,
    tien(d.cuoc), pct(d.pctFuel), tien(d.fuel), tien(d.kyNhan), 0,
    tien(d.vungXa), 0, 0, 0,
    0, tien(d.vatKhac), tien(d.xlhh), tien(d.tongThu), '',
    '', d.nhan, d.canKhai, d.dim, d.giao,
  ]);
}

function hangWs(ds: readonly DonWs[]): (string | number)[][] {
  return ds.map((d, i) => [
    i + 1, d.ma, ngayO(d.ngay), d.line, d.tracking, d.ref, d.loaiHinh, d.phapNhan,
    d.aiTra, d.nhan, d.nuoc, d.kl, d.kien,
    tien(d.toKhai), tien(d.uyQuyen), tien(d.stationary), tien(d.cuoc), pct(d.pctFuel),
    tien(d.fuel), tien(d.vatKhac), tien(d.daTra), tien(d.canThu), d.ghiChu,
    '',
  ]);
}

/**
 * Nhãn kỳ có chữ "Tháng" ở đầu, KHÔNG phải "7/2025" trần.
 *
 * Vì sao: tab tổng hợp ghi `USER_ENTERED` (các ô số của nó là công thức), và Sheets đọc
 * "7/2025" thành NGÀY — ô hiện ra số serial 45839. Lần đẩy đầu 19/10/2026 ra đúng vậy.
 */
const nhanKy = (k: string) => `Tháng ${Number(k.slice(5, 7))}/${k.slice(0, 4)}`;

const COT_TH = [
  'Kỳ', 'Đơn bán lẻ', 'Tổng thu bán lẻ', 'Đơn WholeSale', 'Tổng cần thu WholeSale',
  'Tổng số đơn', 'TỔNG CẦN THU',
] as const;
const TIEN_TH = [2, 4, 6] as const;

/** Lọc ra ngày đã chắc chắn có — `khoiThang` không chịu được ô ngày trống. */
function ngayDu(ds: ReadonlyArray<{ ma: string; ngay: string | null }>): Array<{ ngay: string }> {
  return ds.map((x) => {
    if (!x.ngay) throw new Error(`${x.ma} thiếu ngày — không dựng được tổng theo tháng`);
    return { ngay: x.ngay };
  });
}

function bangTongHop(bl: readonly DonBanLe[], ws: readonly DonWs[]): (string | number)[][] {
  const kBl = khoiThang(ngayDu(bl)), kWs = khoiThang(ngayDu(ws));
  const moiKy = [...new Set([...kBl.keys(), ...kWs.keys()])].sort();
  const q = nhayTab;
  const dong: (string | number)[][] = [[...COT_TH]];
  moiKy.forEach((k, i) => {
    const h = i + 2;
    const b = kBl.get(k), w = kWs.get(k);
    dong.push([
      nhanKy(k),
      b ? `=COUNTA(${q(TAB_BL)}!B${b.tu}:B${b.den})` : 0,
      b ? `=SUM(${q(TAB_BL)}!T${b.tu}:T${b.den})` : 0,
      w ? `=COUNTA(${q(TAB_WS)}!B${w.tu}:B${w.den})` : 0,
      w ? `=SUM(${q(TAB_WS)}!V${w.tu}:V${w.den})` : 0,
      `=B${h}+D${h}`,
      `=C${h}+E${h}`,
    ]);
  });
  const cuoi = moiKy.length + 1;
  dong.push(['TỔNG', `=SUM(B2:B${cuoi})`, `=SUM(C2:C${cuoi})`, `=SUM(D2:D${cuoi})`,
    `=SUM(E2:E${cuoi})`, `=SUM(F2:F${cuoi})`, `=SUM(G2:G${cuoi})`]);
  return dong;
}

const GHI_CHU: readonly string[] = [
  'Nguồn và cách đọc',
  'Bảng này là đối soát ship hộ các kỳ TRƯỚC 7/2026 — giai đoạn chưa chạy trên hệ thống SMS. Nguồn: bảng ship hộ và sheet "Tổng hợp đơn WholeSale" trên Lark, chốt số ngày 19/10/2026.',
  'Tab "Bán lẻ 7.2025-3.2026": 13 đơn bán lẻ, 21 cột đầu đúng vị trí cột như tab 8.26 / 9.26 nên so được từng cột. Các phụ phí không có trong format giá cũ để 0.',
  'Tab "WholeSale 11.2025-4.2026": 11 đơn WholeSale. Cột "Bên trả cước" = ai trả cước vận chuyển. "Người nhận" trả cước thì bên mình chỉ thu phí xử lý tờ khai.',
  '"VAT / Phí khác" là một ô gộp: format giá cũ không tách riêng VAT, nên để nguyên thay vì tách ước.',
  'Ngày của 26-INSLG-SV-0442 và 26-INSLG-SV-0443 lấy từ bảng ship hộ — ô "Ngày Request" trên sheet WholeSale lưu thành số serial nên đọc ra sai.',
  '26-INSLG-SV-0443: đã thanh toán trực tiếp 28.994.000đ phí cước, nên cột "Đã thanh toán" là số ÂM và tổng cần thu còn 6.165.800đ.',
  'Cột "Đã thu?" đang để TRỐNG — nhờ TINH điền CÓ / CHƯA theo sổ của mình. Hai bên đối chiếu rồi mới chốt số phải thu.',
  'Các kỳ từ 7/2026 trở đi nằm ở tab 8.26 và 9.26, chạy trên hệ thống.',
];

async function main(): Promise<void> {
  const d = JSON.parse(readFileSync(NGUON, 'utf8')) as { banLe: DonBanLe[]; wholeSale: DonWs[]; chot: string };
  const bl = d.banLe, ws = d.wholeSale;

  const [dt] = await db.select({ sheetId: schema.shipHoPartners.doiSoatSheetId })
    .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, BRAND)).limit(1);
  if (!dt?.sheetId) { console.error(`brand ${BRAND} chưa gắn sheet đối soát`); process.exit(1); }

  const th = bangTongHop(bl, ws);
  const tongBl = bl.reduce((s, x) => s + x.tongThu, 0);
  const tongWs = ws.reduce((s, x) => s + x.canThu, 0);

  console.log(`${AP ? 'ÁP DỤNG' : 'CHẠY THỬ'} — sheet đối soát TINH (${dt.sheetId}), nguồn ${NGUON} chốt ${d.chot}\n`);
  console.log(`  "${TAB_TH}"  ${th.length - 1} dòng kỳ`);
  console.log(`  "${TAB_BL}"  ${bl.length} đơn · tổng thu ${Math.round(tongBl).toLocaleString('vi-VN')} đ`);
  console.log(`  "${TAB_WS}"  ${ws.length} đơn · tổng cần thu ${Math.round(tongWs).toLocaleString('vi-VN')} đ`);
  console.log('\nBảng tổng hợp sẽ ghi:');
  for (const r of th) console.log('   ' + r.map((x) => String(x)).join(' | '));

  if (!AP) {
    const meta = await goiSheets(dt.sheetId, '?fields=sheets.properties(title,index)');
    const co = (meta.sheets as { properties: { title: string; index: number } }[])
      .sort((a, b) => a.properties.index - b.properties.index).map((x) => x.properties.title);
    console.log(`\nTab đang có trên sổ: ${co.join(' · ')}`);
    const de = [TAB_TH, TAB_BL, TAB_WS].filter((t) => co.includes(t));
    console.log(de.length > 0 ? `Sẽ GHI LẠI (xoá rồi tạo mới): ${de.join(' · ')}` : 'Cả 3 tab đều là tab MỚI, không xoá gì của ai.');
    console.log('\nChưa ghi gì cả. Thêm --ap-dung để ghi thật.');
    process.exit(0);
  }

  console.log('');
  /* Tab tổng hợp ghi SAU hai tab chi tiết: ô của nó tham chiếu chéo sang chúng, và Google chốt
   * tham chiếu ngay lúc ghi — xem bẫy 1 trong `day-tab-lich-su.ts`. */
  const tabs: TabLichSu[] = [
    { ten: TAB_BL, dau: COT_BL, hang: hangBanLe(bl), cotTien: TIEN_BL, cotNgay: NGAY_BL, tong: true, kieu: 'RAW' },
    { ten: TAB_WS, dau: COT_WS, hang: hangWs(ws), cotTien: TIEN_WS, cotNgay: NGAY_WS, tong: true, kieu: 'RAW' },
    { ten: TAB_TH, dau: COT_TH, hang: th.slice(1), cotTien: TIEN_TH, cotChu: [0], tong: false, kieu: 'USER_ENTERED', ghiChu: GHI_CHU },
  ];
  await dayLoatTab(dt.sheetId, tabs, [TAB_TH, TAB_BL, TAB_WS], (x) => console.log(x));
  console.log('✓ đã xếp 3 tab lên đầu sổ, trước 8.26');
  console.log(`\nXong. https://docs.google.com/spreadsheets/d/${dt.sheetId}/edit`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
