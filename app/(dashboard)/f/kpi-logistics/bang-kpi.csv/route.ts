/** Xuất bảng KPI một kỳ ra CSV để gửi kế toán / nhân sự. Chỉ admin. */
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { csvBody, type CsvValue } from '@/lib/csv';
import { docNhapKpi } from '@/features/kpi-logistics/actions';
import { docSoLieuKpi } from '@/features/kpi-logistics/queries';
import { bangDiemKpi } from '@/features/kpi-logistics/quy-che';

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
  const diem = bangDiemKpi({
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

  const dong = (nhom: string, d: { ma: string; ten: string; trongSo: number | null; soLieu: string; nguong: string; mucDat: number | null }): CsvValue[] =>
    [nhom, `${d.ma} · ${d.ten}`, d.trongSo, d.soLieu, d.nguong, d.mucDat];

  const rows: CsvValue[][] = [
    ...diem.p1.map((d) => dong('Pillar 1', d)),
    ['Pillar 1', 'ĐIỂM PILLAR 1 (Σ trọng số × mức đạt)', '', '', '', diem.diemP1],
    ...diem.p2.map((d) => dong('Pillar 2', d)),
    ...diem.p3.map((d) => dong('Pillar 3', d)),
    ['', '', '', '', '', ''],
    ['Số liệu hệ thống', 'Đơn âm cước hệ thống flag', '', `${auto.soDonAmCuoc} đơn · chênh ${auto.amCuocVnd}đ`, '', ''],
    ['Số liệu hệ thống', 'SLA theo SOP nội bộ', '', `${auto.slaTong.dungHan}/${auto.slaTong.n}`, '', auto.slaTong.tyLe],
    ['Số liệu hệ thống', 'SLA theo chuẩn cố định quy chế', '', `${auto.slaQuyChe.dungHan}/${auto.slaQuyChe.n}`, '', auto.slaQuyChe.tyLe],
    ['Số liệu hệ thống', 'Kiện phát sinh phí địa chỉ/chứng từ', '', `${auto.kienLoiChungTu}/${auto.kienCoBill}`, '', auto.tyLeLoiChungTu],
    ['Số liệu hệ thống', 'Tồn đọng chưa phân định', '', `${auto.kienTonDong} kiện`, '', ''],
    ['Số liệu hệ thống', 'Thu hồi công nợ', '', `${thuHoi}đ / thuộc diện ${auto.thuocDienKhieuNaiVnd}đ`, '', auto.tyLeThuHoi],
    ['Ghi chú kỳ', nhap?.ghiChu ?? '', '', '', '', ''],
  ];

  const body = '﻿' + csvBody(['Nhóm', 'Tiêu chí', 'Trọng số', 'Kết quả trong kỳ', 'Ngưỡng quy chế', 'Mức đạt'], rows);
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kpi-logistics-${ky}.csv"`,
    },
  });
}
