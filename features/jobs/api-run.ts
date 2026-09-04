import { batDauJob, ketThucJob } from './record';

/**
 * Bản dùng cho endpoint `/api/cron/*` — cùng mục đích `chayCron` nhưng KHÔNG
 * đụng process.exit (đang trong tiến trình web, thoát là chết cả server).
 *
 * Endpoint và script cron là HAI đường vào riêng của cùng một tác vụ; đường nào
 * chạy cũng phải để lại dấu, nếu không trang giám sát sẽ báo "chưa chạy" trong
 * khi thực tế nó vẫn chạy qua đường kia.
 */
export async function chayJobApi<T>(jobKey: string, fn: () => Promise<T>): Promise<T> {
  const batDau = Date.now();
  const id = await batDauJob(jobKey);
  try {
    const summary = await fn();
    await ketThucJob(id, { ok: true, summary, batDau });
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await ketThucJob(id, { ok: false, error: msg.slice(0, 2000), batDau });
    throw err;
  }
}
