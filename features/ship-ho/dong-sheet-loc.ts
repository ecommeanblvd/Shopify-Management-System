/**
 * THUẦN: dòng nào KHÔNG ghi lên bảng đối soát brand đọc.
 *
 * Bảng kê trong hệ thống là sổ kế toán — giữ đủ mọi đơn, kể cả đơn không thu. Google Sheet thì
 * là thứ brand đọc để đối soát: một dòng ghi "Tổng thu 0đ" chỉ làm brand hỏi "sao có dòng này",
 * và người trả lời phải kể lại chuyện nội bộ.
 *
 * Ca thật (CEO 08/10/2026): đơn `#KLS2053` gửi hai lần — lần đầu LOG gửi sai địa chỉ nên MEAN
 * chịu, lần hai gửi lại mới thu. Lần đầu để ở 0đ trong bảng kê (chứng từ vẫn đủ dấu vết, và
 * bản điều chỉnh gửi MMP dựa vào đó), nhưng KHÔNG hiện trên sheet.
 *
 * Cùng tinh thần với luật sẵn có ở `dungDonSheet`: đơn thiếu breakdown thì BỎ DÒNG chứ không
 * ghi một hàng toàn số 0 — thiếu dòng thì thấy ngay, hàng 0 thì không.
 *
 * CHỈ áp cho bảng CƯỚC. Bảng thuế không có khái niệm miễn thu: đơn không có thuế thì vốn đã
 * không nằm trong bảng đó.
 */
export function ghiLenSheet(d: { tongThu: number }): boolean {
  return Math.round(d.tongThu) !== 0;
}
