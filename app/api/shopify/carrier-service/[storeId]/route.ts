import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { computeCheckoutRates, type CheckoutRateCarrier } from '@/features/carrier-rates/checkout-rates';

export const dynamic = 'force-dynamic';

/**
 * Shopify CarrierService callback (B1 — engine). Shopify POST mỗi lần khách tới
 * bước shipping, kèm địa chỉ + items. Ta quote từng carrier (DHL/FedEx) theo cân
 * + địa chỉ thật (gồm ODA/residential/fuel) rồi trả rate. Trả MẢNG rate (cả 2
 * carrier) để khách chọn. Lỗi → trả {rates:[]} (Shopify ẩn carrier service đó,
 * KHÔNG chặn checkout).
 */
interface ShopifyRateRequest {
  rate?: {
    destination?: { country?: string; postal_code?: string; province?: string; city?: string };
    items?: Array<{ grams?: number; quantity?: number }>;
    currency?: string;
  };
}

/**
 * Health-check. Shopify gửi GET tới callbackUrl để xác minh service còn sống;
 * GET trả 405 → Shopify đánh dấu hỏng → carrier bị xám không chọn được ở picker.
 * Trả 200 JSON hợp lệ là đủ.
 */
export async function GET(request: NextRequest) {
  console.log('CARRIER-CB GET', request.nextUrl.pathname, 'hdrs=', JSON.stringify(shopifyHeaders(request)));
  return NextResponse.json({ rates: [] });
}

function shopifyHeaders(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((v, k) => { if (k.startsWith('x-shopify') || k === 'user-agent' || k === 'content-type') out[k] = v; });
  return out;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  let raw = '';
  try {
    const { storeId } = await params;
    raw = await request.text();
    console.log('CARRIER-CB POST', storeId, 'hdrs=', JSON.stringify(shopifyHeaders(request)), 'body=', raw.slice(0, 2000));

    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!store || store.status !== 'active') { console.log('CARRIER-CB → no store'); return NextResponse.json({ rates: [] }); }

    const body = JSON.parse(raw || '{}') as ShopifyRateRequest;
    const dest = body.rate?.destination;
    const country = (dest?.country ?? '').trim().toUpperCase();
    if (!country) { console.log('CARRIER-CB → no country'); return NextResponse.json({ rates: [] }); }

    const grams = (body.rate?.items ?? []).reduce((s, it) => s + (Number(it.grams) || 0) * (Number(it.quantity) || 1), 0);
    const weightKg = Math.round((grams / 1000) * 1000) / 1000;

    // Carrier accounts (FedEx + DHL) → snapshot.
    const accts = await db
      .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, key: schema.carriers.key })
      .from(schema.carrierAccounts)
      .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId));
    const carriers: CheckoutRateCarrier[] = [];
    for (const a of accts) {
      const snapshot = await loadAccountSnapshot(a.id);
      if (snapshot) carriers.push({ serviceCode: a.key ?? a.id, serviceName: a.name, snapshot });
    }

    const rates = computeCheckoutRates({
      country, postalCode: dest?.postal_code, city: dest?.city, weightKg, carriers,
    });
    console.log('CARRIER-CB → country=', country, 'kg=', weightKg, 'rates=', JSON.stringify(rates));
    return NextResponse.json({ rates });
  } catch (e) {
    console.log('CARRIER-CB ERROR', String((e as Error)?.message ?? e), 'raw=', raw.slice(0, 500));
    return NextResponse.json({ rates: [] }); // không bao giờ chặn checkout
  }
}
