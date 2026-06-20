import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

/** Stream a carrier bill's original invoice file from object storage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; billId: string }> }) {
  const { id, billId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new NextResponse('Forbidden', { status: 403 });

  const [bill] = await db
    .select({ key: schema.carrierBills.fileKey })
    .from(schema.carrierBills)
    .where(and(eq(schema.carrierBills.id, billId), eq(schema.carrierBills.carrierAccountId, id)))
    .limit(1);
  if (!bill?.key) return new NextResponse('No invoice file', { status: 404 });

  const url = await getSignedDownloadUrl(bill.key, 300);
  return NextResponse.redirect(url, 307);
}
