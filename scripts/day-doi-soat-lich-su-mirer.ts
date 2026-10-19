/**
 * Đẩy đối soát WholeSale các KỲ CŨ (12/2025 – 4/2026) lên sheet đối soát của Mirer.
 *
 * Nguồn: `scripts/du-lieu/wholesale-lark.json` do `trich-wholesale-lark.ts` trích từ sheet Lark
 * wiki "Tổng hợp đơn WholeSale" — cùng nguồn đã dựng file `doi-soat-mirer-wholesale.xlsx`.
 *
 * Mirer khác TINH: KHÔNG có tab bán lẻ, vì không có đơn bán lẻ kỳ cũ nào. Bảng ship hộ Lark chỉ
 * có 4 dòng Mirer — 0463/0467 chính là đơn WholeSale (nằm cả hai bảng, số khớp nhau), 0627 đã
 * lên bảng kê 9.26 của hệ thống, và 0572 chưa từng được định giá.
 *
 * BA CHỖ cố ý KHÔNG đẩy lên sheet brand:
 *   1. Giá vốn và lãi thuần. Chỉ có ở sheet nội bộ trong file Excel.
 *   2. Dòng `26-INSLG-SV-0572`. Cột "Cước tính" trên Lark còn trống nên chưa có giá thu thật;
 *      đưa lên sheet brand là đòi một số chưa ai chốt. Đang chờ Đức trả lời.
 *   3. Giá trị cột "Đã thu?" — để TRỐNG cho Mirer điền. CEO nói "hình như đều chưa thu", là
 *      phỏng đoán chưa đối chiếu sổ thu.
 *
 * Tên tab cố ý KHÔNG khớp khuôn `<tháng>.<năm>` nên lệnh phát hành của hệ thống không xoá đè.
 *
 * CHẠY THỬ LÀ MẶC ĐỊNH. Có `--ap-dung` mới ghi thật.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/day-doi-soat-lich-su-mirer.ts
 *   railway run --service Shopify-Management-System npx tsx scripts/day-doi-soat-lich-su-mirer.ts --ap-dung
 */
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goiSheets, serialNgay } from '@/lib/google/sheets';
import { dayLoatTab, khoiThang, nhayTab, type TabLichSu } from '@/features/ship-ho/day-tab-lich-su';

const AP = process.argv.includes('--ap-dung');
const BRAND = 'mirer';
const NGUON = 'scripts/du-lieu/wholesale-lark.json';

const TAB_TH = 'Tổng hợp 12.2025-4.2026';
const TAB_WS = 'WholeSale 12.2025-4.2026';

interface DonWs {
  ma: string; ngay: string; suyLuanNgay?: true; lineShip: string; tracking: string; ref: string;
  loaiHinh: string; phapNhan: string; aiTra: string; nhan: string; nuoc: string; kl: number;
  kien: string; toKhai: number; uyQuyen: number; stationary: number; cuoc: number;
  pctFuel: number; fuel: number; vatKhac: number; daTra: number; canThu: number; ghiChu: string;
}

const COT_WS = [
  'STT', 'Mã đơn', 'Ngày', 'Line ship', 'Mã tracking', 'Reference', 'Loại hình', 'Pháp nhân',
  'Bên trả cước', 'Người nhận', 'Quốc gia', 'KL (kg)', 'Số kiện | Kích thước',
  'Phí xử lý tờ khai', 'Phí uỷ quyền', 'Stationary', 'Cước vận chuyển', '% PP Nhiên liệu',
  'PP Nhiên liệu', 'VAT / Phí khác', 'Đã thanh toán', 'TỔNG CẦN THU', 'Ghi chú',
  'Đã thu? (Mirer điền)',
] as const;
const TIEN_WS = [13, 14, 15, 16, 18, 19, 20, 21] as const;
const NGAY_WS = 2;

const COT_TH = ['Kỳ', 'Số đơn WholeSale', 'TỔNG CẦN THU'] as const;
const TIEN_TH = [2] as const;

