'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { db, schema } from '@/db/client';

/** Bảng KPI gắn với lương nên chỉ admin xem/sửa. */
async function requireAdmin(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin') throw new Error('Chỉ admin được xem và sửa bảng KPI lương');
  return session.user.id;
}

export interface NhapKpiInput {
  ky: string;
  soDonAmCuocLoi: number;
  tyLeSizeThung: number | null;
  roRiGiam: boolean;
  khacPhucGoc: boolean;
  gateOverride: boolean | null;
  gateGhiChu: string | null;
  thuHoiKeToanVnd: number | null;
  clawbackVnd: number;
  nguonSla: 'sop' | 'quy_che';
  ghiChu: string | null;
}

/** Lưu số liệu nhập tay của một kỳ (upsert theo kỳ). */
export async function luuNhapKpi(input: NhapKpiInput): Promise<{ ok: true }> {
  const userId = await requireAdmin();
  if (!/^\d{4}-\d{2}$/.test(input.ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  const gt = {
    soDonAmCuocLoi: Math.max(0, Math.floor(input.soDonAmCuocLoi || 0)),
    tyLeSizeThung: input.tyLeSizeThung == null ? null : String(Math.min(1, Math.max(0, input.tyLeSizeThung))),
    roRiGiam: !!input.roRiGiam,
    khacPhucGoc: !!input.khacPhucGoc,
    gateOverride: input.gateOverride,
    gateGhiChu: input.gateGhiChu?.trim() || null,
    thuHoiKeToanVnd: input.thuHoiKeToanVnd == null ? null : String(Math.max(0, input.thuHoiKeToanVnd)),
    clawbackVnd: String(Math.max(0, input.clawbackVnd || 0)),
    nguonSla: input.nguonSla === 'quy_che' ? 'quy_che' : 'sop',
    ghiChu: input.ghiChu?.trim() || null,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db.insert(schema.kpiLogisticsThang).values({ ky: input.ky, ...gt })
    .onConflictDoUpdate({ target: schema.kpiLogisticsThang.ky, set: gt });
  revalidatePath('/f/kpi-logistics');
  return { ok: true };
}

/** Số liệu nhập tay đã lưu của một kỳ (null khi chưa nhập). */
export async function docNhapKpi(ky: string): Promise<typeof schema.kpiLogisticsThang.$inferSelect | null> {
  await requireAdmin();
  const [row] = await db.select().from(schema.kpiLogisticsThang).where(eq(schema.kpiLogisticsThang.ky, ky));
  return row ?? null;
}
