/**
 * Thêm cột signature + country_fixed cho fedex_rate_quotes, rồi RE-PARSE từ raw
 * đã cache (không gọi lại API) để sửa mapping: ANCILLARY_FEE = phí cố định nước
 * (US Inbound Processing), không phải ký nhận.
 *   pnpm exec dotenv -- tsx scripts/migrate-fedex-quote-signature-split.ts
 */
import { sql, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseRateReply } from '@/lib/fedex/rate';

async function main(): Promise<void> {
  await db.execute(sql`ALTER TABLE fedex_rate_quotes ADD COLUMN IF NOT EXISTS signature numeric(16,2)`);
  await db.execute(sql`ALTER TABLE fedex_rate_quotes ADD COLUMN IF NOT EXISTS country_fixed numeric(16,2)`);

  const rows = await db.select({ id: schema.fedexRateQuotes.id, service: schema.fedexRateQuotes.service, raw: schema.fedexRateQuotes.raw })
    .from(schema.fedexRateQuotes);
  console.log(`Re-parse ${rows.length} quote từ raw…`);
  let updated = 0;
  for (const r of rows) {
    const quotes = parseRateReply(r.raw);
    const q = quotes.find((x) => x.rateType === 'ACCOUNT' && x.serviceType === r.service)
      ?? quotes.find((x) => x.rateType === 'ACCOUNT');
    if (!q) continue;
    await db.update(schema.fedexRateQuotes)
      .set({ signature: q.components.signature.toString(), countryFixed: q.components.countryFixed.toString() })
      .where(eq(schema.fedexRateQuotes.id, r.id));
    updated += 1;
  }
  console.log(`✓ Cập nhật ${updated} quote (signature + country_fixed từ raw).`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
