/**
 * Nạp phần "Documents up to 2.0 KG" (= PAK của DHL) từ một PDF rate-card DHL vào
 * đúng card theo NĂM ("Ratecard as of: DD-Mon-YYYY" trong PDF), package_type='pak'.
 * ĐỒNG THỜI lưu PDF vào R2 (bằng chứng) + gắn source_pdf_key/filename vào card.
 *
 * Verify: Non-doc trong PDF phải khớp 100% package DB của card đó trước khi nạp.
 *
 *   npx tsx scripts/import-dhl-documents.ts --pdf="/path/DHL 2025.pdf"           # DRY-RUN
 *   npx tsx scripts/import-dhl-documents.ts --pdf="/path/DHL 2025.pdf" --apply   # ghi R2 + DB
 */
import 'dotenv/config';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';

const PAK_TIERS = [0.5, 1.0, 1.5, 2.0];
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function argVal(flag: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
}

/** Parse bảng "Documents up to 2.0 KG" → { kg: number[10] } (zone 1..10). */
function parseDocumentsTable(lines: string[]): Record<string, number[]> {
  const from = lines.findIndex((l) => /^Documents up to 2\.0 KG/i.test(l));
  const to = lines.findIndex((l) => /^Non-documents from 0\.5 KG/i.test(l));
  const out: Record<string, number[]> = {};
  if (from < 0 || to < 0) return out;
  for (let i = from + 2; i < to; i++) {
    const m = lines[i].match(/^(\d+(?:\.\d+)?)\s+((?:[\d,]+\s*){10})$/);
    if (m) out[m[1]] = m[2].trim().split(/\s+/).map((s) => Number(s.replace(/,/g, '')));
  }
  return out;
}

