import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

/** Stream a remote-list evidence file (ODA/RAL source) from object storage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new NextResponse('Forbidden', { status: 403 });

  const [ev] = await db
    .select({ key: schema.carrierRemoteEvidence.fileKey })
    .from(schema.carrierRemoteEvidence)
    .where(and(eq(schema.carrierRemoteEvidence.id, evidenceId), eq(schema.carrierRemoteEvidence.carrierAccountId, id)))
    .limit(1);
  if (!ev?.key) return new NextResponse('No evidence file', { status: 404 });

  const url = await getSignedDownloadUrl(ev.key, 300);
  return NextResponse.redirect(url, 307);
}
