/**
 * Dọn định kỳ các bảng chỉ-ghi (log) để database không phình lại.
 *
 * Bối cảnh: Supabase gói free giới hạn 500MB. Ngày 24/08 DB chạm 514MB, trong
 * đó log webhook Shopify tự tích 30.031 dòng chỉ sau 3 tháng và cột JSON gốc
 * của quote FedEx chiếm 10MB trên vỏn vẹn 1.310 dòng. Dọn tay một lần không
 * giải quyết được gốc — nó sẽ đầy lại y như cũ, nên việc dọn phải chạy đều.
 *
 * Nguyên tắc: chỉ đụng dữ liệu KHÔNG có giá trị nghiệp vụ.
 *   - Log webhook: chỉ dùng để chặn xử lý trùng, mà Shopify chỉ thử lại trong
 *     khoảng 48 giờ → giữ 30 ngày đã quá dư.
 *   - fedex_rate_quotes: các cột số liệu (cước, fuel, zone…) là dữ liệu đối
 *     soát, GIỮ NGUYÊN VĨNH VIỄN; chỉ rỗng hoá cột `raw` (JSON thô FedEx trả
 *     về, không màn hình nào đọc, chỉ để parse lại khi cần).
 *
 * Dữ liệu bị dọn vẫn nạp lại được: xem scripts/archive-db-tables.mjs và
 * scripts/restore-db-archive.mjs (bản lưu ở ~/Documents/SMS-DB-Archive).
 */

import { db } from '@/db/client';

export type PruneRule = {
  /** Khoá định danh, dùng trong kết quả trả về và log. */
  key: string;
  /** Mô tả tiếng Việt để hiện trong phản hồi cron. */
  moTa: string;
  table: string;
  /** Cột thời gian dùng làm mốc cắt. */
  timeColumn: string;
  keepDays: number;
  /** `delete` xoá cả dòng; `null-column` chỉ rỗng hoá một cột nặng. */
  mode: 'delete' | 'null-column';
  /** Bắt buộc khi mode = 'null-column'. */
  column?: string;
};

export const PRUNE_RULES: readonly PruneRule[] = [
  {
    key: 'shopify_webhook_log',
    moTa: 'Log webhook Shopify quá 30 ngày',
    table: 'shopify_webhook_log',
    timeColumn: 'received_at',
    keepDays: 30,
    mode: 'delete',
  },
  {
    key: 'fedex_rate_quotes_raw',
    moTa: 'JSON thô của quote FedEx quá 30 ngày (số liệu quote giữ nguyên)',
    table: 'fedex_rate_quotes',
    timeColumn: 'quoted_at',
    keepDays: 30,
    mode: 'null-column',
    column: 'raw',
  },
];

export function cutoffFor(rule: Pick<PruneRule, 'keepDays'>, now: Date): Date {
  return new Date(now.getTime() - rule.keepDays * 24 * 60 * 60 * 1000);
}

/**
 * Tên bảng/cột được ghép thẳng vào câu lệnh (Postgres không nhận tham số cho
 * identifier). An toàn vì chúng là hằng số trong PRUNE_RULES, và test chặn
 * mọi ký tự lạ. Mốc thời gian luôn đi qua tham số $1.
 */
export function buildPruneSql(rule: PruneRule): string {
  if (rule.mode === 'null-column') {
    return `UPDATE "${rule.table}" SET "${rule.column}" = NULL WHERE "${rule.column}" IS NOT NULL AND "${rule.timeColumn}" < $1`;
  }
  return `DELETE FROM "${rule.table}" WHERE "${rule.timeColumn}" < $1`;
}

export type PruneResult = { key: string; moTa: string; rows: number; cutoff: string };

export async function pruneOldLogs(now: Date = new Date()): Promise<PruneResult[]> {
  const out: PruneResult[] = [];
  for (const rule of PRUNE_RULES) {
    const cutoff = cutoffFor(rule, now);
    const res = await db.$client.query(buildPruneSql(rule), [cutoff]);
    out.push({ key: rule.key, moTa: rule.moTa, rows: res.rowCount ?? 0, cutoff: cutoff.toISOString() });
  }
  return out;
}
