import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { phamViDoc } from './pham-vi';

export type BaoLoi = typeof schema.issueReports.$inferSelect;

export async function danhSachBaoLoi(loc: {
  trangThai?: string[]; module?: string; gioiHan?: number;
}): Promise<BaoLoi[]> {
  const dk: SQL[] = [];
  if (loc.trangThai?.length) dk.push(inArray(schema.issueReports.trangThai, loc.trangThai));
  if (loc.module) dk.push(eq(schema.issueReports.module, loc.module));
  return db.select().from(schema.issueReports)
    .where(dk.length ? and(...dk) : undefined)
    .orderBy(desc(schema.issueReports.createdAt))
    .limit(Math.min(Math.max(loc.gioiHan ?? 100, 1), 500));
}

export async function demTheoTrangThai(): Promise<Record<string, number>> {
  const rows = await db.select({
    trangThai: schema.issueReports.trangThai,
    n: sql<number>`count(*)::int`,
  }).from(schema.issueReports).groupBy(schema.issueReports.trangThai);
  return Object.fromEntries(rows.map((r) => [r.trangThai, r.n]));
}

export type SuKienBaoLoi = typeof schema.issueReportEvents.$inferSelect;

/** Dòng thời gian của các báo lỗi cho trước, gom theo `issueId`. Bảng chưa có → rỗng. */
export async function suKienCuaCacBaoLoi(ids: string[]): Promise<Map<string, SuKienBaoLoi[]>> {
  const out = new Map<string, SuKienBaoLoi[]>();
  if (ids.length === 0) return out;
  try {
    const rows = await db.select().from(schema.issueReportEvents)
      .where(inArray(schema.issueReportEvents.issueId, ids))
      .orderBy(asc(schema.issueReportEvents.luc));
    for (const r of rows) {
      const ds = out.get(r.issueId) ?? [];
      ds.push(r); out.set(r.issueId, ds);
    }
  } catch (e) {
    console.error('[issue-report] đọc dòng thời gian lỗi:', e);
  }
  return out;
}

/** Số báo lỗi đang CHỜ ADMIN: cần người quyết + chờ duyệt PR. Cho số đỏ ở menu chính. */
let cache: { n: number; luc: number } | null = null;
export async function demViecChoAdmin(): Promise<number> {
  if (cache && Date.now() - cache.luc < 30_000) return cache.n;
  try {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.issueReports)
      .where(inArray(schema.issueReports.trangThai, ['can_nguoi', 'cho_duyet']));
    cache = { n: r?.n ?? 0, luc: Date.now() };
    return cache.n;
  } catch (e) {
    // Menu chính không được sập vì bảng báo lỗi: lỗi thì không hiện số.
    console.error('[issue-report] đếm việc chờ admin lỗi:', e);
    return 0;
  }
}

/** Lần xử lý gần nhất của tác vụ tự động (từ `xu_ly_lan_cuoi` của mọi báo lỗi). */
export async function lanXuLyGanNhat(): Promise<Date | null> {
  const [r] = await db.select({ luc: sql<Date | null>`max(${schema.issueReports.xuLyLanCuoi})` })
    .from(schema.issueReports);
  return r?.luc ? new Date(r.luc) : null;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Đọc theo PHẠM VI cho màn nhân sự (`/f/bao-loi` và tab Lịch sử). Khác
 * `danhSachBaoLoi` ở trên — hàm đó không gác gì, chỉ `/admin/issues` dùng.
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * Điều kiện phạm vi: `undefined` = không lọc (xem hết).
 *
 * `reporter_id = người đọc` LUÔN là một nhánh OR, nên người báo đọc được lỗi của mình kể cả khi
 * module của nó nằm ngoài phạm vi — xem `xemDuocChu` và thiết kế §6.2b.
 */
function dieuKienPhamVi(roleKey: string, userId: string): SQL | undefined {
  const pv = phamViDoc(roleKey);
  if (pv.kieu === 'tat_ca') return undefined;
  const nhanh: SQL[] = [eq(schema.issueReports.reporterId, userId)];
  if (pv.module.length > 0) nhanh.push(inArray(schema.issueReports.module, pv.module));
  return or(...nhanh);
}

/** Tham số `module` / `trangThai` chỉ THU HẸP thêm, không bao giờ mở rộng phạm vi. */
export async function baoLoiTrongPhamVi(a: {
  roleKey: string; userId: string; module?: string; trangThai?: string; gioiHan?: number;
}): Promise<BaoLoi[]> {
  const dk: SQL[] = [];
  const pv = dieuKienPhamVi(a.roleKey, a.userId);
  if (pv) dk.push(pv);
  if (a.module) dk.push(eq(schema.issueReports.module, a.module));
  if (a.trangThai) dk.push(eq(schema.issueReports.trangThai, a.trangThai));
  return db.select().from(schema.issueReports)
    .where(dk.length ? and(...dk) : undefined)
    .orderBy(desc(schema.issueReports.createdAt))
    .limit(Math.min(Math.max(a.gioiHan ?? 100, 1), 500));
}

/** `null` khi không có, HOẶC khi có mà ngoài phạm vi — nơi gọi nói "không tìm thấy" cho cả hai
 *  ca, đừng nói "không có quyền": câu đó xác nhận báo lỗi đó tồn tại. */
export async function baoLoiTheoSo(a: {
  so: number; roleKey: string; userId: string;
}): Promise<BaoLoi | null> {
  const dk: SQL[] = [eq(schema.issueReports.so, a.so)];
  const pv = dieuKienPhamVi(a.roleKey, a.userId);
  if (pv) dk.push(pv);
  const [r] = await db.select().from(schema.issueReports).where(and(...dk)).limit(1);
  return r ?? null;
}

/** Đếm theo trạng thái TRONG phạm vi — ô đếm ở trang rộng dùng nó làm bộ lọc. */
export async function demTrangThaiTrongPhamVi(a: {
  roleKey: string; userId: string;
}): Promise<Record<string, number>> {
  const pv = dieuKienPhamVi(a.roleKey, a.userId);
  const rows = await db.select({
    trangThai: schema.issueReports.trangThai,
    n: sql<number>`count(*)::int`,
  }).from(schema.issueReports).where(pv).groupBy(schema.issueReports.trangThai);
  return Object.fromEntries(rows.map((r) => [r.trangThai, r.n]));
}
