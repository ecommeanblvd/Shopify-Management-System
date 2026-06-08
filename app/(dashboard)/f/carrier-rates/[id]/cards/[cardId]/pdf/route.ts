import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getSignedDownloadUrl } from '@/lib/storage/r2';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { cardId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new NextResponse('Forbidden', { status: 403 });

  const [card] = await db
    .select({ key: schema.carrierRateCards.sourcePdfKey })
    .from(schema.carrierRateCards)
    .where(eq(schema.carrierRateCards.id, cardId))
    .limit(1);
  if (!card?.key) return new NextResponse('No PDF for this card', { status: 404 });

  const url = await getSignedDownloadUrl(card.key, 300);
  return NextResponse.redirect(url, 307);
}
