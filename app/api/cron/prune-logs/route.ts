/**
 * HTTP endpoint dọn các bảng log để database không phình lại tới trần 500MB
 * của Supabase (24/08 đã chạm 514MB và kho file bị khoá vì vượt hạn mức).
 *
 * Chỉ đụng dữ liệu không có giá trị nghiệp vụ — xem features/db-maintenance/
 * prune-logs.ts để biết từng luật và lý do chọn ngưỡng.
 *
 * Đường chạy chính trên Railway là script `npm run cron:prune-logs` (cron
 * service dùng chung DATABASE_URL). Route này dành cho cron ngoài qua HTTPS và
 * cho lần chạy tay khi cần.
 *
 * Authentication
 * --------------
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<your-railway-url>/api/cron/prune-logs
 *
 * Response shape
 * --------------
 *   { ok: true, prunedAt, results: [{ key, moTa, rows, cutoff }], tongDong }
 *   { ok: false, error: string }                  // 401/500
 */

import { NextResponse } from 'next/server';
import { pruneOldLogs } from '@/features/db-maintenance/prune-logs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const results = await pruneOldLogs();
    return NextResponse.json({
      ok: true,
      prunedAt: new Date().toISOString(),
      results,
      tongDong: results.reduce((s, r) => s + r.rows, 0),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
