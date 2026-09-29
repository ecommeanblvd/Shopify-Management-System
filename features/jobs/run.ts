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
 *
 * `kiemTra` cho tác vụ tự nói "tôi chạy xong nhưng KHÔNG làm được gì": trả về câu
 * lý do thì lượt chạy bị ghi là HỎNG mà vẫn giữ nguyên summary. Không có nó thì
 * một tác vụ hỏng 100 % vẫn báo xanh — đúng cách `track-ship-ho` chết âm thầm
 * suốt 141 lượt (phát hiện 11/09/2026).
 */
/** Hạn mặc định cho MỘT tác vụ nền. Đo 29/09/2026 trên 14 ngày: mọi việc trừ
 *  `refresh-owned-store` đều xong trong 512 giây, nên 15 phút là rộng rãi. */
export const HAN_MAC_DINH_GIAY = 15 * 60;

/**
 * Lời hứa "một việc hỏng KHÔNG chặn các việc sau" chỉ đúng với việc NÉM LỖI.
 * Việc TREO thì không ném gì cả — nó nằm im và bỏ đói mọi việc phía sau.
 *
 * Đo 29/09/2026: `refresh-owned-store` không ghi `finished_at` ở 41/294 lượt
 * (13,9%), và mỗi lần như vậy sáu việc xếp sau nó trong `sync-orders` không chạy
 * — trong đó có hai việc vừa thêm hôm ấy. Không có lỗi nào, không ai biết.
 *
 * Hết hạn thì ghi HỎNG rồi đi tiếp. KHÔNG dừng được việc đang treo (JS không huỷ
 * được promise của người khác) nhưng vòng lặp thoát ra được — đó mới là thứ cần.
 */
function hetHan(giay: number, jobKey: string): Promise<never> {
  return new Promise((_, tuChoi) => {
    setTimeout(() => tuChoi(new Error(`${jobKey}: quá hạn ${giay}s — bỏ qua để việc sau còn chạy`)),
      giay * 1000).unref?.();
  });
}

export async function chayMotJob(
  jobKey: string,
  fn: () => Promise<unknown>,
  kiemTra?: (summary: unknown) => string | null,
  opts?: { hanGiay?: number },
): Promise<boolean> {
  const han = opts?.hanGiay ?? HAN_MAC_DINH_GIAY;
  const batDau = Date.now();
  const id = await batDauJob(jobKey);
  try {
    const summary = await Promise.race([fn(), hetHan(han, jobKey)]);
    const loi = kiemTra?.(summary) ?? null;
    await ketThucJob(id, { ok: loi == null, summary, batDau, error: loi ?? undefined });
    process.stdout.write(`  ${loi == null ? '✓' : '✗'} ${jobKey} (${Date.now() - batDau}ms) ${summary ? JSON.stringify(summary).slice(0, 160) : ''}${loi ? ` — ${loi}` : ''}\n`);
    return loi == null;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await ketThucJob(id, { ok: false, error: msg.slice(0, 2000), batDau });
    process.stderr.write(`  ✗ ${jobKey}: ${msg.split('\n')[0]}\n`);
    return false;
  }
}

/**
 * `kiemTra` giống hệt `chayMotJob`: cho tác vụ tự nói "tôi chạy xong nhưng MỘT
 * PHẦN hỏng". Trả về câu lý do thì lượt chạy bị ghi là HỎNG mà vẫn giữ summary,
 * và câu lý do đó PHẢI gọi tên thứ hỏng (hãng nào, đơn nào) — exit code trần
 * chỉ nói "có lỗi" chứ không nói lỗi ở đâu, nên không ai biết mà sửa.
 */
export function chayCron(
  jobKey: string,
  fn: () => Promise<unknown>,
  kiemTra?: (summary: unknown) => string | null,
): void {
  const batDau = Date.now();
  void (async () => {
    const id = await batDauJob(jobKey);
    try {
      const summary = await fn();
      // Script tự đặt process.exitCode khi có lỗi CỤC BỘ (vài đơn hỏng nhưng
      // batch vẫn chạy hết) — vẫn phải tính là lỗi, không thì trang giám sát
      // báo xanh trong khi tác vụ đang hỏng một phần.
      const loiKiemTra = kiemTra?.(summary) ?? null;
      const loiCucBo = loiKiemTra != null || Number(process.exitCode ?? 0) !== 0;
      if (loiKiemTra != null) process.exitCode = 1;
      await ketThucJob(id, {
        ok: !loiCucBo, summary, batDau,
        error: loiCucBo
          ? (loiKiemTra ?? 'tác vụ tự báo lỗi (exit code khác 0)')
          : undefined,
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
