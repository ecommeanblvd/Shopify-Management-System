'use server';

import { and, eq, gte, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { requirePerm } from '@/features/receiving/perm';
import {
  GIOI_HAN, maBaoLoi, moduleTuDuongDan, mucDoHopLe, trangThaiHopLe,
} from './phan-loai';

type Ket = { ok: boolean; loi?: string; ma?: string };

/** Trần chống gửi dồn: một người không thể ngập hàng đợi của bot. */
const TOI_DA_MOI_GIO = 20;

export interface GuiBaoLoiVao {
  /** `window.location.pathname` lúc bấm — server suy module từ đây, không tin client. */
  duongDan: string;
  tieuDe: string;
  moTa: string;
  mucDo: string;
}

/** Ai đăng nhập cũng gửi được (CEO: "report ở từng module"); không cần quyền riêng. */
export async function guiBaoLoi(v: GuiBaoLoiVao): Promise<Ket> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Bạn cần đăng nhập để báo lỗi.' };

  const tieuDe = v.tieuDe.trim();
  const moTa = v.moTa.trim();
  if (tieuDe.length < 3) return { ok: false, loi: 'Tiêu đề quá ngắn.' };
  if (tieuDe.length > GIOI_HAN.tieuDe) return { ok: false, loi: `Tiêu đề tối đa ${GIOI_HAN.tieuDe} ký tự.` };
  if (moTa.length < 10) return { ok: false, loi: 'Mô tả quá ngắn — nói rõ đang làm gì và thấy gì.' };
  if (moTa.length > GIOI_HAN.moTa) return { ok: false, loi: `Mô tả tối đa ${GIOI_HAN.moTa} ký tự.` };
  if (!mucDoHopLe(v.mucDo)) return { ok: false, loi: 'Mức độ không hợp lệ.' };

  const [dem] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.issueReports)
    .where(and(
      eq(schema.issueReports.reporterId, session.user.id),
      gte(schema.issueReports.createdAt, new Date(Date.now() - 3600_000)),
    ));
  if ((dem?.n ?? 0) >= TOI_DA_MOI_GIO) {
    return { ok: false, loi: 'Bạn đã gửi nhiều báo lỗi trong 1 giờ qua. Thử lại sau.' };
  }

  const duongDan = v.duongDan.slice(0, GIOI_HAN.duongDan);
  const [r] = await db.insert(schema.issueReports).values({
    module: moduleTuDuongDan(duongDan).ma,
    pagePath: duongDan,
    title: tieuDe,
    description: moTa,
    mucDo: v.mucDo,
    reporterId: session.user.id,
    reporterEmail: session.user.email,
    userAgent: (await headers()).get('user-agent')?.slice(0, 300) ?? null,
  }).returning({ so: schema.issueReports.so });

  revalidatePath('/admin/issues');
  return { ok: true, ma: maBaoLoi(r.so) };
}

/** Admin đổi trạng thái tay (vd. đóng "không phải lỗi", mở lại cho bot). */
export async function doiTrangThaiBaoLoi(id: string, trangThai: string, ghiChu?: string): Promise<Ket> {
  await requirePerm('manage_users');
  if (!trangThaiHopLe(trangThai)) return { ok: false, loi: 'Trạng thái không hợp lệ.' };
  await db.update(schema.issueReports).set({
    trangThai,
    ...(ghiChu ? { ghiChuXuLy: ghiChu.slice(0, GIOI_HAN.ghiChu) } : {}),
    updatedAt: new Date(),
  }).where(eq(schema.issueReports.id, id));
  revalidatePath('/admin/issues');
  return { ok: true };
}
