/**
 * DRY-RUN: cho 1 store, so cấu hình ship Shopify ĐANG SỐNG với "effective" mà
 * hệ thống sẽ đẩy (recalc tất cả market có link carrier), rồi tính diff như khi
 * apply thật (denormalizeToMutationInput): zone sẽ TẠO / sẽ XOÁ.
 * Đồng thời báo lỗ hổng phủ: nước Shopify chưa thuộc market hệ thống / market
 * chưa link carrier. KHÔNG ghi gì — chỉ đọc.
 *
 *   railway run -- npx tsx scripts/shopify-apply-dryrun.ts <storeId>
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { SHIPPING_QUERY, normalizeShopifyDeliveryProfile, denormalizeToMutationInput, type ShippingTree } from '@/features/settings-sync/domain/shipping';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { recalcMarket, type CarrierServiceForRecalc } from '@/features/carrier-rates/push/recalc';

async function main() {
  const storeId = process.argv[2] || '679aacbb-f563-4725-9d2f-65b9fddac22f';
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);

  // 1. Shopify ĐANG SỐNG
  const token = await getStoreToken(storeId);
  const raw = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_QUERY });
  const current = normalizeShopifyDeliveryProfile(raw.data);

  // 2. EFFECTIVE = recalc mọi market có link carrier (gộp zone)
  const templates = await db.select().from(schema.marketTemplates);
  const effective: ShippingTree = { zones: {} };
  const marketOf = new Map<string, string>();
  const linkedMarkets: string[] = [];
  for (const t of templates) {
    for (const c of (t.countries as string[])) marketOf.set(c, t.handle);
    const links = await db.select({ caId: schema.marketCarrierLinks.carrierAccountId, label: schema.marketCarrierLinks.serviceLabel, key: schema.carriers.key })
      .from(schema.marketCarrierLinks)
      .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.marketCarrierLinks.carrierAccountId))
      .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
      .where(and(eq(schema.marketCarrierLinks.marketHandle, t.handle), eq(schema.marketCarrierLinks.enabled, true)));
    if (links.length === 0) continue;
    linkedMarkets.push(t.handle);
    const services: CarrierServiceForRecalc[] = [];
    for (const l of links) { const s = await loadAccountSnapshot(l.caId); if (s) services.push({ carrierAccountId: l.caId, carrierKey: l.key ?? 'c', serviceLabel: l.label, snapshot: s }); }
    const r = recalcMarket({ marketHandle: t.handle, marketName: t.name, countries: t.countries as string[], primaryCurrency: t.primaryCurrency, services });
    Object.assign(effective.zones, r.shipping.zones);
  }

  // 3. DIFF như apply thật
  const diff = denormalizeToMutationInput(current, effective);
  const idToName = Object.fromEntries(Object.entries(current.shopifyIds.zoneIdByName).map(([n, id]) => [id, n]));
  console.log('=== EFFECTIVE (hệ thống sẽ đẩy) — market có link:', linkedMarkets.join(', ') || 'KHÔNG CÓ', '===');
  console.log('zone hệ thống tạo ra:', Object.keys(effective.zones).join(' | ') || '(rỗng)');
  console.log('\n=== DIFF APPLY ===');
  console.log('🟢 zonesToCreate:', diff.zonesToCreate.map((z) => z.name).join(' | ') || '(none)');
  console.log('🔴 zonesToDelete:', diff.zonesToDelete.map((id) => idToName[id] ?? id).join(' | ') || '(none)');
  console.log(`   methodDefs: +${diff.methodDefinitionsToCreate.length} ~${diff.methodDefinitionsToUpdate.length} -${diff.methodDefinitionsToDelete.length}`);

  // 4. LỖ HỔNG PHỦ: nước Shopify → market? carrier?
  const linkedSet = new Set(linkedMarkets);
  const orphanNoMarket: string[] = [];
  const orphanNoCarrier: string[] = [];
  for (const [zname, z] of Object.entries(current.tree.zones)) {
    for (const c of z.countries) {
      const m = marketOf.get(c);
      if (!m) orphanNoMarket.push(`${c}(${zname})`);
      else if (!linkedSet.has(m)) orphanNoCarrier.push(`${c}→${m}`);
    }
  }
  console.log('\n=== LỖ HỔNG PHỦ NƯỚC ===');
  console.log(`Nước KHÔNG thuộc market hệ thống nào (${orphanNoMarket.length}):`, orphanNoMarket.slice(0, 60).join(', ') + (orphanNoMarket.length > 60 ? ' …' : ''));
  console.log(`Nước có market nhưng market CHƯA link carrier (${orphanNoCarrier.length}):`, [...new Set(orphanNoCarrier.map((x) => x.split('→')[1]))].join(', '));
  console.log(`\n→ Nếu apply NGAY: xoá ${diff.zonesToDelete.length} zone, tạo ${diff.zonesToCreate.length} zone. ${orphanNoMarket.length} nước sẽ MẤT khỏi Shopify (không zone nào nhận).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
