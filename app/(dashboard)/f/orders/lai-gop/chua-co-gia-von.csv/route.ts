/**
 * GET /f/orders/lai-gop/chua-co-gia-von.csv?period=YYYY-MM&store=
 *   → text/csv: line đơn trong tháng chưa có dòng order_line_cogs (kind='cogs'), để nhập bù.
 */
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { csvBody, type CsvValue } from '@/lib/csv';
import { lineChuaCoCogs } from '@/features/cogs/queries';

export const dynamic = 'force-dynamic';

const HEADER = ['Cửa hàng', 'Brand (vendor)', 'Mã đơn', 'SKU', 'Số lượng', 'Doanh thu', 'Tiền tệ'];

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cogs')) return new Response('Forbidden', { status: 403 });

  const url = new URL(req.url);
  const period = url.searchParams.get('period');
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return new Response('Thiếu hoặc sai tham số period (YYYY-MM)', { status: 400 });
  }

  const storeParam = url.searchParams.get('store');
  let storeIds: string[] | undefined;
  if (storeParam) {
    const storesAll = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));
    if (!storesAll.some((s) => s.id === storeParam)) {
      return new Response('Sai tham số store', { status: 400 });
    }
    storeIds = [storeParam];
  }
  const brandParam = url.searchParams.get('brand') ?? undefined;

  const rows = await lineChuaCoCogs(period, storeIds, brandParam);
  const out: CsvValue[][] = rows.map((r) => [r.store, r.brand, r.maDon, r.sku, r.sl, r.doanhThu, r.currency]);

  // BOM UTF-8 để Excel nhận đúng chữ có dấu.
  const body = '﻿' + csvBody(HEADER, out);
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="chua-co-gia-von-${period}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
