/**
 * Đọc các lượt chạy của job `dong-bo-ton-kho-lark` và in ra dễ đọc.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/xem-luot-dong-bo-ton-kho.ts [so-luot]
 *
 * CHỈ ĐỌC. Chạy được từ máy dev (chỉ cần `DATABASE_URL`, không cần credential Lark) —
 * thay cho việc phải mở `/f/jobs` để xem `job_runs.summary`.
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

interface TomTat {
  larkRows?: number; larkSkus?: number; planned?: number;
  added?: number; adjusted?: number; zeroed?: number;
  cappedByReserved?: number; dryRun?: boolean;
  tuChoi?: string; cachGhiMotLuot?: string; errors?: string[];
  veKhong?: { larkNoi0: number; larkIm: number; khoKhac: number; larkImThatSu: number; chiecMatLarkNoi0: number; chiecMatLarkIm: number };
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 3) || 3;
  const q = await db.execute(sql`
    select started_at, status, duration_ms, summary, error
    from job_runs where job_key = 'dong-bo-ton-kho-lark'
    order by started_at desc limit ${n}`);
  const rows = ((q as unknown as { rows?: Record<string, unknown>[] }).rows ?? (q as unknown as Record<string, unknown>[])) ?? [];
  if (!rows.length) { console.log('Chưa có lượt chạy nào.'); process.exit(0); }

  for (const r of rows) {
    const s = (r.summary ?? {}) as TomTat;
    console.log(`\n═══ ${String(r.started_at)} · ${String(r.status)} · ${r.duration_ms}ms · ${s.dryRun ? 'CHẠY THỬ' : 'GHI THẬT'}`);
    console.log(`  Lark ${s.larkRows} dòng / ${s.larkSkus} cặp · kế hoạch ${s.planned} thay đổi`);
    console.log(`  thêm ${s.added} · sửa ${s.adjusted} · về 0 ${s.zeroed} · bị reserved chặn ${s.cappedByReserved}`);
    if (s.veKhong) {
      const v = s.veKhong;
      console.log(`  tách "về 0": Lark-nói-0 ${v.larkNoi0} (${v.chiecMatLarkNoi0} chiếc) · Lark-im ${v.larkIm} (${v.chiecMatLarkIm} chiếc)`
        + ` = nghi-lệch-kho ${v.khoKhac} + không-hề-có ${v.larkImThatSu}`);
    }
    if (s.errors?.length) console.log(`  LỖI: ${s.errors.slice(0, 3).join(' | ')}`);
    if (r.error) console.log(`  error: ${String(r.error).slice(0, 300)}`);
    if (s.tuChoi) console.log(`  TỪ CHỐI: ${s.tuChoi}`);
    if (s.cachGhiMotLuot) console.log(`  để ghi một lượt: ${s.cachGhiMotLuot}`);
    if (!s.dryRun && !s.tuChoi) console.log('  ✓ ĐÃ GHI THẬT');
  }
  process.exit(0);
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
