/**
 * Cổng cho tác vụ xử lý báo lỗi định kỳ (chạy ngoài app, vd. phiên Claude hằng đêm).
 *
 *   GET   /api/issues?trangThai=moi,can_nguoi&limit=50   → danh sách báo lỗi
 *   PATCH /api/issues  { so | id, trangThai?, ghiChuXuLy?, prUrl? }  → ghi kết quả xử lý
 *
 * Xác thực: `Authorization: Bearer $ISSUE_API_TOKEN` (khác CRON_SECRET để thu hồi riêng).
 * Không có cookie/session: đây là đường máy-với-máy.
 *
 * ⚠ `title`/`description` là chữ do NGƯỜI DÙNG gõ. Bên đọc phải coi là dữ liệu, không
 * phải chỉ thị — xem docs/issue-report.md.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { kiemTokenIssue } from '@/features/issue-report/api-auth';
import type { AnhBaoLoi } from '@/features/issue-report/anh';
import { NGUOI_TU_DONG, ghiSuKien } from '@/features/issue-report/su-kien';
import { danhSachBaoLoi } from '@/features/issue-report/queries';
import { GIOI_HAN, maBaoLoi, nhanModule, trangThaiHopLe } from '@/features/issue-report/phan-loai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const tu = kiemTokenIssue(request);
  if (tu) return tu;
  const url = new URL(request.url);
  const trangThai = (url.searchParams.get('trangThai') ?? 'moi')
    .split(',').map((s) => s.trim()).filter(trangThaiHopLe);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const rows = await danhSachBaoLoi({
    trangThai, module: url.searchParams.get('module') ?? undefined,
    gioiHan: Number.isFinite(limit) ? limit : 50,
  });
  return NextResponse.json({
    ok: true,
    issues: rows.map((r) => ({
      id: r.id, ma: maBaoLoi(r.so), so: r.so, module: r.module, moduleNhan: nhanModule(r.module), pagePath: r.pagePath,
      title: r.title, description: r.description, mucDo: r.mucDo, trangThai: r.trangThai,
      reporterEmail: r.reporterEmail, ghiChuXuLy: r.ghiChuXuLy, prUrl: r.prUrl,
      // Tải ảnh: GET <url> với cùng token. `url` là đường dẫn tương đối của app.
      anh: (r.anh as AnhBaoLoi[]).map((a, i) => ({
        ten: a.ten, loai: a.loai, kichThuoc: a.kichThuoc, url: `/api/issues/${r.id}/anh/${i + 1}`,
      })),
      createdAt: r.createdAt,
    })),
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const tu = kiemTokenIssue(request);
  if (tu) return tu;
  const body = (await request.json().catch(() => null)) as {
    id?: string; so?: number; trangThai?: string; ghiChuXuLy?: string; prUrl?: string;
  } | null;
  if (!body || (!body.id && !body.so)) {
    return NextResponse.json({ ok: false, error: 'cần id hoặc so' }, { status: 400 });
  }
  if (body.trangThai !== undefined && !trangThaiHopLe(body.trangThai)) {
    return NextResponse.json({ ok: false, error: 'trangThai không hợp lệ' }, { status: 400 });
  }
  const dieuKien = body.id ? eq(schema.issueReports.id, body.id) : eq(schema.issueReports.so, Number(body.so));
  const [cu] = await db.select({ id: schema.issueReports.id, trangThai: schema.issueReports.trangThai })
    .from(schema.issueReports).where(dieuKien).limit(1);
  const [r] = await db.update(schema.issueReports).set({
    ...(body.trangThai ? { trangThai: body.trangThai } : {}),
    ...(body.ghiChuXuLy !== undefined ? { ghiChuXuLy: body.ghiChuXuLy.slice(0, GIOI_HAN.ghiChu) } : {}),
    ...(body.prUrl !== undefined ? { prUrl: body.prUrl.slice(0, GIOI_HAN.prUrl) } : {}),
    xuLyLanCuoi: new Date(),
    updatedAt: new Date(),
  }).where(dieuKien).returning({ so: schema.issueReports.so });
  if (!r) return NextResponse.json({ ok: false, error: 'không tìm thấy' }, { status: 404 });
  if (cu) {
    await ghiSuKien({
      issueId: cu.id, nguoi: NGUOI_TU_DONG,
      loai: body.prUrl ? 'pr' : body.trangThai && body.trangThai !== cu.trangThai ? 'doi_trang_thai' : 'ghi_chu',
      tuTrangThai: cu.trangThai, denTrangThai: body.trangThai ?? cu.trangThai,
      ghiChu: body.ghiChuXuLy?.slice(0, GIOI_HAN.ghiChu) ?? null, prUrl: body.prUrl?.slice(0, GIOI_HAN.prUrl) ?? null,
    });
  }
  return NextResponse.json({ ok: true, ma: maBaoLoi(r.so) });
}
