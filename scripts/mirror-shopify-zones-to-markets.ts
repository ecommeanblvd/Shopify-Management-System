/**
 * Dựng market hệ thống MIRROR đúng các zone ship đang set up trên Shopify (lấy
 * danh sách nước trực tiếp từ Shopify live của store nguồn) + link FedEx-only.
 * Mục tiêu: hệ thống phủ ĐỦ mọi nước Shopify đang phục vụ → apply thành swap
 * sạch, không nước nào mất.
 *
 * - Zone có rate thật → tạo/cập nhật 1 market (countries = đúng zone Shopify) +
 *   link FedEx (gỡ link carrier khác để FedEx-only, tránh chồng nước).
 * - Zone toàn rate 0 (VN nội địa, Hong Kong) → BỎ QUA (free zone, xử lý riêng).
 *
 * Áp TOÀN CỤC (market + link dùng chung 4 store).
 *   railway run -- npx tsx scripts/mirror-shopify-zones-to-markets.ts [storeId] [--apply]
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { SHIPPING_QUERY, normalizeShopifyDeliveryProfile } from '@/features/settings-sync/domain/shipping';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const FEDEX_LABEL = 'FedEx IP';

const slug = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function main() {
  const storeId = process.argv[2]?.startsWith('--') ? '679aacbb-f563-4725-9d2f-65b9fddac22f' : (process.argv[2] || '679aacbb-f563-4725-9d2f-65b9fddac22f');
  const apply = process.argv.includes('--apply');
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);

  const token = await getStoreToken(storeId);
  const raw = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_QUERY });
  const norm = normalizeShopifyDeliveryProfile(raw.data);

  const plan: Array<{ handle: string; name: string; countries: string[] }> = [];
  const freeZones: string[] = [];
  for (const [zname, z] of Object.entries(norm.tree.zones)) {
    const hasRate = Object.values(z.rates).some((r) => r.price > 0);
    if (!hasRate) { freeZones.push(`${zname} [${z.countries.join(',')}]`); continue; }
    plan.push({ handle: slug(zname), name: zname, countries: z.countries });
  }

  console.log('=== MARKET MIRROR (FedEx-only) — dự kiến ===');
  for (const p of plan) console.log(`  ${p.handle.padEnd(34)} "${p.name}" — ${p.countries.length} nước`);
  console.log('\n=== ZONE MIỄN PHÍ (giữ thủ công, KHÔNG tạo market carrier) ===');
  for (const f of freeZones) console.log('  ' + f);

  if (!apply) { console.log('\n[DRY-RUN] thêm --apply để tạo market + link FedEx. (Gỡ MỌI link carrier cũ, chỉ giữ FedEx cho các market này.)'); process.exit(0); }

  // APPLY: upsert market_templates + reset carrier links → FedEx-only cho 7 market.
  // B1: gỡ toàn bộ link carrier cũ (chỉ us + middle-east hiện có) để tránh chồng nước.
  await db.delete(schema.marketCarrierLinks);
  console.log('\n✓ Đã gỡ toàn bộ market_carrier_links cũ.');

  for (const p of plan) {
    const existing = await db.select().from(schema.marketTemplates).where(eq(schema.marketTemplates.handle, p.handle)).limit(1);
    if (existing.length === 0) {
      await db.insert(schema.marketTemplates).values({
        handle: p.handle, name: p.name, type: 'regional', countries: p.countries,
        primaryCurrency: 'USD', primaryLanguage: 'en',
      });
    } else {
      await db.update(schema.marketTemplates).set({ name: p.name, countries: p.countries, updatedAt: new Date() })
        .where(eq(schema.marketTemplates.handle, p.handle));
    }
    await db.insert(schema.marketCarrierLinks).values({
      marketHandle: p.handle, carrierAccountId: FEDEX, serviceLabel: FEDEX_LABEL, position: 0, enabled: true,
    });
    console.log(`  ✓ ${p.handle}: market + link FedEx (${p.countries.length} nước)`);
  }
  console.log('\n✓ Xong. Chạy lại shopify-apply-dryrun để xác nhận swap sạch.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
