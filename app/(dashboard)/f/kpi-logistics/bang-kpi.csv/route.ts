/** Xuất bảng KPI một kỳ ra CSV để gửi kế toán / nhân sự. Chỉ admin. */
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { csvBody, type CsvValue } from '@/lib/csv';
import { docNhapKpi } from '@/features/kpi-logistics/actions';
import { docSoLieuKpi } from '@/features/kpi-logistics/queries';
import { tinhBangLuong } from '@/features/kpi-logistics/quy-che';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Unauthorized', { status: 401 });
  if ((await getRole(session.user.id)) !== 'admin') return new Response('Forbidden', { status: 403 });

  const ky = new URL(req.url).searchParams.get('ky') ?? '';
  if (!/^\d{4}-\d{2}$/.test(ky)) return new Response('Thiếu tham số ky=YYYY-MM', { status: 400 });
  const [y, m] = ky.split('-').map(Number);
  const tu = `${ky}-01`;
  const den = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const [auto, nhap] = await Promise.all([docSoLieuKpi(tu, den), docNhapKpi(ky)]);
  const sla = (nhap?.nguonSla === 'quy_che' ? auto.slaQuyChe : auto.slaTong);
  const gateDat = nhap?.gateOverride ?? auto.gateDat;
  const thuHoi = nhap?.thuHoiKeToanVnd != null ? Number(nhap.thuHoiKeToanVnd) : auto.thuHoiVnd;
  const bang = tinhBangLuong({
    soDonAmCuocLoi: nhap?.soDonAmCuocLoi ?? 0,
    tyLeSla: sla.tyLe,
    tyLeLoiChungTu: auto.tyLeLoiChungTu,
    tyLeSizeThung: nhap?.tyLeSizeThung == null ? null : Number(nhap.tyLeSizeThung),
    soDonShipHo: auto.soDonShipHo,
    gateDat,
    roRiGiam: nhap?.roRiGiam ?? false,
    khacPhucGoc: nhap?.khacPhucGoc ?? false,
    thuHoiVnd: thuHoi,
    tyLeThuHoi: auto.thuocDienKhieuNaiVnd > 0 ? thuHoi / auto.thuocDienKhieuNaiVnd : null,
    clawbackVnd: nhap?.clawbackVnd ? Number(nhap.clawbackVnd) : 0,
  });

  const rows: CsvValue[][] = [
    ...bang.dong.map((d) => [d.ten, d.soLieu, d.tien] as CsvValue[]),
    ['TỔNG THU NHẬP THỰC NHẬN (gross)', '', bang.tong],
    ['', '', ''],
    ['— Số liệu hệ thống —', '', ''],
    ['Đơn âm cước hệ thống flag', `${auto.soDonAmCuoc} đơn`, auto.amCuocVnd],
    ['SLA theo SOP nội bộ', `${auto.slaTong.dungHan}/${auto.slaTong.n}`, auto.slaTong.tyLe],
    ['SLA theo chuẩn cố định quy chế', `${auto.slaQuyChe.dungHan}/${auto.slaQuyChe.n}`, auto.slaQuyChe.tyLe],
    ['Kiện phát sinh phí địa chỉ/chứng từ', `${auto.kienLoiChungTu}/${auto.kienCoBill}`, auto.tyLeLoiChungTu],
    ['Đơn ship hộ', `${auto.soDonShipHo} đơn`, ''],
    ['Tồn đọng chưa phân định', `${auto.kienTonDong} kiện`, ''],
    ['Thu hồi công nợ', `thuộc diện ${auto.thuocDienKhieuNaiVnd}`, thuHoi],
    ['Ghi chú kỳ', nhap?.ghiChu ?? '', ''],
  ];

  const body = '﻿' + csvBody(['Khoản mục', 'Số liệu trong kỳ', 'Giá trị'], rows);
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kpi-logistics-${ky}.csv"`,
    },
  });
}
