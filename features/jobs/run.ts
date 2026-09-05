import { batDauJob, ketThucJob } from './record';

/**
 * Vỏ bọc chuẩn cho mọi script cron: ghi nhật ký chạy + in kết quả + đặt exit code.
 *
 * Thay cho khuôn `main().catch(...).finally(process.exit())` lặp ở 16 script.
 * Giá trị trả về của `fn` được lưu vào `job_runs.summary` để trang giám sát hiện
 * được số liệu (đồng bộ bao nhiêu đơn, dọn bao nhiêu dòng…) chứ không chỉ
 * "chạy rồi".
 *
 * `jobKey` PHẢI có trong `JOB_REGISTRY`, nếu không trang giám sát sẽ không biết
 * chu kỳ mong đợi để tính quá hạn — có test canh việc này.
 */
/**
 * Chạy MỘT tác vụ, ghi nhật ký, KHÔNG thoát tiến trình. Dùng cho bộ chạy nhóm.
 * Trả về true nếu xong xuôi. Lỗi được nuốt và ghi lại — một tác vụ hỏng không
 * được kéo cả nhóm chết theo.
 */
export async function chayMotJob(jobKey: string, fn: () => Promise<unknown>): Promise<boolean> {
  const batDau = Date.now();
  const id = await batDauJob(jobKey);
  try {
    const summary = await fn();
    await ketThucJob(id, { ok: true, summary, batDau });
    process.stdout.write(`  ✓ ${jobKey} (${Date.now() - batDau}ms) ${summary ? JSON.stringify(summary).slice(0, 120) : ''}\n`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await ketThucJob(id, { ok: false, error: msg.slice(0, 2000), batDau });
    process.stderr.write(`  ✗ ${jobKey}: ${msg.split('\n')[0]}\n`);
    return false;
  }
}

export function chayCron(jobKey: string, fn: () => Promise<unknown>): void {
  const batDau = Date.now();
  void (async () => {
    const id = await batDauJob(jobKey);
    try {
      const summary = await fn();
      // Script tự đặt process.exitCode khi có lỗi CỤC BỘ (vài đơn hỏng nhưng
      // batch vẫn chạy hết) — vẫn phải tính là lỗi, không thì trang giám sát
      // báo xanh trong khi tác vụ đang hỏng một phần.
      const loiCucBo = Number(process.exitCode ?? 0) !== 0;
      await ketThucJob(id, {
        ok: !loiCucBo, summary, batDau,
        error: loiCucBo ? 'tác vụ tự báo lỗi (exit code khác 0)' : undefined,
      });
      process.stdout.write(`${jobKey}: xong (${Date.now() - batDau}ms) ${summary ? JSON.stringify(summary) : ''}\n`);
    } catch (err) {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      await ketThucJob(id, { ok: false, error: msg.slice(0, 2000), batDau });
      process.stderr.write(`${jobKey}: fatal: ${msg}\n`);
      process.exitCode = 1;
    } finally {
      process.exit();
    }
  })();
}
