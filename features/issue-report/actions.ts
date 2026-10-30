'use server';

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { requirePerm } from '@/features/receiving/perm';
import { ghiSuKien } from './su-kien';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { moduleXemDuoc, xemDuocAnh } from './pham-vi';
import { baoLoiTrongPhamVi, suKienCuaCacBaoLoi } from './queries';
import type { DongBaoLoi, DongSuKien } from '@/components/issue-report/ModalChiTietBaoLoi';
import { isStorageConfigured, putObject } from '@/lib/storage/s3';
import {
  ANH_BYTE_TOI_DA, ANH_TOI_DA, khoaAnh, nhanDangAnh, tenHienThi, type AnhBaoLoi,
} from './anh';
import {
  GIOI_HAN, maBaoLoi, moduleHopLe, moduleTuDuongDan, mucDoHopLe, trangThaiHopLe,
} from './phan-loai';

type Ket = { ok: boolean; loi?: string; ma?: string; canhBao?: string };

/** Trần chống gửi dồn: một người không thể ngập hàng đợi của bot. */
const TOI_DA_MOI_GIO = 20;

/** Ai đăng nhập cũng gửi được (CEO: "report ở từng module"); không cần quyền riêng. */
export async function guiBaoLoi(fd: FormData): Promise<Ket> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Bạn cần đăng nhập để báo lỗi.' };

  const chuoi = (k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string) : '');
  /** `window.location.pathname` lúc bấm — server suy module từ đây, không tin client. */
  const duongDanVao = chuoi('duongDan');
  const mucDoVao = chuoi('mucDo');
  /** Module người dùng chọn. Không hợp lệ/để trống → suy từ đường dẫn như trước. */
  const moduleVao = chuoi('module');
  const tieuDe = chuoi('tieuDe').trim();
  const moTa = chuoi('moTa').trim();
  if (tieuDe.length < 3) return { ok: false, loi: 'Tiêu đề quá ngắn.' };
  if (tieuDe.length > GIOI_HAN.tieuDe) return { ok: false, loi: `Tiêu đề tối đa ${GIOI_HAN.tieuDe} ký tự.` };
  if (moTa.length < 10) return { ok: false, loi: 'Mô tả quá ngắn — nói rõ đang làm gì và thấy gì.' };
  if (moTa.length > GIOI_HAN.moTa) return { ok: false, loi: `Mô tả tối đa ${GIOI_HAN.moTa} ký tự.` };
  if (!mucDoHopLe(mucDoVao)) return { ok: false, loi: 'Mức độ không hợp lệ.' };

  // Kiểm ảnh TRƯỚC khi ghi bất cứ gì: báo lỗi hỏng ảnh không được tạo ra nửa vời.
  const tep = fd.getAll('anh').filter((f): f is File => f instanceof File && f.size > 0);
  if (tep.length > ANH_TOI_DA) return { ok: false, loi: `Tối đa ${ANH_TOI_DA} ảnh.` };
  const anhHopLe: Array<{ ten: string; bytes: Uint8Array; loai: string; duoi: string }> = [];
  for (const f of tep) {
    if (f.size > ANH_BYTE_TOI_DA) {
      return { ok: false, loi: `Ảnh "${tenHienThi(f.name)}" quá ${ANH_BYTE_TOI_DA / 1024 / 1024}MB.` };
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const nd = nhanDangAnh(bytes);
    if (!nd) return { ok: false, loi: `"${tenHienThi(f.name)}" không phải ảnh PNG/JPG/WebP/GIF.` };
    anhHopLe.push({ ten: tenHienThi(f.name), bytes, ...nd });
  }

  const [dem] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.issueReports)
    .where(and(
      eq(schema.issueReports.reporterId, session.user.id),
      gte(schema.issueReports.createdAt, new Date(Date.now() - 3600_000)),
    ));
  if ((dem?.n ?? 0) >= TOI_DA_MOI_GIO) {
    return { ok: false, loi: 'Bạn đã gửi nhiều báo lỗi trong 1 giờ qua. Thử lại sau.' };
  }

  const duongDan = duongDanVao.slice(0, GIOI_HAN.duongDan);
  const [r] = await db.insert(schema.issueReports).values({
    module: moduleHopLe(moduleVao) ? moduleVao : moduleTuDuongDan(duongDan).ma,
    pagePath: duongDan,
    title: tieuDe,
    description: moTa,
    mucDo: mucDoVao,
    reporterId: session.user.id,
    reporterEmail: session.user.email,
    userAgent: (await headers()).get('user-agent')?.slice(0, 300) ?? null,
  }).returning({ id: schema.issueReports.id, so: schema.issueReports.so });

  await ghiSuKien({
    issueId: r.id, nguoi: session.user.email, loai: 'tao', denTrangThai: 'moi',
    ghiChu: `Báo lỗi mới (${anhHopLe.length} ảnh)`,
  });

  // Ảnh là phần PHỤ: báo lỗi đã ghi rồi, kho lưu trữ hỏng không được làm mất nó. Nói rõ cho
  // người báo biết ảnh chưa lên, để họ gửi lại ảnh qua cách khác thay vì tưởng đã đủ.
  let canhBao: string | undefined;
  if (anhHopLe.length) {
    if (!isStorageConfigured()) {
      canhBao = 'Kho lưu ảnh chưa được cấu hình nên ảnh CHƯA được lưu.';
    } else {
      try {
        const luu: AnhBaoLoi[] = [];
        for (const [i, a] of anhHopLe.entries()) {
          const key = khoaAnh(r.id, i + 1, a.duoi);
          await putObject(key, a.bytes, a.loai);
          luu.push({ key, ten: a.ten, loai: a.loai, kichThuoc: a.bytes.byteLength });
        }
        await db.update(schema.issueReports).set({ anh: luu })
          .where(eq(schema.issueReports.id, r.id));
      } catch (e) {
        console.error('[issue-report] lưu ảnh lỗi:', e);
        canhBao = 'Báo lỗi đã được ghi nhưng ảnh CHƯA lưu được. Gửi lại ảnh cho admin bằng cách khác.';
      }
    }
  }

  revalidatePath('/admin/issues');
  return { ok: true, ma: maBaoLoi(r.so), canhBao };
}

