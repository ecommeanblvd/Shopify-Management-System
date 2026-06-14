import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

/** Stream a payment-proof file (bằng chứng thanh toán) from object storage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { paymentId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new NextResponse('Forbidden', { status: 403 });

  const [p] = await db
    .select({ key: schema.carrierBillPayments.proofFileKey })
    .from(schema.carrierBillPayments)
    .where(eq(schema.carrierBillPayments.id, paymentId))
    .limit(1);
  if (!p?.key) return new NextResponse('No proof file', { status: 404 });

  const url = await getSignedDownloadUrl(p.key, 300);
  return NextResponse.redirect(url, 307);
}