/** Parse bảng Non-documents → { kg: number[10] } để verify với DB. */
function parseNonDocTable(lines: string[]): Record<string, number[]> {
  const from = lines.findIndex((l) => /^Non-documents from 0\.5 KG/i.test(l));
  const to = lines.findIndex((l, i) => i > from && /Multiplier/i.test(l));
  const out: Record<string, number[]> = {};
  for (let i = from + 2; i < (to < 0 ? lines.length : to); i++) {
    const m = lines[i].match(/^(\d+(?:\.\d+)?)\s+((?:[\d,]+\s*){10})$/);
    if (m) out[m[1]] = m[2].trim().split(/\s+/).map((s) => Number(s.replace(/,/g, '')));
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pdfPath = argVal('--pdf');
  if (!pdfPath) throw new Error('Cần --pdf="/đường/dẫn.pdf"');
  const filename = basename(pdfPath);
  const fileBuf = readFileSync(pdfPath);
  const text = (await new PDFParse({ data: new Uint8Array(fileBuf) }).getText()).text;
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  // Năm hiệu lực từ "Ratecard as of: DD-Mon-YYYY"
  const asOf = text.match(/Ratecard as of:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!asOf) throw new Error('Không tìm thấy "Ratecard as of" trong PDF.');
  const year = Number(asOf[3]);
  const effFrom = `${year}-${String(MONTHS[asOf[2].toLowerCase()]).padStart(2, '0')}-${String(Number(asOf[1])).padStart(2, '0')}`;
  console.log(`PDF: ${filename} | Ratecard as of: ${asOf[0].replace('Ratecard as of:', '').trim()} → năm ${year} (eff_from ${effFrom})`);

  const [dhl] = await db.select().from(schema.carrierAccounts).where(ilike(schema.carrierAccounts.name, '%DHL%')).limit(1);
  const cards = await db.select().from(schema.carrierRateCards)
    .where(and(eq(schema.carrierRateCards.carrierAccountId, dhl.id), sql`extract(year from ${schema.carrierRateCards.effectiveFrom}) = ${year}`));
  if (cards.length !== 1) throw new Error(`Cần đúng 1 card DHL năm ${year}, tìm thấy ${cards.length}.`);
  const card = cards[0];
  console.log('Card đích:', card.label, '| eff', card.effectiveFrom, '→', card.effectiveTo ?? '∞');

  const doc = parseDocumentsTable(lines);
  if (Object.keys(doc).length !== PAK_TIERS.length) throw new Error(`Mong ${PAK_TIERS.length} bậc Documents, parse ${Object.keys(doc).length}.`);

  // Verify Non-doc khớp DB package của card này.
  const nd = parseNonDocTable(lines);
  const dbc = await db.execute(sql`select z.label zone, wt.upper_kg::float up, c.cost_amount::float cost from carrier_rate_cells c join carrier_zones z on z.id=c.carrier_zone_id join carrier_weight_tiers wt on wt.id=c.carrier_weight_tier_id where c.rate_card_id=${card.id} and c.package_type='package'`);
  const dbMap = new Map((dbc.rows as Array<{ zone: string; up: number; cost: number }>).map((r) => [`${r.zone}|${r.up}`, Math.round(r.cost)]));
  let ok = 0, bad = 0;
  for (const [kg, nums] of Object.entries(nd)) nums.forEach((v, zi) => { const d = dbMap.get(`Zone ${zi + 1}|${Number(kg)}`); if (d === undefined) return; if (d === v) ok++; else bad++; });
  console.log(`Verify Non-doc vs DB package: khớp ${ok}, lệch ${bad}`);
  if (bad > 0) throw new Error('Non-doc PDF KHÔNG khớp DB — dừng, không nạp (sai card/PDF?).');

  const zones = await db.select().from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, dhl.id));
  const zoneByLabel = new Map(zones.map((z) => [z.label, z.id]));
  const tiers = await db.select().from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, dhl.id));
  const tierByUpper = new Map(tiers.map((t) => [Number(t.upperKg), t.id]));

  const cells: Array<{ zoneId: string; tierId: string; cost: number; label: string }> = [];
  for (const kg of PAK_TIERS) {
    const row = doc[kg.toFixed(1)] ?? doc[String(kg)];
    const tierId = tierByUpper.get(kg);
    if (!row || !tierId) throw new Error(`Thiếu Documents/tier ${kg}kg.`);
    for (let zi = 0; zi < 10; zi++) {
      const zoneId = zoneByLabel.get(`Zone ${zi + 1}`);
      if (!zoneId) throw new Error(`Thiếu zone "Zone ${zi + 1}".`);
      cells.push({ zoneId, tierId, cost: row[zi], label: `Zone ${zi + 1} @${kg}kg` });
    }
  }
  console.log(`Sẽ upsert ${cells.length} pak cells | Zone1@0.5=${cells[0].cost.toLocaleString()} Zone9@0.5=${cells.find((c) => c.label === 'Zone 9 @0.5kg')?.cost.toLocaleString()}`);

  const pdfKey = `rate-cards/${dhl.id}/${randomUUID()}.pdf`;
  if (!apply) { console.log(`(dry-run) sẽ lưu PDF → ${pdfKey}; thêm --apply để ghi.`); process.exit(0); }

  await putObject(pdfKey, new Uint8Array(fileBuf), 'application/pdf');
  await db.transaction(async (tx) => {
    await tx.update(schema.carrierRateCards).set({ sourcePdfKey: pdfKey, sourcePdfFilename: filename, sourcePdfUploadedAt: new Date() }).where(eq(schema.carrierRateCards.id, card.id));
    for (const c of cells) {
      await tx.insert(schema.carrierRateCells).values({ rateCardId: card.id, carrierZoneId: c.zoneId, carrierWeightTierId: c.tierId, packageType: 'pak', costAmount: c.cost.toFixed(2) })
        .onConflictDoUpdate({ target: [schema.carrierRateCells.rateCardId, schema.carrierRateCells.carrierZoneId, schema.carrierRateCells.carrierWeightTierId, schema.carrierRateCells.packageType], set: { costAmount: c.cost.toFixed(2), updatedAt: sql`now()` } });
    }
  });
  console.log('✅ Đã lưu PDF vào R2 + gắn card + nạp pak.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
