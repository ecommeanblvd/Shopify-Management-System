/**
 * Probe Rate API (read-only): quote thử 1 lô hàng và in báo giá + bóc phụ phí.
 * Dùng để smoke-test OAuth + xem shape phụ phí thật của FedEx.
 *
 *   pnpm exec dotenv -- tsx scripts/probe-fedex-rate.ts \
 *     --from VN --to HK --kg 1.5 [--dest-postal 999077] [--from-postal 700000] \
 *     [--lwh 30x20x10] [--residential] [--service INTERNATIONAL_PRIORITY] [--raw]
 *
 * Cần env: FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER (Railway).
 */
import { quoteRate, type RateQuoteInput } from '@/lib/fedex/rate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function vnd(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(n));
}

async function main(): Promise<void> {
  const lwh = arg('lwh');
  const input: RateQuoteInput = {
    shipperCountryCode: (arg('from') ?? 'VN').toUpperCase(),
    shipperPostalCode: arg('from-postal') ?? '700000',
    recipientCountryCode: (arg('to') ?? 'HK').toUpperCase(),
    recipientPostalCode: arg('dest-postal'),
    recipientResidential: flag('residential'),
    weightKg: Number(arg('kg') ?? '1'),
    serviceType: arg('service'),
    dimsCm: lwh
      ? (() => { const [l, w, h] = lwh.split('x').map(Number); return { length: l, width: w, height: h }; })()
      : undefined,
  };

  console.log('→ Quote:', JSON.stringify(input));
  const { raw, quotes } = await quoteRate(input);

  if (flag('raw')) {
    console.log('\n=== RAW response ===');
    console.log(JSON.stringify(raw, null, 2));
  }

  console.log(`\n=== ${quotes.length} báo giá ===`);
  for (const q of quotes) {
    console.log(`\n${q.serviceType}${q.serviceName ? ` (${q.serviceName})` : ''}  [${q.rateType}]  ${q.transitDays ?? ''}`);
    console.log(`  Tổng: ${vnd(q.totalNetCharge)} ${q.currency}` +
      (q.baseCharge != null ? `  | base ${vnd(q.baseCharge)}` : '') +
      (q.totalSurcharges != null ? `  | phụ phí ${vnd(q.totalSurcharges)}` : ''));
    for (const s of q.surcharges) {
      console.log(`    - ${s.type}${s.description ? ` (${s.description})` : ''}: ${vnd(s.amount)}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
