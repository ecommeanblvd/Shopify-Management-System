/**
 * Nạp phần "Documents up to 2.0 KG" (= PAK của DHL) từ PDF DHL 2026 vào card DHL
 * hiện hành (effective_to IS NULL), package_type='pak'. ĐỒNG THỜI lưu PDF vào R2
 * (bằng chứng) + gắn source_pdf_key/filename vào card (card migrate trước đây thiếu).
 *
 * Non-doc trong PDF đã verify khớp 600/600 package DB → KHÔNG đụng package, chỉ thêm pak.
 *
 *   npx tsx scripts/import-dhl-2026-documents.ts            # DRY-RUN
 *   npx tsx scripts/import-dhl-2026-documents.ts --apply    # ghi R2 + DB
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { and, eq, ilike, isNull, sql } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';

const PDF_PATH = '/Users/macos/Downloads/DHL - 2026.pdf';
const PDF_FILENAME = 'DHL - 2026.pdf';
const PAK_TIERS = [0.5, 1.0, 1.5, 2.0];

/** Parse bảng "Documents up to 2.0 KG" → { kg: number[10] } (zone 1..10). */
function parseDocumentsTable(text: string): Record<string, number[]> {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const from = lines.findIndex((l) => /^Documents up to 2\.0 KG/i.test(l));
  const to = lines.findIndex((l) => /^Non-documents from 0\.5 KG/i.test(l));
  const out: Record<string, number[]> = {};
  for (let i = from + 2; i < to; i++) {
    const m = lines[i].match(/^(\d+(?:\.\d+)?)\s+((?:[\d,]+\s*){10})$/);
    if (m) out[m[1]] = m[2].trim().split(/\s+/).map((s) => Number(s.replace(/,/g, '')));
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const fileBuf = readFileSync(PDF_PATH);
  // PDFParse detach buffer nó nhận → đưa COPY riêng, giữ fileBuf cho upload.
  const text = (await new PDFParse({ data: new Uint8Array(fileBuf) }).getText()).text;
  const doc = parseDocumentsTable(text);
  const kgs = Object.keys(doc).map(Number).sort((a, b) => a - b);
  console.log('Documents(PAK) parse được bậc:', kgs.join(','));
  if (kgs.length !== PAK_TIERS.length) throw new Error(`Mong ${PAK_TIERS.length} bậc PAK, parse ra ${kgs.length}`);

  const [dhl] = await db.select().from(schema.carrierAccounts).where(ilike(schema.carrierAccounts.name, '%DHL%')).limit(1);
  const [card] = await db.select().from(schema.carrierRateCards)
    .where(and(eq(schema.carrierRateCards.carrierAccountId, dhl.id), isNull(schema.carrierRateCards.effectiveTo))).limit(1);
  console.log('Card DHL hiện hành:', card.label, card.id);

  const zones = await db.select().from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, dhl.id));
  const zoneByLabel = new Map(zones.map((z) => [z.label, z.id]));
  const tiers = await db.select().from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, dhl.id));
  const tierByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));

  // build pak cells
  const cells: Array<{ zoneId: string; tierId: string; cost: number; label: string }> = [];
  for (const kg of PAK_TIERS) {
    const row = doc[String(kg.toFixed(1))] ?? doc[String(kg)];
    if (!row) throw new Error(`Thiếu dòng Documents bậc ${kg}kg`);
    const tierId = tierByUpper.get(kg);
    if (!tierId) throw new Error(`Account thiếu tier ${kg}kg`);
    for (let zi = 0; zi < 10; zi++) {
      const zoneId = zoneByLabel.get(`Zone ${zi + 1}`);
      if (!zoneId) throw new Error(`Thiếu zone "Zone ${zi + 1}"`);
      cells.push({ zoneId, tierId, cost: row[zi], label: `Zone ${zi + 1} @${kg}kg` });
    }
  }
  console.log(`Sẽ upsert ${cells.length} pak cells (4 bậc × 10 zone).`);
  console.log('  mẫu:', cells.slice(0, 2).map((c) => `${c.label}=${c.cost.toLocaleString()}`).join(' | '), '…', `Zone9@0.5kg=${cells.find((c) => c.label === 'Zone 9 @0.5kg')?.cost.toLocaleString()}`);

  const pdfKey = `rate-cards/${dhl.id}/${randomUUID()}.pdf`;
  console.log(apply ? `Sẽ lưu PDF → R2: ${pdfKey}` : `(dry-run) PDF sẽ lưu → ${pdfKey}`);

  if (apply) {
    await putObject(pdfKey, new Uint8Array(fileBuf), 'application/pdf');
    await db.transaction(async (tx) => {
      await tx.update(schema.carrierRateCards).set({
        sourcePdfKey: pdfKey, sourcePdfFilename: PDF_FILENAME, sourcePdfUploadedAt: new Date(),
      }).where(eq(schema.carrierRateCards.id, card.id));
      for (const c of cells) {
        await tx.insert(schema.carrierRateCells).values({
          rateCardId: card.id, carrierZoneId: c.zoneId, carrierWeightTierId: c.tierId,
          packageType: 'pak', costAmount: c.cost.toFixed(2),
        }).onConflictDoUpdate({
          target: [schema.carrierRateCells.rateCardId, schema.carrierRateCells.carrierZoneId, schema.carrierRateCells.carrierWeightTierId, schema.carrierRateCells.packageType],
          set: { costAmount: c.cost.toFixed(2), updatedAt: sql`now()` },
        });
      }
    });
    console.log('✅ Đã lưu PDF vào R2 + gắn card + nạp pak.');
  } else {
    console.log('(dry-run — thêm --apply để ghi.)');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
