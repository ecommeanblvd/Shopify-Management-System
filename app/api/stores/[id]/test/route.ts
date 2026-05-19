import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, id)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  try {
    const token = await getStoreToken(store.id);
    const res = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: 'query { shop { name } }',
    });
    const ok = !res.errors;
    await db.update(schema.stores).set({ status: ok ? 'active' : 'error' }).where(eq(schema.stores.id, id));
    return NextResponse.json({ ok });
  } catch (err) {
    await db.update(schema.stores).set({ status: 'error' }).where(eq(schema.stores.id, id));
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
