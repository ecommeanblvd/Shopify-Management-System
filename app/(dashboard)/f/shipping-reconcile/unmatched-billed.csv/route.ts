import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { csvBody, type CsvValue } from '@/lib/csv';
import { listUnmatchedBilledTracking } from '@/features/shipments/unmatched-billed';

export const dynamic = 'force-dynamic';

const HEADER = ['tracking', 'bill_number', 'carrier', 'account', 'amount_vnd', 'bill_period_start', 'ship_ho_code', 'return_of_order'];

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) return new Response('Forbidden', { status: 403 });

  const rows = await listUnmatchedBilledTracking();
  const out: CsvValue[][] = rows.map((r) => [r.tracking, r.billNumber, r.carrierKey, r.accountName, r.amountVnd, r.billPeriodStart, r.shipHoCode, r.returnOfOrderNumber]);
  return new Response(csvBody(HEADER, out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="unmatched-billed.csv"',
      'cache-control': 'no-store',
    },
  });
}
