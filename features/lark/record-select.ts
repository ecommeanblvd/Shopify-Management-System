/** Chọn record Lark "mới nhất" theo created_time khi 1 đơn có nhiều record. THUẦN. */
import type { LarkRecord } from './client';

export function larkCreatedTime(rec: LarkRecord): number {
  return typeof rec.created_time === 'number' && Number.isFinite(rec.created_time) ? rec.created_time : 0;
}

/** Record có created_time lớn nhất. Thiếu hết → record cuối mảng (mới nhất theo
 *  thứ tự Lark). Rỗng → null. Tiebreak: record sau thắng (ổn định). */
export function pickLatestRecord(records: LarkRecord[]): LarkRecord | null {
  if (records.length === 0) return null;
  let best = records[0];
  for (const r of records) {
    if (larkCreatedTime(r) >= larkCreatedTime(best)) best = r; // >= → record sau thắng khi bằng
  }
  return best;
}

/** Copy đã sort created_time GIẢM dần; bằng nhau giữ thứ tự gốc (ổn định). */
export function sortRecordsLatestFirst(records: LarkRecord[]): LarkRecord[] {
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => larkCreatedTime(b.r) - larkCreatedTime(a.r) || a.i - b.i)
    .map((x) => x.r);
}
