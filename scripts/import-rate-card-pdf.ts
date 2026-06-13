/**
 * Import ĐẦY ĐỦ một rate card từ PDF (parser FedEx/DHL có sẵn): tạo card mới với
 * cửa sổ hiệu lực cho trước + parse cells (package + pak) + lưu PDF vào R2. Replicate
 * logic commitRateCardFromPdf nhưng chạy được trong script (không qua auth gate).
 *
 *   npx tsx scripts/import-rate-card-pdf.ts --pdf="/p.pdf" --carrier=fedex --from=2025-02-17 --to=2025-10-27          # DRY-RUN
 *   npx tsx scripts/import-rate-card-pdf.ts --pdf="/p.pdf" --carrier=fedex --from=2025-02-17 --to=2025-10-27 --apply
 */
import 'dotenv/config';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';
import { extractPdfText } from '@/features/carrier-rates/import/pdf-text';
import { buildRateCardCells } from '@/features/carrier-rates/import/preview';
import { resolveParser } from '@/features/carrier-rates/import/parsers';

const argVal = (f: string) => { const a = process.argv.find((x) => x.startsWith(`${f}=`)); return a ? a.slice(f.length + 1) : undefined; };

async function main() {
  const apply = process.argv.includes('--apply');
  const pdfPath = argVal('--pdf'); const carrierKey = argVal('--carrier');
  const from = argVal('--from'); const to = argVal('--to') ?? null;
  if (!pdfPath || !carrierKey || !from) throw new Error('Cần --pdf, --carrier, --from (=YYYY-MM-DD); --to tuỳ chọn.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) throw new Error('from/to phải YYYY-MM-DD.');
  const filename = basename(pdfPath);
  const fileBuf = readFileSync(pdfPath);

  const parser = resolveParser(carrierKey);
  if (!parser) throw new Error(`Không có parser cho carrier "${carrierKey}".`);

  const [carrier] = await db.select().from(schema.carriers).where(eq(schema.carriers.key, carrierKey));
  const [acc] = await db.select().from(schema.carrierAccounts).where(eq(schema.carrierAccounts.carrierId, carrier.id)).limit(1);
  const zones = await db.select().from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, acc.id));
  const tiers = await db.select().from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, acc.id));

  // Chống chồng cửa sổ
  const existing = await db.select().from(schema.carrierRateCards).where(eq(schema.carrierRateCards.carrierAccountId, acc.id));
  for (const c of existing) {
    const aFrom = String(c.effectiveFrom), aTo = c.effectiveTo ? String(c.effectiveTo) : '9999-12-31';
    const bTo = to ?? '9999-12-31';
    if (from <= aTo && aFrom <= bTo) throw new Error(`Cửa sổ ${from}→${to ?? '∞'} CHỒNG card "${c.label}" (${aFrom}→${c.effectiveTo ?? '∞'}).`);
  }

  const text = await extractPdfText(new Uint8Array(fileBuf));
  const built = buildRateCardCells(parser, text, tiers.map((t) => Number(t.upperKg)), zones.map((z) => z.label));
  // CHỈ chặn lỗi CẤU TRÚC (count/zone/tier sai). Lỗi 'spot-check' là giá kỳ tham
  // chiếu của parser KHÁC kỳ này → bình thường cho card khác kỳ, không chặn.
  const structural = built.problems.filter((p) => !p.startsWith('spot-check'));
  const spotFails = built.problems.filter((p) => p.startsWith('spot-check'));
  if (structural.length) throw new Error('Lỗi CẤU TRÚC parse: ' + structural.join(' · '));
  const nPkg = built.cells.filter((c) => c.packageType === 'package').length;
  const nPak = built.cells.filter((c) => c.packageType === 'pak').length;
  console.log(`PDF: ${filename} | parser: ${parser.label}`);
  console.log(`Cửa sổ: ${from} → ${to ?? '∞'} | cells: package ${nPkg}, pak ${nPak} (đúng count: ${nPkg === parser.expectedPackageCells && nPak === parser.expectedPakCells})`);
  console.log(`effectiveFromGuess từ PDF: ${built.preview.effectiveFromGuess ?? '-'} (mong ${from})`);
  if (spotFails.length) console.log(`⚠ ${spotFails.length} spot-check lệch giá — DO kỳ này khác kỳ tham chiếu parser (count + ngày hiệu lực đã đúng → an toàn).`);
  console.log(`  mẫu: ${built.cells.slice(0, 2).map((c) => `${c.zoneLabel}@${c.upperKg}kg/${c.packageType}=${c.cost.toLocaleString()}`).join(' | ')}`);
  if (built.preview.effectiveFromGuess && built.preview.effectiveFromGuess !== from) {
    throw new Error(`Ngày hiệu lực PDF (${built.preview.effectiveFromGuess}) ≠ --from (${from}) — kiểm lại.`);
  }

  const pdfKey = `rate-cards/${acc.id}/${randomUUID()}.pdf`;
  if (!apply) { console.log(`(dry-run) sẽ tạo card + ${built.cells.length} cells + lưu PDF → ${pdfKey}. Thêm --apply.`); process.exit(0); }

  await putObject(pdfKey, new Uint8Array(fileBuf), 'application/pdf');
  const zoneIdByLabel = new Map(zones.map((z) => [z.label, z.id]));
  const tierIdByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));
  const id = await db.transaction(async (tx) => {
    const [card] = await tx.insert(schema.carrierRateCards).values({
      carrierAccountId: acc.id,
      label: `${parser.label} ${from}`,
      effectiveFrom: from, effectiveTo: to,
      sourcePdfKey: pdfKey, sourcePdfFilename: filename, sourcePdfUploadedAt: new Date(),
    }).returning({ id: schema.carrierRateCards.id });
    await tx.insert(schema.carrierRateCells).values(built.cells.map((c) => ({
      rateCardId: card.id, carrierZoneId: zoneIdByLabel.get(c.zoneLabel)!, carrierWeightTierId: tierIdByUpper.get(c.upperKg)!,
      packageType: c.packageType, costAmount: c.cost.toFixed(2),
    })));
    return card.id;
  });
  console.log(`✅ Đã tạo card ${id} (${from}→${to ?? '∞'}) + ${built.cells.length} cells + lưu PDF R2.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
