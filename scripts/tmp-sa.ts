import { db } from '@/db/client';
import { sql, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { SHIPPING_QUERY } from '@/features/settings-viewer/queries';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { computeCheckoutRates, locCarrierCheckout, type CheckoutRateCarrier } from '@/features/carrier-rates/checkout-rates';

async function main() {
  const s = (await db.execute<any>(sql`SELECT id, shop_domain, api_version FROM stores WHERE name='tinhatelier';`)).rows[0];
  const r = await graphqlCall({ shopDomain: s.shop_domain, apiVersion: s.api_version,
    token: await getStoreToken(s.id), query: SHIPPING_QUERY });

  console.log('— SA nằm ở vùng nào, còn rate gì đang bật —');
  let thay = false;
  for (const p of (r.data as any).deliveryProfiles.edges)
    for (const g of p.node.profileLocationGroups)
      for (const z of g.locationGroupZones.edges) {
        const nuoc = (z.node.zone.countries ?? []).map((c:any)=>c?.code?.countryCode);
        if (!nuoc.includes('SA')) continue;
        thay = true;
        const bat = z.node.methodDefinitions.edges.map((m:any)=>m.node).filter((n:any)=>n.active !== false);
        const tat = z.node.methodDefinitions.edges.length - bat.length;
        console.log(`  ${p.node.name} › ${z.node.zone.name}: ${bat.length} rate BẬT, ${tat} đã tắt`);
        for (const n of bat) console.log(`     ● ${n.name} (${n.rateProvider?.__typename})`);
      }
  if (!thay) console.log('  !! SA KHÔNG thuộc vùng nào');

  console.log('\n— Engine trả gì cho SA —');
  const accts = locCarrierCheckout(await db.select({
    id: schema.carrierAccounts.id, name: schema.carrierAccounts.name,
    key: schema.carriers.key, enabled: schema.carrierAccounts.enabled,
  }).from(schema.carrierAccounts).innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId)));
  const cs: CheckoutRateCarrier[] = [];
  for (const a of accts) {
    const snap = await loadAccountSnapshot(a.id, new Date(), { remoteCountry: 'SA', remotePostcodes: ['23531'] });
    if (snap) cs.push({ carrierKey: a.key ?? a.id, snapshot: snap });
    console.log(`  account ${a.key}: snapshot ${snap ? `OK · displayCurrency=${(snap as any).displayCurrency}` : 'KHÔNG nạp được'}`);
  }
  for (const kg of [0.5, 1, 2]) {
    const rates = computeCheckoutRates({ country: 'SA', postalCode: '23531', city: 'Jeddah', weightKg: kg, carriers: cs });
    console.log(`  ${kg}kg → ${rates.length} rate: ${rates.map((x)=>`${x.service_name} ${Number(x.total_price)/100} ${x.currency}`).join(' | ') || '(RỖNG)'}`);
  }
  process.exit(0);
}
main();
