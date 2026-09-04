import { db } from '@/db/client';
import {
  JOB_REGISTRY, trangThaiJob, xepTheoMucDoLo,
  type TrangThaiJob,
} from './registry';

export interface JobRow {
  key: string;
  ten: string;
  hauQua: string;
  chuKyPhut: number;
  trangThai: TrangThaiJob;
  lanCuoi: string | null;      // ISO
  trangThaiLanCuoi: string | null;
  durationMs: number | null;
  error: string | null;
  summary: unknown;
  /** Số lần chạy 7 ngày qua + số lần lỗi, để thấy tác vụ chập chờn. */
  soLan7Ngay: number;
  soLoi7Ngay: number;
}

/**
 * Trạng thái mọi tác vụ nền. Đi từ SỔ ĐĂNG KÝ chứ không từ bảng job_runs — tác
 * vụ chưa chạy lần nào sẽ không có dòng nào trong job_runs, mà đó chính là ca
 * nghiêm trọng nhất (chưa ai lên lịch) nên không được để nó biến mất khỏi bảng.
 */
export async function trangThaiCacJob(now: Date = new Date()): Promise<JobRow[]> {
  const { rows } = await db.$client.query(`
    SELECT DISTINCT ON (job_key)
      job_key, started_at, status, duration_ms, error, summary
    FROM job_runs
    ORDER BY job_key, started_at DESC
  `);
  const cuoi = new Map(rows.map((r: Record<string, unknown>) => [String(r.job_key), r]));

  const { rows: dem } = await db.$client.query(`
    SELECT job_key, count(*)::int AS n, count(*) FILTER (WHERE status = 'error')::int AS loi
    FROM job_runs WHERE started_at > now() - interval '7 days' GROUP BY job_key
  `);
  const demMap = new Map(dem.map((r: Record<string, unknown>) => [String(r.job_key), r]));

  const out: JobRow[] = JOB_REGISTRY.map((j) => {
    const r = cuoi.get(j.key);
    const lanCuoi = r
      ? { startedAt: new Date(String(r.started_at)), status: String(r.status), durationMs: r.duration_ms as number | null, error: r.error as string | null }
      : null;
    const d = demMap.get(j.key);
    return {
      key: j.key, ten: j.ten, hauQua: j.hauQua, chuKyPhut: j.chuKyPhut,
      trangThai: trangThaiJob(j, lanCuoi, now),
      lanCuoi: lanCuoi ? lanCuoi.startedAt.toISOString() : null,
      trangThaiLanCuoi: lanCuoi?.status ?? null,
      durationMs: lanCuoi?.durationMs ?? null,
      error: lanCuoi?.error ?? null,
      summary: r?.summary ?? null,
      soLan7Ngay: d ? Number(d.n) : 0,
      soLoi7Ngay: d ? Number(d.loi) : 0,
    };
  });
  return xepTheoMucDoLo(out);
}

export interface LanChayRow {
  jobKey: string; startedAt: string; status: string; durationMs: number | null; error: string | null; summary: unknown;
}

/** Lịch sử chạy gần đây (mọi tác vụ) — để soi khi một cái vừa hỏng. */
export async function lichSuChay(limit = 50): Promise<LanChayRow[]> {
  const { rows } = await db.$client.query(
    `SELECT job_key, started_at, status, duration_ms, error, summary
     FROM job_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
  return rows.map((r: Record<string, unknown>) => ({
    jobKey: String(r.job_key), startedAt: new Date(String(r.started_at)).toISOString(),
    status: String(r.status), durationMs: r.duration_ms as number | null,
    error: r.error as string | null, summary: r.summary,
  }));
}
