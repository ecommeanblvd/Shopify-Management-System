import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
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
