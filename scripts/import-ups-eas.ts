/**
 * Nạp danh sách "Extended Area Surcharge" của UPS (sheet `EAS Definitions`)
 * vào `carrier_remote_postcodes`.
 *
 * Vì sao cần: tài khoản UPS đang có ĐÚNG 0 dòng mã bưu chính vùng xa, trong khi
 * DHL có 645.567 và FedEx 388.419. Hai dòng phụ phí `remote_fixed` của UPS
 * (tier 'Extended' 646.720 ₫ và 'Remote' 721.450 ₫) vì thế không bao giờ có gì
 * để khớp, nên mọi báo giá UPS tới địa chỉ vùng xa đều thiếu ít nhất 646.720 ₫.
 *
 * Vì sao không bung dải: 68.549 dòng bung ra là 16.905.756 mã, gấp 26 lần danh
 * sách DHL. Script ghi dòng DẢI (`range_start`/`range_end`/`range_len`, migration
 * 0161); engine khớp qua `engine/remote-range.ts`.
 *
 * Phần phân tích nằm ở `features/carrier-rates/import/ups-eas.ts` (thuần, có
 * test) — file này chỉ lo đọc xlsx và ghi DB.
 *
 * KHÔNG động vào `carrier_surcharges`: giá của ba hạng mục còn lại do CEO gửi
 * sau. Trang surcharges sẽ hiện băng cảnh báo cho những tier chưa có giá.
 *
 * Mặc định chạy thử (dry-run). Thêm --apply để ghi.
 *
 *   npx dotenv -- npx tsx scripts/import-ups-eas.ts \
 *     --file "/Users/macos/Downloads/ea-surcharge-vn-vi (1).xlsx"
 *
 *   npx dotenv -- npx tsx scripts/import-ups-eas.ts \
 *     --file "…/ea-surcharge-vn-vi (1).xlsx" --apply
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import XLSX from 'xlsx';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { phanTichEas, type DongEas } from '@/features/carrier-rates/import/ups-eas';

interface Args {
  file: string;
  account: string;
  sheet: string;
  apply: boolean;
  source: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let file = '';
  let account = 'UPS Worldwide Expedited';
  let sheet = 'EAS Definitions';
  let apply = false;
  let source = 'UPS Extended Area Surcharge 2026';
  let effectiveFrom = '2025-01-01';
  let effectiveTo: string | null = null;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--file') file = a[++i];
    else if (a[i] === '--account') account = a[++i];
    else if (a[i] === '--sheet') sheet = a[++i];
    else if (a[i] === '--apply') apply = true;
    else if (a[i] === '--source') source = a[++i];
    else if (a[i] === '--effective-from') effectiveFrom = a[++i];
    else if (a[i] === '--effective-to') effectiveTo = a[++i];
  }
  if (!file) throw new Error('--file <xlsx> là bắt buộc');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(effectiveFrom)) throw new Error(`--effective-from phải dạng YYYY-MM-DD, nhận "${effectiveFrom}"`);
  if (effectiveTo !== null && !dateRe.test(effectiveTo)) throw new Error(`--effective-to phải dạng YYYY-MM-DD, nhận "${effectiveTo}"`);
  // Kiểm tra đọc được trước khi làm gì khác — hỏng đường dẫn thì báo ngay.
  readFileSync(file);
  return { file, account, sheet, apply, source, effectiveFrom, effectiveTo };
}

/** Bỏ phần đầu sheet: file có vài dòng trống rồi hai dòng tiêu đề
 *  ("Mã bưu điện" ở dòng gộp, rồi tên cột). Tìm dòng tiêu đề thật bằng ô
 *  "Mã IATA" thay vì ghim cứng chỉ số dòng — file năm sau xê dịch là gãy. */
