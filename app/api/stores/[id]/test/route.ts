import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { hasPermission } from '@/lib/auth/rbac';
import type { Role } from '@/lib/auth/rbac';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

const REQUIRED_SCOPES = ['read_shipping', 'read_checkout_branding', 'write_shipping', 'write_shop_settings'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  if (!roleRow || !hasPermission(roleRow.role as Role, 'manage_stores')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, id)).limit(1);
  if (!store) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const missingScopes = REQUIRED_SCOPES.filter((s) => !store.scopes.includes(s));

  try {
    const token = await getStoreToken(store.id);
    const res = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: 'query { shop { name } }',
    });
    const reachable = !res.errors;
    const newStatus = reachable && missingScopes.length === 0 ? 'active' : 'error';
    await db.update(schema.stores).set({ status: newStatus }).where(eq(schema.stores.id, id));
    return NextResponse.json({ ok: newStatus === 'active', missingScopes });
  } catch {
    await db.update(schema.stores).set({ status: 'error' }).where(eq(schema.stores.id, id));
    return NextResponse.json({ ok: false, error: 'connection test failed', missingScopes }, { status: 502 });
  }
}
