/* eslint-disable no-console */
/**
 * Nối sản phẩm MMP với sản phẩm Shopify theo MÃ BIẾN THỂ.
 *
 * Thay script cũ `backfill-mmp-shopify-ids.ts` vốn tra Shopify bằng mã cấp SẢN
 * PHẨM — mà ô đó ở nhiều brand lại là slug, không phải SKU (xem noi-shopify.ts).
 *
 * MẶC ĐỊNH CHẠY KHÔ, không ghi gì. Thêm --apply mới ghi.
 *   npx tsx scripts/link-mmp-shopify.ts --store meanblvd.myshopify.com
 *   npx tsx scripts/link-mmp-shopify.ts --store meanblvd.myshopify.com --brand montsand --apply
 */
import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';
import { khopBienThe, sanPhamCha, type BienTheShopify } from '@/features/mmp/noi-shopify';

const Q = `query($q: String!, $after: String) {
  productVariants(first: 250, query: $q, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id sku product { id } }
  }
}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const store = get('store');
  const brand = get('brand');
  const apply = args.includes('--apply');
  if (!store) throw new Error('thiếu --store');

  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, store)).limit(1);
  if (!s) throw new Error(`store ${store} chưa kết nối`);
  const token = await getStoreToken(s.id);
  console.log(`store=${store} brand=${brand ?? '(mọi brand)'} ${apply ? '⚠ GHI THẬT' : '🔎 CHẠY KHÔ'}`);

  // Nạp TOÀN BỘ biến thể của store một lần — rẻ hơn nhiều so với mỗi sản phẩm
  // một lượt gọi, và cho phép khớp đuôi (cần nhìn thấy cả kho mã).
  const shopify: BienTheShopify[] = [];
  let after: string | null = null;
  do {
    const r = await graphqlCall({ shopDomain: s.shopDomain, apiVersion: s.apiVersion, token, query: Q, variables: { q: 'sku:*', after } });
    const c = (r.data as { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ id: string; sku: string | null; product: { id: string } }> } }).productVariants;
    for (const n of c.nodes) if (n.sku) shopify.push({ id: n.id, sku: n.sku, productId: n.product.id });
    after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
    process.stdout.write(`\r  nạp ${shopify.length} biến thể Shopify...`);
  } while (after);
  console.log(`\n  xong: ${shopify.length} biến thể trên Shopify`);

  const products = await db.select({ id: schema.mmpProducts.id, sku: schema.mmpProducts.sku, brand: schema.mmpProducts.brandSlug })
    .from(schema.mmpProducts)
    .where(brand
      ? and(isNull(schema.mmpProducts.shopifyProductId), eq(schema.mmpProducts.brandSlug, brand))
      : isNull(schema.mmpProducts.shopifyProductId));
  console.log(`  ${products.length} sản phẩm MMP chưa nối`);

  const dem = { noiDuoc: 0, bienThe: 0, chinhXac: 0, boTienTo: 0, nhapNhang: 0, khongKhop: 0, chaKhongRoRang: 0 };
  const theoBrand = new Map<string, number>();

  for (const p of products) {
    const bt = await db.select({ id: schema.mmpProductVariants.id, sku: schema.mmpProductVariants.sku })
      .from(schema.mmpProductVariants).where(eq(schema.mmpProductVariants.productId, p.id));
    if (bt.length === 0) continue;
    const kq = khopBienThe(bt.map((v) => ({ id: v.id, sku: v.sku })), shopify);
    for (const k of kq) {
      if (k.kieu === 'chinh_xac') dem.chinhXac++;
      else if (k.kieu === 'bo_tien_to') dem.boTienTo++;
      else if (k.kieu === 'nhap_nhang') dem.nhapNhang++;
      else dem.khongKhop++;
    }
    const cha = sanPhamCha(kq);
    if (!cha) { if (kq.some((k) => k.shopifyVariantId)) dem.chaKhongRoRang++; continue; }
    dem.noiDuoc++;
    theoBrand.set(p.brand, (theoBrand.get(p.brand) ?? 0) + 1);
    const khop = kq.filter((k) => k.shopifyVariantId);
    dem.bienThe += khop.length;
    if (apply) {
      await db.update(schema.mmpProducts).set({ shopifyProductId: cha }).where(eq(schema.mmpProducts.id, p.id));
      for (const k of khop) {
        await db.update(schema.mmpProductVariants).set({ shopifyVariantId: k.shopifyVariantId })
          .where(eq(schema.mmpProductVariants.id, k.smsId));
      }
    }
  }

  console.log(`\n${apply ? 'ĐÃ NỐI' : 'SẼ NỐI'}: ${dem.noiDuoc} sản phẩm · ${dem.bienThe} biến thể`);
  console.log(`   biến thể khớp chính xác ${dem.chinhXac} · khớp sau khi bỏ tiền tố ${dem.boTienTo}`);
  console.log(`   nhập nhằng ${dem.nhapNhang} · không khớp ${dem.khongKhop} · cha không rõ ràng ${dem.chaKhongRoRang} sản phẩm`);
  console.log('   theo brand: ' + [...theoBrand.entries()].map(([b, n]) => `${b}=${n}`).join(' · '));
  if (!apply) console.log('\n🔎 CHẠY KHÔ — chưa ghi gì. Thêm --apply để ghi.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('LỖI:', e instanceof Error ? e.stack : e); process.exit(1); });
