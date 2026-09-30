/**
 * THUẦN: phân loại mã vận đơn trên hoá đơn carrier thành ba nhóm (CEO 30/09/2026).
 *
 * Vì sao cần: bộ khớp hoá đơn chỉ tra bảng KIỆN CỦA STORE (`shipments`). Đơn SHIP HỘ nằm ở
 * bảng khác (`ship_ho_orders`) nên vô hình với nó — hoá đơn duty của ship hộ vào hệ thống rồi
 * mà màn báo "KHỚP/TỔNG 0/2", đọc y như HỎNG. Đức thấy thế nên nghĩ hệ thống không nhận, và
 * hai tờ duty 1.065.043đ nằm im cho tới khi CEO hỏi tới (30/09).
 *
 * "Không khớp" gộp chung hai chuyện rất khác nhau:
 *   · mã của đơn SHIP HỘ — hệ thống CÓ biết, chỉ là bộ khớp này không tra bảng đó;
 *   · mã hoàn toàn lạ — mới thật sự là thứ cần người đi tìm.
 * Gộp hai thứ đó vào một con số là giấu mất việc cần làm sau một con số trông như lỗi.
 */

export interface PhanLoaiAwb {
  /** Khớp kiện của store — bộ khớp hiện tại lo. */
  khopStore: string[];
  /** Là đơn ship hộ — cần nối qua đường duty/đối soát ship hộ, KHÔNG phải lỗi. */
  laShipHo: string[];
  /** Không tìm thấy ở đâu cả — đây mới là thứ cần người đi tra. */
  khongBiet: string[];
}

/**
 * Phân loại, giữ nguyên thứ tự và KHÔNG khử trùng lặp.
 *
 * Không khử trùng vì một mã xuất hiện hai dòng trên hoá đơn là chuyện thật (cước và duty tách
 * dòng), và con số đếm phải khớp với số DÒNG người dùng nhìn thấy trên màn.
 *
 * Một mã có ở CẢ HAI bảng thì tính là store: bộ khớp store đã xử lý nó, và đếm vào cả hai nhóm
 * là làm tổng vượt quá số dòng thật.
 */
export function phanLoaiAwb(
  awbs: readonly string[],
  coTrongStore: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  coTrongShipHo: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): PhanLoaiAwb {
  const ra: PhanLoaiAwb = { khopStore: [], laShipHo: [], khongBiet: [] };
  for (const a of awbs) {
    if (coTrongStore.has(a)) ra.khopStore.push(a);
    else if (coTrongShipHo.has(a)) ra.laShipHo.push(a);
    else ra.khongBiet.push(a);
  }
  return ra;
}

/**
 * Câu hiện cho người tải hoá đơn.
 *
 * Nói đủ BA nhóm, và nói VIỆC PHẢI LÀM chứ không chỉ con số. Câu cũ chỉ có "0/2" — một phân số
 * trần trụi không nói được nhóm nào cần ai làm gì.
 */
export function moTaPhanLoai(p: PhanLoaiAwb): string {
  const phan: string[] = [];
  const tong = p.khopStore.length + p.laShipHo.length + p.khongBiet.length;
  phan.push(`${p.khopStore.length}/${tong} dòng khớp kiện của store`);
  if (p.laShipHo.length > 0) phan.push(`${p.laShipHo.length} dòng là đơn SHIP HỘ — đã nối sang đối soát ship hộ`);
  if (p.khongBiet.length > 0) phan.push(`${p.khongBiet.length} dòng KHÔNG tìm thấy mã vận đơn, cần tra lại`);
  return phan.join(' · ');
}
