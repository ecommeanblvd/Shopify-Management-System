/**
 * Seed/re-bake phụ phí Aramex (công văn HNC 2601/CV/QTHN, hiệu lực 01/02/2024).
 *
 * Data thuần + logic bake ở features/carrier-rates/import/aramex-surcharges.ts
 * (có test). Script này chỉ lo I/O: đọc account Aramex, bake theo --fuel, upsert.
 *
 * BỐI CẢNH: base Aramex all-in fuel FIX 30% + VAT 8%. 9 phụ phí đi theo fuel
 * BIẾN ĐỘNG Aramex (aramex.com/us fuel-surcharge, 2 lần/tháng) + VAT 8% fix →
 * bake all-in theo fuel hiện hành. Trang fuel chặn WAF (403 curl+headless) nên
 * KHÔNG auto-fetch được; fuel truyền tay. Khi Aramex đổi fuel, chạy lại:
 *   npx tsx scripts/import-aramex-surcharges.ts --apply --fuel=34
 *
 * value lưu ĐÃ all-in nên fuelable=false, vatable=false (khỏi cộng lần 2 nếu
 * account có dòng fuel/vat). Idempotent: xoá placeholder [Aramex catalog] +
 * row seed trước rồi ghi lại 9 dòng. Mặc định DRY-RUN; --apply mới ghi.
 */
import 'dotenv/config';
import { and, eq, like, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  ARAMEX_DEFAULT_FUEL_PERCENT,
  ARAMEX_SURCHARGE_NOTE_PREFIX,
  ARAMEX_VAT_PERCENT,
  bakeAramexSurcharges,
} from '@/features/carrier-rates/import/aramex-surcharges';

function parseArgs() {
  const a = process.argv.slice(2);
  const apply = a.includes('--apply');
  const fuelArg = a.find((x) => x.startsWith('--fuel='));
  const fuel = fuelArg ? Number(fuelArg.split('=')[1]) : ARAMEX_DEFAULT_FUEL_PERCENT;
  if (!Number.isFinite(fuel) || fuel < 0 || fuel > 200) {
    throw new Error(`--fuel không hợp lệ: ${fuelArg}`);
  }
  return { apply, fuel };
}

async function main(): Promise<void> {
  const { apply, fuel } = parseArgs();
  console.log(`Mode: ${apply ? 'APPLY (ghi)' : 'DRY-RUN'} · fuel=${fuel}% · VAT=${ARAMEX_VAT_PERCENT}%\n`);

  const [acc] = await db.select({ id: schema.carrierAccounts.id, cc: schema.carrierAccounts.costCurrency })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(like(schema.carrierAccounts.name, '%Aramex%'))
    .limit(1);
  if (!acc) { console.log('ERROR: không tìm thấy account Aramex.'); process.exitCode = 1; return; }
  if (acc.cc !== 'USD') console.log(`WARN: account cost currency = ${acc.cc}, phụ phí công văn là USD.`);

  const baked = bakeAramexSurcharges(fuel);
  console.log('9 phụ phí (all-in):');
  for (const r of baked) {
    console.log(`  ${r.kind.padEnd(18)} ${String(r.value).padStart(8)} USD${r.valuePerKg ? ` (+${r.valuePerKg}/kg)` : ''} [${r.applyMode}]${r.countryCodes ? ' cc=' + r.countryCodes.join(',') : ''}`);
  }

  if (!apply) { console.log('\nDRY-RUN: không ghi. Chạy lại với --apply.'); return; }

  const rows = baked.map((r) => ({
    carrierAccountId: acc.id,
    kind: r.kind,
    value: r.value.toFixed(2),
    valuePerKg: r.valuePerKg !== null ? r.valuePerKg.toFixed(2) : null,
    countryCodes: r.countryCodes,
    active: true,
    applyMode: r.applyMode,
    fuelable: false, // value ĐÃ all-in → không cộng fuel/vat lần 2
    vatable: false,
    note: r.note,
  }));

  await db.transaction(async (tx) => {
    const del = await tx.delete(schema.carrierSurcharges).where(and(
      eq(schema.carrierSurcharges.carrierAccountId, acc.id),
      or(like(schema.carrierSurcharges.note, '[Aramex catalog]%'), like(schema.carrierSurcharges.note, `${ARAMEX_SURCHARGE_NOTE_PREFIX}%`)),
    )).returning({ id: schema.carrierSurcharges.id });
    await tx.insert(schema.carrierSurcharges).values(rows);
    console.log(`\n✓ Xoá ${del.length} row cũ (placeholder/seed trước), ghi ${rows.length} phụ phí all-in.`);
  });
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
