/**
 * Verify địa chỉ đơn Shopify qua FedEx Address Validation (batch).
 *   railway run -- npx tsx scripts/verify-shopify-addresses.ts [--limit N] [--refresh]
 */
import { verifyUnverifiedAddresses } from '@/features/shopify-orders/address-verify';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? '300');
  const includeVerified = process.argv.includes('--refresh');
  const r = await verifyUnverifiedAddresses({ limit, includeVerified });
  console.log(`✓ Verify ${r.verified} đơn | KHÔNG giao được: ${r.undeliverable} | lỗi: ${r.failed}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
