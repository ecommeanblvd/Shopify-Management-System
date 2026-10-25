/**
 * Đối soát tồn kho Lark ↔ SMS, và NÓI RA nguyên nhân từng chỗ lệch.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/du-lieu/doi-soat-ton-kho.ts
 *   ... --csv /tmp/doi-soat-ton-kho.csv     # xuất chi tiết từng dòng để mở Excel
 *
 * **CHỈ ĐỌC.** Không có cờ ghi, không gọi `applyMovement`, không chạm bảng nào. Muốn ghi thì
 * dùng chính job `dong-bo-ton-kho-lark` với `WH_TON_KHO_LARK=ghi-that` — một đường ghi duy
 * nhất, đi qua sổ cái để giữ `qty_reserved`.
 *
 * Phải chạy qua `railway run` vì credential Lark **chỉ** có trên Railway (máy dev không có
 * `LARK_APP_ID`, đúng chủ trương).
 *
 * Vì sao cần script này dù cron đã chạy mỗi giờ: cron chạy THỬ rồi bị chốt chặn từ chối ghi
 * (`lyDoTuChoiGhi`), và báo cáo của nó nằm trong `job_runs.summary` — phải mở `/f/jobs` mới
 * đọc được, lại không có chi tiết từng dòng. Script này in thẳng ra terminal và xuất CSV.
 *
 * DÙNG LẠI đúng ba hàm thuần của cron (`larkStockCounts` → `reconcilePlan` →
 * `phanLoaiVeKhong`). KHÔNG tự tính lại: "cùng một sự thật, hai nơi tự tính riêng" là đúng
 * lỗi đã ghi ở D-125, và nếu script lệch với cron thì con số nào cũng mất giá trị.
 */
import { writeFileSync } from 'node:fs';
import { db, schema } from '@/db/client';
import { listWarehouseStockRecords } from '@/features/lark/client';
import { larkText } from '@/features/lark/parse-pack-row';
import {
  larkNumber,
  larkStockCounts,
  phanLoaiVeKhong,
  reconcilePlan,
  lyDoTuChoiGhi,
  type CurrentInv,
  type LarkStockRow,
  type ReconcileItem,
} from '@/features/warehouse/lark-sync-logic';

/** Brand = đoạn đầu SKU trước dấu `-`. Đủ để biết "tồn của brand nào đang lệch". */
function brandCua(sku: string): string {
  const i = sku.indexOf('-');
  return i > 0 ? sku.slice(0, i) : sku;
}

function bang(ten: string, rows: Array<Record<string, string | number>>): void {
  if (!rows.length) { console.log(`  (${ten}: không có)`); return; }
  const cols = Object.keys(rows[0]!);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  console.log('  ' + cols.map((c, i) => c.padEnd(w[i]!)).join('  '));
  for (const r of rows) console.log('  ' + cols.map((c, i) => String(r[c]).padEnd(w[i]!)).join('  '));
}

