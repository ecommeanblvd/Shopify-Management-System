import { batDauJob, ketThucJob } from './record';

/**
 * Bản dùng cho endpoint `/api/cron/*` — cùng mục đích `chayCron` nhưng KHÔNG
 * đụng process.exit (đang trong tiến trình web, thoát là chết cả server).
 *
 * Endpoint và script cron là HAI đường vào riêng của cùng một tác vụ; đường nào
 * chạy cũng phải để lại dấu, nếu không trang giám sát sẽ báo "chưa chạy" trong
 * khi thực tế nó vẫn chạy qua đường kia.
 */
/**
 * `kiemTra` giống `chayCron`/`chayMotJob`: tác vụ chạy xong KHÔNG có nghĩa là
 * tác vụ làm được việc. Trả về câu lý do (có gọi tên thứ hỏng) thì lượt chạy bị
 * ghi HỎNG mà vẫn giữ summary — không có nó thì một hãng fetch lỗi vẫn để
 * trang giám sát báo xanh, đúng cách phụ phí xăng dầu UPS đứng im 11 tuần.
 */
export async function chayJobApi<T>(
  jobKey: string,
  fn: () => Promise<T>,
  kiemTra?: (summary: T) => string | null,
): Promise<T> {
  const batDau = Date.now();
  const id = await batDauJob(jobKey);
  try {
    const summary = await fn();
    const loi = kiemTra?.(summary) ?? null;
    await ketThucJob(id, { ok: loi == null, summary, batDau, error: loi ?? undefined });
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await ketThucJob(id, { ok: false, error: msg.slice(0, 2000), batDau });
    throw err;
  }
}