function catTieuDe(rows: unknown[][]): unknown[][] {
  const iTieuDe = rows.findIndex((r) => (r ?? []).some((c) => String(c ?? '').trim() === 'Mã IATA'));
  if (iTieuDe === -1) throw new Error('Không tìm thấy dòng tiêu đề (ô "Mã IATA") trong sheet');
  return rows.slice(iTieuDe + 1).filter((r) => r && r.length > 0);
}

const CHUNK = 500;

async function main(): Promise<void> {
  const args = parseArgs();

  const wb = XLSX.readFile(args.file);
  const ws = wb.Sheets[args.sheet];
  if (!ws) throw new Error(`Sheet "${args.sheet}" không có; sheet hiện có: ${wb.SheetNames.join(', ')}`);
  const raw = catTieuDe(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: true }));
  console.log(`Đọc ${raw.length.toLocaleString('vi-VN')} dòng dữ liệu từ sheet "${args.sheet}"`);

  const { dong, canhBao, thongKe } = phanTichEas(raw);

  console.log('\nDòng sẽ ghi theo tier:');
  let tong = 0;
  for (const [tier, t] of [...thongKe].sort((a, b) => (b[1].ma + b[1].dai + b[1].thanhPho) - (a[1].ma + a[1].dai + a[1].thanhPho))) {
    const n = t.ma + t.dai + t.thanhPho;
    tong += n;
    console.log(`  ${tier.padEnd(40)} ${String(n).padStart(7)}  (mã ${t.ma}, dải ${t.dai}, thành phố ${t.thanhPho})`);
  }
  console.log(`  ${'TỔNG'.padEnd(40)} ${String(tong).padStart(7)}`);

  if (canhBao.length) {
    console.log(`\n${canhBao.length} cảnh báo:`);
    for (const c of canhBao.slice(0, 40)) console.log(`  - ${c}`);
    if (canhBao.length > 40) console.log(`  … và ${canhBao.length - 40} cảnh báo nữa`);
  }

  const [acc] = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.name, args.account));
  if (!acc) throw new Error(`Không thấy carrier account "${args.account}"`);

  if (!args.apply) {
    console.log(`\n[chạy thử] sẽ ghi ${dong.length.toLocaleString('vi-VN')} dòng vào "${acc.name}". Thêm --apply để ghi thật.`);
    return;
  }

  const t = schema.carrierRemotePostcodes;
  const xoa = await db
    .delete(t)
    .where(and(eq(t.carrierAccountId, acc.id), eq(t.effectiveFrom, args.effectiveFrom)))
    .returning({ id: t.id });
  console.log(`\nXoá ${xoa.length.toLocaleString('vi-VN')} dòng cũ cùng kỳ hiệu lực (chạy lại không bị nhân đôi).`);

  for (let i = 0; i < dong.length; i += CHUNK) {
    const lat = dong.slice(i, i + CHUNK);
    await db.insert(t).values(lat.map((d: DongEas) => ({
      carrierAccountId: acc.id,
      countryCode: d.nuoc,
      postcodePattern: d.pattern,
      rangeStart: d.batDau ?? null,
      rangeEnd: d.ketThuc ?? null,
      rangeLen: d.doDai ?? null,
      tier: d.tier,
      source: args.source,
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo,
    }))).onConflictDoNothing();
    if ((i / CHUNK) % 20 === 0) console.log(`  … ${Math.min(i + CHUNK, dong.length).toLocaleString('vi-VN')}/${dong.length.toLocaleString('vi-VN')}`);
  }

  const sau = await db
    .select({ tier: t.tier, n: sql<number>`count(*)::int`, dai: sql<number>`count(range_start)::int` })
    .from(t)
    .where(eq(t.carrierAccountId, acc.id))
    .groupBy(t.tier);
  console.log('\nĐã nạp xong. Số dòng trong DB theo tier:');
  for (const r of sau) console.log(`  ${String(r.tier).padEnd(40)} ${String(r.n).padStart(7)}  (dải ${r.dai})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