const tien = (n: number) => Math.round(n);
const pct = (n: number) => (n === 0 ? '' : `${(n * 100).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

function hangWs(ds: readonly DonWs[]): (string | number)[][] {
  return ds.map((d, i) => [
    i + 1, d.ma, serialNgay(d.ngay), d.lineShip, d.tracking, d.ref, d.loaiHinh, d.phapNhan,
    d.aiTra, d.nhan, d.nuoc, d.kl, d.kien,
    tien(d.toKhai), tien(d.uyQuyen), tien(d.stationary), tien(d.cuoc), pct(d.pctFuel),
    tien(d.fuel), tien(d.vatKhac), tien(d.daTra), tien(d.canThu), d.ghiChu, '',
  ]);
}

/** Nhãn kỳ có chữ "Tháng" ở đầu — `USER_ENTERED` + locale vi_VN đọc "12/2025" thành NGÀY. */
const nhanKy = (k: string) => `Tháng ${Number(k.slice(5, 7))}/${k.slice(0, 4)}`;

function bangTongHop(ws: readonly DonWs[]): (string | number)[][] {
  const kWs = khoiThang(ws);
  const dong: (string | number)[][] = [[...COT_TH]];
  for (const k of [...kWs.keys()].sort()) {
    const w = kWs.get(k)!;
    dong.push([
      nhanKy(k),
      `=COUNTA(${nhayTab(TAB_WS)}!B${w.tu}:B${w.den})`,
      `=SUM(${nhayTab(TAB_WS)}!V${w.tu}:V${w.den})`,
    ]);
  }
  const cuoi = dong.length;
  dong.push(['TỔNG', `=SUM(B2:B${cuoi})`, `=SUM(C2:C${cuoi})`]);
  return dong;
}

const GHI_CHU: readonly string[] = [
  'Nguồn và cách đọc',
  'Bảng này là đối soát các đơn WholeSale kỳ 12/2025 – 4/2026, giai đoạn chưa chạy trên hệ thống SMS. Nguồn: sheet "Tổng hợp đơn WholeSale" trên Lark, chốt số ngày 19/10/2026.',
  'Cột "Bên trả cước" = ai trả cước vận chuyển. "Người gửi" (bên MEAN BLVD) trả thì bên mình thu lại cả cước; "Người nhận" trả thì bên mình chỉ thu phí xử lý tờ khai + uỷ quyền + stationary.',
  'Hai đơn 26-INSLG-SV-0463 và 26-INSLG-SV-0467 là loại "Người gửi" trả cước, nên tổng cần thu của chúng bao gồm cả cước và phụ phí nhiên liệu.',
  'Ngày của 25-INSLG-SV-0369 và 25-INSLG-SV-0370 đang chờ xác nhận lại: ô ngày trên sheet nguồn lưu dạng số nên phải suy ra. Số tiền không phụ thuộc vào việc này.',
  'Cột "Đã thu?" đang để TRỐNG — nhờ Mirer điền CÓ / CHƯA theo sổ của mình. Hai bên đối chiếu rồi mới chốt số phải thu.',
  'Kỳ 9/2026 nằm ở tab 9.26, chạy trên hệ thống.',
];

async function main(): Promise<void> {
  const d = JSON.parse(readFileSync(NGUON, 'utf8')) as { chot: string; brand: Record<string, DonWs[]> };
  const ws = d.brand[BRAND];
  if (!ws || ws.length === 0) { console.error(`${NGUON} không có đơn nào của brand "${BRAND}"`); process.exit(1); }

  const [dt] = await db.select({ sheetId: schema.shipHoPartners.doiSoatSheetId })
    .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, BRAND)).limit(1);
  if (!dt?.sheetId) { console.error(`brand ${BRAND} chưa gắn sheet đối soát`); process.exit(1); }

  const th = bangTongHop(ws);
  const tong = ws.reduce((s, x) => s + x.canThu, 0);

  console.log(`${AP ? 'ÁP DỤNG' : 'CHẠY THỬ'} — sheet đối soát Mirer (${dt.sheetId}), nguồn ${NGUON} chốt ${d.chot}\n`);
  console.log(`  "${TAB_WS}"  ${ws.length} đơn · tổng cần thu ${Math.round(tong).toLocaleString('vi-VN')} đ`);
  console.log(`  "${TAB_TH}"  ${th.length - 2} kỳ`);
  const suy = ws.filter((x) => x.suyLuanNgay);
  if (suy.length > 0) console.log(`  ⚠ ${suy.length} đơn có ngày SUY LUẬN: ${suy.map((x) => `${x.ma} → ${x.ngay}`).join(', ')}`);
  console.log('\nBảng tổng hợp sẽ ghi:');
  for (const r of th) console.log('   ' + r.map(String).join(' | '));

  if (!AP) {
    const meta = await goiSheets(dt.sheetId, '?fields=sheets.properties(title,index)');
    const co = (meta.sheets as { properties: { title: string; index: number } }[])
      .sort((a, b) => a.properties.index - b.properties.index).map((x) => x.properties.title);
    console.log(`\nTab đang có trên sổ: ${co.join(' · ')}`);
    const de = [TAB_TH, TAB_WS].filter((t) => co.includes(t));
    console.log(de.length > 0 ? `Sẽ GHI LẠI (xoá rồi tạo mới): ${de.join(' · ')}` : 'Cả 2 tab đều là tab MỚI, không xoá gì của ai.');
    console.log('\nChưa ghi gì cả. Thêm --ap-dung để ghi thật.');
    process.exit(0);
  }

  console.log('');
  /* Tab tổng hợp ghi SAU tab chi tiết: ô của nó tham chiếu chéo, Google chốt tham chiếu ngay
   * lúc ghi — xem bẫy 1 trong `day-tab-lich-su.ts`. */
  const tabs: TabLichSu[] = [
    { ten: TAB_WS, dau: COT_WS, hang: hangWs(ws), cotTien: TIEN_WS, cotNgay: NGAY_WS, tong: true, kieu: 'RAW' },
    { ten: TAB_TH, dau: COT_TH, hang: th.slice(1), cotTien: TIEN_TH, cotChu: [0], tong: false, kieu: 'USER_ENTERED', ghiChu: GHI_CHU },
  ];
  await dayLoatTab(dt.sheetId, tabs, [TAB_TH, TAB_WS], (x) => console.log(x));
  console.log('✓ đã xếp 2 tab lên đầu sổ, trước 9.26');
  console.log(`\nXong. https://docs.google.com/spreadsheets/d/${dt.sheetId}/edit`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