/** Admin đổi trạng thái tay (vd. đóng "không phải lỗi", mở lại cho bot). */
export async function doiTrangThaiBaoLoi(id: string, trangThai: string, ghiChu?: string): Promise<Ket> {
  const userId = await requirePerm('manage_users');
  if (!trangThaiHopLe(trangThai)) return { ok: false, loi: 'Trạng thái không hợp lệ.' };
  const [cu] = await db.select({ trangThai: schema.issueReports.trangThai }).from(schema.issueReports)
    .where(eq(schema.issueReports.id, id)).limit(1);
  if (!cu) return { ok: false, loi: 'Không tìm thấy báo lỗi.' };
  const [nguoi] = await db.select({ email: schema.user.email }).from(schema.user)
    .where(eq(schema.user.id, userId)).limit(1);
  await db.update(schema.issueReports).set({
    trangThai,
    ...(ghiChu ? { ghiChuXuLy: ghiChu.slice(0, GIOI_HAN.ghiChu) } : {}),
    updatedAt: new Date(),
  }).where(eq(schema.issueReports.id, id));
  if (cu.trangThai !== trangThai || ghiChu) {
    await ghiSuKien({
      issueId: id, nguoi: nguoi?.email ?? userId, loai: 'doi_trang_thai',
      tuTrangThai: cu.trangThai, denTrangThai: trangThai, ghiChu: ghiChu ?? null,
    });
  }
  revalidatePath('/admin/issues');
  return { ok: true };
}

/* ── Màn lịch sử báo lỗi cho nhân sự ───────────────────────────────────────── */

