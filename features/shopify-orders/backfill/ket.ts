/**
 * THUẦN: nhận ra một lượt nạp lịch sử đã CHẾT, và chọn khoảng cần nạp lại (CEO 30/09/2026).
 *
 * Lượt nạp của MEAN BLVD kẹt ở `running` từ 15/07/2026, dừng nhúc nhích 2,5 tháng mà trạng thái
 * vẫn là "đang chạy". Nó là việc chạy TRONG TIẾN TRÌNH, kiểu fire-and-forget, nên một lượt deploy
 * là nó chết giữa chừng — không ai ném lỗi, không ai ghi gì, và vì trạng thái không phải 'idle'
 * hay 'failed' nên nối lại store cũng KHÔNG kích hoạt lại được. Việc chết mà cổng vào vẫn khoá.
 */

/** Không nhúc nhích quá ngần này thì coi như đã chết. Một lượt nạp thật bump nhịp mỗi vài giây. */
export const HAN_NHIP_PHUT = 30;

/**
 * Lượt nạp có đang thật sự sống không.
 *
 * `running` + nhịp mới = sống. `running` + nhịp cũ = xác chết đang giữ chỗ, phải cho phép chạy lại.
 * Thiếu nhịp hoàn toàn thì lấy mốc bắt đầu — lượt vừa khởi động chưa kịp bump nhịp nào.
 */
export function conSong(
  trangThai: string | null | undefined,
  nhipCuoi: Date | null | undefined,
  batDau: Date | null | undefined,
  bayGio: Date = new Date(),
): boolean {
  if (trangThai !== 'running') return false;
  const moc = nhipCuoi ?? batDau;
  if (!moc) return false;
  return bayGio.getTime() - moc.getTime() < HAN_NHIP_PHUT * 60_000;
}

/** Có nên khởi động một lượt nạp mới không: chỉ chặn khi đang có lượt SỐNG hoặc đã xong. */
export function chayLaiDuoc(
  trangThai: string | null | undefined,
  nhipCuoi: Date | null | undefined,
  batDau: Date | null | undefined,
  bayGio: Date = new Date(),
): boolean {
  if (trangThai === 'done') return false;
  return !conSong(trangThai, nhipCuoi, batDau, bayGio);
}
