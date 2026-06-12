/** GET /f/shipping-reconcile/carrier-errors.csv → các đơn đã duyệt lỗi carrier. */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, type CsvValue } from '@/lib/csv';
import { listCarrierErrors } from '@/features/shipments/carrier-error-report';
import { carrierErrorKindLabel } from '@/features/shipments/carrier-error-kinds';

export const dynamic = 'force-dynamic';

const HEADER = ['order', 'tracking', 'carrier', 'country', 'label_date', 'kind', 'reason', 'billed_vnd', 'delta_vnd', 'approved_by', 'approved_at'];

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new Response('Forbidden', { status: 403 });

  const rows = await listCarrierErrors();
  const out: CsvValue[][] = rows.map((r) => [
    r.orderName, r.tracking, r.carrierKey, r.shipCountry,
    r.labelDate ? r.labelDate.toISOString().slice(0, 10) : null,
    carrierErrorKindLabel(r.kind), r.note, r.billedVnd, r.deltaVnd,
    r.approvedByName, r.approvedAt.toISOString().slice(0, 19).replace('T', ' '),
  ]);

  return new Response(csvBody(HEADER, out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="carrier-errors.csv"',
      'cache-control': 'no-store',
    },
  });
}
