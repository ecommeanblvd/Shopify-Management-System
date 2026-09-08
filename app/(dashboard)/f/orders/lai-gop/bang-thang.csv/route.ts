/**
 * GET /f/orders/lai-gop/bang-thang.csv?tu=&den=&store=&brand=
 *   → text/csv: bảng lãi gộp theo tháng (VND), cùng tham số lọc với trang.
 */
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { thangKinhDoanh } from '@/lib/timezone';
import { csvBody, type CsvValue } from '@/lib/csv';
import { doanhThuTheoThang, cogsTheoThang, offlineTheoThang, tiGiaThang } from '@/features/cogs/queries';
import { tinhBaoCao } from '@/features/cogs/bao-cao-logic';

export const dynamic = 'force-dynamic';

function thangHopLe(s: string | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function thangTruoc(period: string, soThang: number): string {
  const [nam, thang] = period.split('-').map(Number);
  const tongThang = nam * 12 + (thang - 1) - soThang;
  const namMoi = Math.floor(tongThang / 12);
  const thangMoi = (tongThang % 12) + 1;
  return `${namMoi}-${String(thangMoi).padStart(2, '0')}`;
}

function danhSachThang(tuVao: string, denVao: string): string[] {
  const tu = tuVao <= denVao ? tuVao : denVao;
  const den = tuVao <= denVao ? denVao : tuVao;
  const out: string[] = [];
  let [nam, thang] = tu.split('-').map(Number);
  const [namCuoi, thangCuoi] = den.split('-').map(Number);
  while ((nam < namCuoi || (nam === namCuoi && thang <= thangCuoi)) && out.length < 36) {
    out.push(`${nam}-${String(thang).padStart(2, '0')}`);
    thang += 1;
    if (thang > 12) { thang = 1; nam += 1; }
  }
  return out;
}

const HEADER = [
  'Tháng', 'Doanh thu thuần', 'Phí ship', 'Giá vốn', 'Lãi gộp', 'Chi brand ngoài Shopify',
  'Độ phủ line', 'Độ phủ doanh thu', 'Thuộc đơn tháng trước', 'Tỉ giá tạm', 'Thiếu tỉ giá',
];

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Unauthorized', { status: 401 });
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cogs')) return new Response('Forbidden', { status: 403 });

  const url = new URL(req.url);
  const thangHienTai = thangKinhDoanh(new Date()) ?? '1970-01';
  const denParam = url.searchParams.get('den');
  const tuParam = url.searchParams.get('tu');
  const den = thangHopLe(denParam) ? denParam : thangHienTai;
  const tu = thangHopLe(tuParam) ? tuParam : thangTruoc(den, 5);
  const thang = danhSachThang(tu, den);

  const storesAll = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));
  const storeParam = url.searchParams.get('store');
  const storeIds = storeParam && storesAll.some((s) => s.id === storeParam) ? [storeParam] : storesAll.map((s) => s.id);
  const brandParam = url.searchParams.get('brand') ?? undefined;

  const [doanhThu, cogs, offline, rates] = await Promise.all([
    doanhThuTheoThang(thang, storeIds, brandParam),
    cogsTheoThang(thang, storeIds, brandParam),
    offlineTheoThang(thang, brandParam),
    tiGiaThang(),
  ]);
  const rows = tinhBaoCao({ thang, doanhThu, cogs, offline, rates });

  const out: CsvValue[][] = rows.map((r) => [
    r.period,
    r.thieuTiGia ? null : r.doanhThuThuan,
    r.thieuTiGia ? null : r.phiShip,
    r.cogs,
    r.thieuTiGia ? null : r.laiGop,
    r.offline,
    r.phuLine,
    r.phuDoanhThu,
    r.thuocThangTruoc,
    r.tiGiaTam ? 'x' : '',
    r.thieuTiGia ? 'x' : '',
  ]);

  // BOM UTF-8 để Excel nhận đúng chữ có dấu.
  const body = '﻿' + csvBody(HEADER, out);
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="lai-gop-${tu}_${den}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
