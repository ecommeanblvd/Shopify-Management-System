import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db/client';

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
