import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/**
 * Ghi nhận một lần chạy tác vụ nền.
 *
 * NGUYÊN TẮC: ghi nhật ký KHÔNG BAO GIỜ được làm hỏng tác vụ. Mọi lỗi ở đây đều
 * nuốt và chỉ cảnh báo ra log — thà mất một dòng nhật ký còn hơn làm chết một
 * lần đồng bộ đơn hàng.
 */
export async function batDauJob(jobKey: string): Promise<string | null> {
  try {
    const [row] = await db.insert(schema.jobRuns)
      .values({ jobKey, startedAt: new Date(), status: 'running' })
      .returning({ id: schema.jobRuns.id });
    return row?.id ?? null;
  } catch (e) {
    console.warn(`[jobs] không ghi được lúc bắt đầu ${jobKey}:`, e);
    return null;
  }
}

export async function ketThucJob(
  id: string | null,
  ket: { ok: boolean; summary?: unknown; error?: string; batDau: number },
): Promise<void> {
  if (!id) return;
  try {
    await db.update(schema.jobRuns).set({
      finishedAt: new Date(),
      status: ket.ok ? 'ok' : 'error',
      durationMs: Date.now() - ket.batDau,
      summary: (ket.summary ?? null) as object | null,
      error: ket.error ?? null,
    }).where(eq(schema.jobRuns.id, id));
  } catch (e) {
    console.warn(`[jobs] không ghi được lúc kết thúc ${id}:`, e);
  }
}