export interface LichSuBaoLoi {
  dong: DongBaoLoi[];
  suKien: Record<string, DongSuKien[]>;
  /** email → tên, cho dòng thời gian. */
  tenNguoi: Record<string, string>;
  /** `true` khi `module` nằm trong phạm vi người đọc. `false` ⇒ họ chỉ thấy lỗi của chính mình
   *  ở màn này, nên giao diện phải nói ra điều đó thay vì hiện bảng trống. */
  trongPhamVi: boolean;
  xemHet: boolean;
}

/**
 * Lịch sử báo lỗi TRONG PHẠM VI người đang đăng nhập.
 *
 * Thiếu `view_bao_loi` ⇒ trả `ok: false`. Nơi gọi (tab trong panel) không hiện tab, nhưng hàm
 * vẫn phải tự gác: đây là cổng dữ liệu, không phải cổng hiển thị.
 */
export async function docLichSuBaoLoi(
  vao: { module?: string; gioiHan?: number } = {},
): Promise<{ ok: true; kq: LichSuBaoLoi } | { ok: false; loi: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, loi: 'Bạn cần đăng nhập.' };
  const roleKey = await getRole(session.user.id);
  if (!hasPermission(roleKey, 'view_bao_loi')) {
    return { ok: false, loi: 'Vai trò của bạn chưa có quyền xem lịch sử báo lỗi.' };
  }
  const userId = session.user.id;
  const pv = moduleXemDuoc(roleKey);
  const moduleLoc = vao.module && moduleHopLe(vao.module) ? vao.module : undefined;

  const rows = await baoLoiTrongPhamVi({
    roleKey, userId, module: moduleLoc, gioiHan: vao.gioiHan ?? 20,
  });
  const suKien = await suKienCuaCacBaoLoi(rows.map((r) => r.id));

  /* Tên người: gộp email của người báo và của mọi dòng thời gian thành MỘT lượt đọc. */
  const email = new Set<string>();
  for (const r of rows) if (r.reporterEmail) email.add(r.reporterEmail);
  for (const ds of suKien.values()) for (const e of ds) email.add(e.nguoi);
  const tenNguoi: Record<string, string> = {};
  if (email.size > 0) {
    for (const u of await db.select({ email: schema.user.email, name: schema.user.name })
      .from(schema.user).where(inArray(schema.user.email, [...email]))) {
      if (u.name) tenNguoi[u.email] = u.name;
    }
  }

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    ok: true,
    kq: {
      trongPhamVi: pv.tatCa || (moduleLoc == null ? true : pv.module.has(moduleLoc)),
      xemHet: pv.tatCa,
      tenNguoi,
      dong: rows.map((r) => ({
        id: r.id, so: r.so, module: r.module, pagePath: r.pagePath, title: r.title,
        description: r.description, mucDo: r.mucDo, trangThai: r.trangThai,
        anh: r.anh as AnhBaoLoi[],
        ghiChuXuLy: r.ghiChuXuLy, prUrl: r.prUrl,
        xuLyLanCuoi: iso(r.xuLyLanCuoi), createdAt: r.createdAt.toISOString(),
        tenNguoiBao: r.reporterEmail ? (tenNguoi[r.reporterEmail] ?? null) : null,
        emailNguoiBao: r.reporterEmail,
        // Ảnh siết hơn chữ (thiết kế §11) — tính Ở ĐÂY, client không tự quyết được.
        xemAnh: xemDuocAnh({ roleKey, laNguoiBao: r.reporterId === userId }),
      })),
      suKien: Object.fromEntries([...suKien.entries()].map(([id, ds]) => [
        id, ds.map((e) => ({
          id: e.id, luc: e.luc.toISOString(), nguoi: e.nguoi,
          tuTrangThai: e.tuTrangThai, denTrangThai: e.denTrangThai,
          ghiChu: e.ghiChu, prUrl: e.prUrl,
        })),
      ])),
    },
  };
}
