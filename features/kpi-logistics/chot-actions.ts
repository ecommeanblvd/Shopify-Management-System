'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { docSoLieuKpi } from './queries';
import { bangDiemKpi } from './quy-che';
import { laKyHopLe, laAnhChupHopLe, chuanHoaAuto, type AnhChupKpi } from './chot-ky';

/** Kỳ YYYY-MM → [đầu kỳ, cuối kỳ] theo lịch. */
function bienKy(ky: string): [string, string] {
  const [y, m] = ky.split('-').map(Number);
  return [`${ky}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
}

export interface ChotKyDaLuu {
  ky: string;
  anhChup: AnhChupKpi;
  ghiChu: string | null;
  chotBoi: string | null;
  chotAt: string;
}

/**
 * CHỐT một kỳ: chụp lại toàn bộ số liệu ngay lúc này và lưu.
 *
 * Tính lại từ đầu ở ĐÂY chứ không nhận số từ giao diện gửi lên — trang người dùng đang mở có thể
 * đã cũ, mà đây là con số HR trả lương theo. Ảnh chụp phải là thứ hệ thống tự đọc được tại giây
 * bấm nút, không phải thứ trình duyệt nói.
 */
export async function chotKyKpi(input: { ky: string; ghiChu?: string | null }): Promise<{ ok: true }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  if ((await getRole(session.user.id)) !== 'admin') throw new Error('Chỉ quản lý được chốt kỳ KPI');
  if (!laKyHopLe(input.ky)) throw new Error('Kỳ phải dạng YYYY-MM');

  const [da] = await db.select({ ky: schema.kpiLogisticsChot.ky })
    .from(schema.kpiLogisticsChot).where(eq(schema.kpiLogisticsChot.ky, input.ky)).limit(1);
  // Chốt đè lên một kỳ đã chốt là im lặng thay con số HR đã trả lương theo. Phải mở lại trước,
  // và lượt mở lại đó là một hành động riêng, có người chịu trách nhiệm.
  if (da) throw new Error('Kỳ này đã chốt rồi — mở lại trước nếu cần chốt lại');

  const [tu, den] = bienKy(input.ky);
  const [auto, nhap] = await Promise.all([
    docSoLieuKpi(tu, den),
    db.select().from(schema.kpiLogisticsThang).where(eq(schema.kpiLogisticsThang.ky, input.ky)).limit(1).then((r) => r[0] ?? null),
  ]);
  const gateDat = nhap?.gateOverride ?? auto.gateDat;
  const diem = bangDiemKpi({
    soDonAmCuocLoi: nhap?.soDonAmCuocLoi ?? auto.soDonAmCuocLoiNoiBo,
    soDonAmCuocChuaXet: auto.soDonAmCuocChuaXet,
    tyLeSla: auto.slaTong.tyLe,
    tyLeLoiChungTu: auto.tyLeLoiChungTu,
    tyLeSizeThung: nhap?.tyLeSizeThung == null ? auto.sizeThung.tyLeDung : Number(nhap.tyLeSizeThung),
    soDonShipHo: auto.soDonShipHo,
    thietHaiChamDiemVnd: auto.suCo.thietHaiChamDiemVnd,
    gateDat,
    roRiGiam: nhap?.roRiGiam ?? false,
    khacPhucGoc: nhap?.khacPhucGoc ?? false,
    daChamP3B: nhap != null,
    thuHoiVnd: nhap?.thuHoiKeToanVnd != null ? Number(nhap.thuHoiKeToanVnd) : auto.thuHoiVnd,
    // Lấy thẳng tỉ lệ đã tính trên cùng một tập dòng; không chia tiền credit note cho mức khiếu nại.
    tyLeThuHoi: auto.tyLeThuHoi,
    clawbackVnd: nhap?.clawbackVnd ? Number(nhap.clawbackVnd) : 0,
  }, tu);

  const anhChup: AnhChupKpi = {
    ban: 1, auto,
    nhap: nhap ? (JSON.parse(JSON.stringify(nhap)) as Record<string, unknown>) : null,
    diemP1: diem.diemP1, gateDat,
  };
  await db.insert(schema.kpiLogisticsChot).values({
    ky: input.ky, soLieu: anhChup, ghiChu: input.ghiChu?.trim() || null, chotBoi: session.user.id,
  });
  revalidatePath('/f/ship-report');
  return { ok: true };
}

/** MỞ LẠI một kỳ đã chốt — xoá ảnh chụp, trang quay về tính sống. Chỉ quản lý. */
export async function moLaiKyKpi(ky: string): Promise<{ ok: true }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  if ((await getRole(session.user.id)) !== 'admin') throw new Error('Chỉ quản lý được mở lại kỳ KPI');
  if (!laKyHopLe(ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  await db.delete(schema.kpiLogisticsChot).where(eq(schema.kpiLogisticsChot.ky, ky));
  revalidatePath('/f/ship-report');
  return { ok: true };
}

/**
 * Ảnh chụp của một kỳ, hoặc null khi kỳ chưa chốt.
 *
 * Ảnh hỏng (đời cũ, hoặc ai đó sửa tay trong CSDL) trả về NULL chứ không ném: trang phải mở được
 * và rơi về tính sống, chứ mất cả bảng KPI vì một ô jsonb lạ thì tệ hơn nhiều.
 */
export async function docChotKy(ky: string): Promise<ChotKyDaLuu | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'view_kpi_logistics'))) {
    throw new Error('Không có quyền xem bảng KPI logistics');
  }
  const [row] = await db.select().from(schema.kpiLogisticsChot).where(eq(schema.kpiLogisticsChot.ky, ky)).limit(1);
  if (!row) return null;
  if (!laAnhChupHopLe(row.soLieu)) {
    console.error('[kpi] ảnh chụp kỳ', ky, 'không đọc được — quay về tính sống');
    return null;
  }
  return {
    // Ảnh chụp cũ thiếu trường thêm sau ngày chốt — chuẩn hoá trước khi giao cho màn, nếu không
    // màn đọc `auto.truongMoi.x` sẽ vỡ. Xem `chuanHoaAuto`.
    ky: row.ky, anhChup: { ...row.soLieu, auto: chuanHoaAuto(row.soLieu.auto) },
    ghiChu: row.ghiChu, chotBoi: row.chotBoi, chotAt: row.chotAt.toISOString(),
  };
}