async function main(): Promise<void> {
  const csvAt = process.argv.indexOf('--csv');
  const csvPath = csvAt >= 0 ? process.argv[csvAt + 1] : null;

  // ── Hai nguồn ───────────────────────────────────────────────────────────────
  const recs = await listWarehouseStockRecords();
  const rows: LarkStockRow[] = recs.map((r) => ({
    sku: larkText(r.fields['Lineitem SKU final']),
    warehouseRaw: larkText(r.fields['Warehouse']) ?? '',
    // 'Final stock' là field CÔNG THỨC ({type,value:[n]}) → larkNumber, KHÔNG larkText.
    finalStock: larkNumber(r.fields['Final stock']),
    productTitle: larkText(r.fields['Lineitem Name']),
  }));
  const lark = larkStockCounts(rows);

  const invRows = await db.select({
    sku: schema.warehouseInventory.sku,
    warehouseCode: schema.warehouseInventory.warehouseCode,
    qtyOnHand: schema.warehouseInventory.qtyOnHand,
    qtyReserved: schema.warehouseInventory.qtyReserved,
  }).from(schema.warehouseInventory);
  const current: CurrentInv[] = invRows;

  const plan = reconcilePlan(lark, current);
  const tach = phanLoaiVeKhong(lark, plan);
  const themMoi = plan.filter((p) => p.isNew);
  const suaSo = plan.filter((p) => !p.isNew && p.targetOnHand !== 0);
  const tuChoi = lyDoTuChoiGhi(rows.length, plan, current, lark);

  const chiecLark = [...lark.values()].reduce((s, v) => s + v.qty, 0);
  const chiecSms = current.reduce((s, c) => s + c.qtyOnHand, 0);

  console.log('════ ĐỐI SOÁT TỒN KHO Lark ↔ SMS ════');
  console.log(`Lark view "Qly tồn kho tổng hợp": ${recs.length} dòng · ${lark.size} cặp (sku,kho) · ${chiecLark} chiếc`);
  console.log(`SMS warehouse_inventory         : ${current.length} dòng · ${chiecSms} chiếc · ${current.filter((c) => c.qtyReserved > 0).length} dòng đang bị allocator giữ`);
  console.log(`\nKẾT LUẬN: ${plan.length === 0 ? 'KHỚP HOÀN TOÀN' : `LỆCH ${plan.length} dòng`}`);
  if (!plan.length) { console.log('Hai bên đã khớp — đẩy sang MMP được.'); process.exit(0); }

  // ── Câu hỏi CẤU TRÚC: view Lark có bao giờ nói "0" không? ──────────────────
  // Nếu KHÔNG, thì "Lark im" là cách DUY NHẤT để diễn đạt số 0, và nhóm B không còn là
  // "chưa kết luận được" mà là "hết hàng" — đổi hẳn kết luận. Phải đo, không được đoán.
  const capBang0 = [...lark.values()].filter((v) => v.qty === 0).length;
  const capAm = [...lark.values()].filter((v) => v.qty < 0).length;
  console.log('\n──── View Lark có diễn đạt số 0 không? ────');
  console.log(`  cặp (sku,kho) có Final stock = 0 : ${capBang0}`);
  console.log(`  cặp có Final stock < 0           : ${capAm}`);
  console.log(capBang0 === 0
    ? '  → View KHÔNG BAO GIỜ nói 0 (là view "hàng đang có"). Nên "Lark im" = hết hàng,\n'
      + '    và nhóm B KHÔNG phải "chưa kết luận được" — trừ phần B1 lệch kho.'
    : '  → View CÓ nói 0, nên "Lark im" thật sự là bất thường, không phải cách ghi số 0.');

  console.log('\n──── Lệch chia theo loại ────');
  bang('loại', [
    { loai: 'Thêm mới (Lark có, SMS chưa có)', dong: themMoi.length, chiec: themMoi.reduce((s, p) => s + p.targetOnHand, 0) },
    { loai: 'Sửa số (hai bên khác số)', dong: suaSo.length, chiec: suaSo.reduce((s, p) => s + Math.abs(p.deltaOnHand), 0) },
    { loai: 'ĐƯA VỀ 0 (xem tách bên dưới)', dong: tach.larkNoi0.length + tach.larkIm.length, chiec: tach.chiecMatLarkNoi0 + tach.chiecMatLarkIm },
  ]);

  console.log('\n──── "Đưa về 0" tách theo NGUYÊN NHÂN — phần quyết định ────');
  bang('nguyên nhân', [
    { nguyen_nhan: 'A · Lark NÓI bằng 0', dong: tach.larkNoi0.length, chiec: tach.chiecMatLarkNoi0, ket_luan: 'TIN ĐƯỢC — SMS đang cũ' },
    { nguyen_nhan: 'B1 · Lark im, SKU ở KHO KHÁC', dong: tach.khoKhac.length, chiec: tach.khoKhac.reduce((s, p) => s - p.deltaOnHand, 0), ket_luan: 'NGHI LỆCH ÁNH XẠ KHO' },
    { nguyen_nhan: 'B2 · Lark im, SKU không hề có', dong: tach.larkImThatSu.length, chiec: tach.larkImThatSu.reduce((s, p) => s - p.deltaOnHand, 0), ket_luan: 'CHƯA KẾT LUẬN ĐƯỢC' },
  ]);

  if (tach.khoKhac.length) {
    console.log('\n──── B1 · nghi lệch ánh xạ kho (15 dòng đầu) ────');
    const khoCua = (sku: string) => [...lark.keys()]
      .filter((k) => k.slice(0, k.lastIndexOf('|')) === sku)
      .map((k) => `${k.slice(k.lastIndexOf('|') + 1)}=${lark.get(k)!.qty}`).join(' ');
    bang('B1', tach.khoKhac.slice(0, 15).map((p) => ({
      sku: p.sku, SMS_kho: p.warehouseCode, SMS_co: -p.deltaOnHand, Lark_o_kho: khoCua(p.sku),
    })));
    console.log('  → Nếu phần lớn B1 chỉ là cùng SKU ở kho khác, gốc nằm ở `mapWarehouseCode`');
    console.log('    (features/warehouse/item-import-logic.ts), KHÔNG phải dữ liệu. Sửa một chỗ là khớp cả.');
  }

  console.log('\n──── Lệch theo BRAND (10 brand lệch nhiều nhất) ────');
  const theoBrand = new Map<string, { dong: number; chiec: number }>();
  for (const p of plan) {
    const b = brandCua(p.sku);
    const cur = theoBrand.get(b) ?? { dong: 0, chiec: 0 };
    cur.dong += 1; cur.chiec += Math.abs(p.deltaOnHand);
    theoBrand.set(b, cur);
  }
  bang('brand', [...theoBrand.entries()].sort((a, b) => b[1].dong - a[1].dong).slice(0, 10)
    .map(([brand, v]) => ({ brand, dong_lech: v.dong, chiec_lech: v.chiec })));

  if (tach.larkImThatSu.length) {
    const tuoi = await db.select({
      sku: schema.warehouseInventory.sku,
      warehouseCode: schema.warehouseInventory.warehouseCode,
      updatedAt: schema.warehouseInventory.updatedAt,
    }).from(schema.warehouseInventory);
    const key = (a: string, b: string) => `${a}|${b}`;
    const theoKey = new Map(tuoi.map((t) => [key(t.sku, t.warehouseCode), t.updatedAt]));
    const ngay = (d?: Date) => d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : -1;
    const tuoiB2 = tach.larkImThatSu
      .map((p) => ngay(theoKey.get(key(p.sku, p.warehouseCode))))
      .filter((n) => n >= 0).sort((a, b) => a - b);
    if (tuoiB2.length) {
      const q = (f: number) => tuoiB2[Math.min(tuoiB2.length - 1, Math.floor(tuoiB2.length * f))]!;
      console.log('\n──── B2 cũ bao lâu rồi? (ngày kể từ lần SMS sửa cuối) ────');
      console.log(`  nhỏ nhất ${tuoiB2[0]} · 25% ${q(0.25)} · giữa ${q(0.5)} · 75% ${q(0.75)} · lớn nhất ${tuoiB2[tuoiB2.length - 1]}`);
      console.log(`  → Càng cũ càng ủng hộ "đã bán/xuất từ lâu mà SMS không biết"; còn mới thì nghi lỗi đọc view.`);
    }
  }

  console.log('\n──── Chốt chặn ghi ────');
  console.log(tuChoi ? `  TỪ CHỐI: ${tuChoi}` : '  Không chặn — chạy job với WH_TON_KHO_LARK=ghi-that là ghi được.');

  if (csvPath) {
    const nhom = (p: ReconcileItem): string =>
      p.isNew ? 'them-moi'
      : p.targetOnHand !== 0 ? 'sua-so'
      : tach.larkNoi0.includes(p) ? 'A-lark-noi-0'
      : tach.khoKhac.includes(p) ? 'B1-nghi-lech-kho'
      : 'B2-lark-im';
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['nhom,sku,brand,kho,sms_dang_co,lark_dich,chenh,cham_tran_reserved']
      .concat(plan.map((p) => [
        nhom(p), p.sku, brandCua(p.sku), p.warehouseCode,
        p.targetOnHand - p.deltaOnHand, p.targetOnHand, p.deltaOnHand, p.cappedByReserved ? 'co' : '',
      ].map(esc).join(',')));
    writeFileSync(csvPath, '﻿' + csv.join('\n'), 'utf8'); // BOM để Excel đọc đúng tiếng Việt
    console.log(`\nĐã xuất ${plan.length} dòng chi tiết: ${csvPath}`);
  }

  console.log('\n──── Đẩy sang MMP được chưa? ────');
  if (tach.larkIm.length === 0) {
    console.log('  ĐƯỢC. Mọi chỗ lệch đều do Lark nói rõ số — SMS chỉ đang cũ. Đồng bộ rồi đẩy.');
  } else {
    console.log(`  CHƯA. Còn ${tach.larkIm.length} dòng (${tach.chiecMatLarkIm} chiếc) mà Lark KHÔNG nhắc tới.`);
    console.log('  Đẩy lúc này thì hoặc MMP gỡ bán hàng VẪN CÒN trong kho, hoặc đăng bán hàng ĐÃ HẾT');
    console.log('  → oversell với khách. Phân định nhóm B trước đã.');
  }
  process.exit(0);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
