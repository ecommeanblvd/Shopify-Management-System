/**
 * THUẦN: nhận ra một lượt nạp lịch sử đã CHẾT, và chọn khoảng cần nạp lại (CEO 30/09/2026).
 *
 * Lượt nạp của MEAN BLVD kẹt ở `running` từ 15/07/2026, dừng nhúc nhích 2,5 tháng mà trạng thái
 * vẫn là "đang chạy". Nó là việc chạy TRONG TIẾN TRÌNH, kiểu fire-and-forget, nên một lượt deploy
 * là nó chết giữa chừng — không ai ném lỗi, không ai ghi gì, và vì trạng thái không phải 'idle'
 * hay 'failed' nên nối lại store cũng KHÔNG kích hoạt lại được. Việc chết mà cổng vào vẫn khoá.
 */

/**
 * Không nhúc nhích quá ngần này thì coi như đã chết.
 *
 * Con số này chỉ đúng khi lượt nạp đập nhịp DÀY HƠN HẲN nó. Đo lượt thật của MEAN BLVD
 * (30/09/2026): nhịp vốn chỉ đập MỘT LẦN mỗi batch ~100 đơn, và ở ~21 đơn/phút thì một batch
 * mất ~5 phút — dư có 6 lần. Một store chậm hơn 6 lần sẽ bị kết luận OAN là xác chết, rồi
 * `chayLaiDuoc` cho chạy lượt thứ hai song song. Nên nhịp đã chuyển sang đập theo THỜI GIAN
 * (`NHIP_DAP_GIAY`), và test canh tỉ lệ giữa hai con số này.
 */
export const HAN_NHIP_PHUT = 30;

/**
 * Cách nhau bao nhiêu giây thì đập nhịp một lần, tính TRONG lúc ghi từng đơn.
 *
 * Phải theo thời gian chứ không theo batch: batch là đơn vị của nguồn dữ liệu, không nói gì về
 * việc ghi mất bao lâu. Một batch to hoặc một CSDL chậm là nhịp thưa ra, mà `conSong` thì đọc
 * nhịp để phán sống/chết — nên đơn vị của hai bên phải là cùng một thứ: thời gian.
 *
 * Trần trên của phí: một lượt ghi CSDL mỗi 30 giây. Không đáng kể so với hàng nghìn lượt upsert.
 */
export const NHIP_DAP_GIAY = 30;

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

/**
 * Đã tới lúc đập nhịp chưa.
 *
 * Tách ra thành hàm thuần để test được cái RÀNG BUỘC giữa hai hạn (nhịp phải dày hơn hạn chết
 * ít nhất 10 lần) — thứ mà đọc mã vòng lặp thì không thấy, và sửa một trong hai con số thì im
 * lặng làm hỏng con số kia.
 */
export function denLucDapNhip(lanCuoiMs: number, bayGioMs: number = Date.now()): boolean {
  return bayGioMs - lanCuoiMs >= NHIP_DAP_GIAY * 1000;
}
