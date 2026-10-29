/**
 * THUẦN: gộp các ĐƠN dùng chung MỘT KIỆN về cùng một đơn vị tính lãi/lỗ.
 *
 * Vì sao cần (đo 29/10/2026): `shipments.cac_don_trong_kien` cho biết một kiện chở nhiều đơn,
 * nhưng kiện chỉ gắn `order_id` vào **một** đơn. Nên đơn đi ghép không có kiện nào của riêng nó
 * và **biến mất** khỏi đối soát, còn đơn chủ gánh nguyên cước của cả hai. Trong kỳ T7..T10 có 7
 * kiện chở 2 đơn: **12.036.440 đ tiền thu bị bỏ ngoài**, và `#MBLVD30149` bị ghi **lỗ
 * −198.780 đ** dù cặp của nó thật ra **lãi +1.315.460 đ**.
 *
 * Gộp xong thì thu là tổng thu của các đơn thành viên, và cước của kiện chỉ tính MỘT lần.
 *
 * Tìm–hợp (union–find) chứ không phải "ghép từng cặp": một kiện có thể chở 3 đơn, và hai kiện
 * khác nhau có thể chung một đơn — ghép từng cặp sẽ để lại hai nhóm rời cho cùng một chùm.
 */

/**
 * Trả MỖI mã đơn → mã ĐẠI DIỆN của chùm nó thuộc về. Mã không xuất hiện trong `canh` nào thì
 * không có trong kết quả (caller tự coi nó là chùm một phần tử).
 *
 * Đại diện là mã **nhỏ nhất** theo thứ tự chuỗi, không phải "mã gặp trước": gặp trước phụ thuộc
 * thứ tự dòng SQL trả về, nên cùng một dữ liệu có thể ra hai kết quả khác nhau giữa hai lượt
 * chạy — thứ không bao giờ được xảy ra với một con số tiền.
 */
export function gopDonChungKien(
  canh: ReadonlyArray<readonly [string, string]>,
): Map<string, string> {
  const cha = new Map<string, string>();
  const tim = (x: string): string => {
    const c = cha.get(x);
    if (c == null || c === x) { cha.set(x, x); return x; }
    const g = tim(c);
    cha.set(x, g); // nén đường, để chùm dài không phải đi lại từ đầu mỗi lần hỏi
    return g;
  };
  for (const [a, b] of canh) {
    const ga = tim(a), gb = tim(b);
    /* Giữ mã NHỎ HƠN làm đại diện ⇒ kết quả không phụ thuộc thứ tự cạnh đưa vào. Cạnh tự trỏ
     * chính nó (ga === gb) tự rơi vào nhánh dưới thành `cha.set(ga, ga)` — không cần chặn
     * riêng; đã thử bỏ một guard `if (ga === gb) continue` và 8/8 test vẫn xanh, nên nó là mã
     * chết chứ không phải lưới. */
    if (ga < gb) cha.set(gb, ga);
    else cha.set(ga, gb);
  }
  const ra = new Map<string, string>();
  for (const x of cha.keys()) ra.set(x, tim(x));
  return ra;
}
