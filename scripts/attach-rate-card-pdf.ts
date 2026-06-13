/**
 * Lưu một PDF rate-card vào R2 (bằng chứng) + gắn source_pdf_key/filename vào ĐÚNG
 * card — khớp theo NGÀY HIỆU LỰC đọc từ chính PDF, không nhập tay.
 *   • FedEx: "Effective Date: 28 October 2025"
 *   • DHL:   "Ratecard as of: 01-Jan-2025"
 * KHÔNG đụng rate cells (chỉ đính PDF). Dùng cho card đã có data nhưng thiếu PDF.
 *
 *   npx tsx scripts/attach-rate-card-pdf.ts --pdf="/path.pdf" --carrier=fedex          # DRY-RUN
 *   npx tsx scripts/attach-rate-card-pdf.ts --pdf="/path.pdf" --carrier=fedex --apply  # ghi
 */
import 'dotenv/config';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { and, eq } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { db, schema } from '@/db/client';
import { putObject } from '@/lib/storage/s3';

const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const argVal = (f: string) => { const a = process.argv.find((x) => x.startsWith(`${f}=`)); return a ? a.slice(f.length + 1) : undefined; };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Đọc ngày hiệu lực từ text PDF (hỗ trợ format FedEx + DHL) → 'YYYY-MM-DD'. */
function effectiveDateFromPdf(text: string): { dateIso: string; raw: string } {
  const fx = text.match(/Effective Date:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  if (fx) return { dateIso: iso(Number(fx[3]), MONTHS[fx[2].toLowerCase()], Number(fx[1])), raw: fx[0] };
  const dhl = text.match(/Ratecard as of:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/i);
  if (dhl) return { dateIso: iso(Number(dhl[3]), MONTHS[dhl[2].toLowerCase()], Number(dhl[1])), raw: dhl[0] };
  throw new Error('Không đọc được ngày hiệu lực ("Effective Date" / "Ratecard as of") trong PDF.');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pdfPath = argVal('--pdf');
  const carrierKey = argVal('--carrier');
  if (!pdfPath || !carrierKey) throw new Error('Cần --pdf="..." và --carrier=fedex|dhl');
  const filename = basename(pdfPath);
  const fileBuf = readFileSync(pdfPath);
  const text = (await new PDFParse({ data: new Uint8Array(fileBuf) }).getText()).text;

  const { dateIso, raw } = effectiveDateFromPdf(text);
  console.log(`PDF: ${filename} | đọc được: "${raw.trim()}" → hiệu lực ${dateIso}`);

  const [carrier] = await db.select().from(schema.carriers).where(eq(schema.carriers.key, carrierKey));
  if (!carrier) throw new Error(`Không có carrier "${carrierKey}".`);
  const [acc] = await db.select().from(schema.carrierAccounts).where(eq(schema.carrierAccounts.carrierId, carrier.id)).limit(1);
  const cards = await db.select().from(schema.carrierRateCards)
    .where(and(eq(schema.carrierRateCards.carrierAccountId, acc.id), eq(schema.carrierRateCards.effectiveFrom, dateIso)));
  if (cards.length !== 1) throw new Error(`Cần đúng 1 card ${carrierKey} eff_from=${dateIso}, tìm thấy ${cards.length}.`);
  const card = cards[0];
  console.log(`Khớp card: "${card.label}" (eff ${card.effectiveFrom} → ${card.effectiveTo ?? '∞'})${card.sourcePdfKey ? ' — đã có PDF, sẽ ghi đè key' : ''}`);

  const pdfKey = `rate-cards/${acc.id}/${randomUUID()}.pdf`;
  if (!apply) { console.log(`(dry-run) sẽ lưu PDF → ${pdfKey} + gắn card. Thêm --apply để ghi.`); process.exit(0); }

  await putObject(pdfKey, new Uint8Array(fileBuf), 'application/pdf');
  await db.update(schema.carrierRateCards)
    .set({ sourcePdfKey: pdfKey, sourcePdfFilename: filename, sourcePdfUploadedAt: new Date() })
    .where(eq(schema.carrierRateCards.id, card.id));
  console.log(`✅ Đã lưu PDF vào R2 + gắn card "${card.label}".`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
