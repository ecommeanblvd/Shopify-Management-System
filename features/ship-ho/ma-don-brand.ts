/**
 * THUẦN: "Mã đơn gốc (brand)" — mã mà BRAND dùng để gọi đơn này.
 *
 * Một đơn ship hộ mang tới BỐN mã, rất dễ lẫn:
 *   - `code`              mã của SMS            vd `26-INSLG-SV-0151`
 *   - `larkOrderNumber`   Order Number của LOG  vd `26-INSLG-SV-0992`
 *   - `brandReference`    mã của BRAND          vd `#KLS2101`   ← thứ cần hiện
 *   - `customerRef`       mã brand nhập tay / do MMP gửi
 *
 * CEO bắt 05/10/2026: màn chi tiết đọc `customerRef`, mà 29 đơn `source='lark'` có `customerRef`
 * là BẢN SAO của mã Lark, nên nhãn "Mã đơn gốc (brand)" hiện ra mã vận hành của LOG. Bảng kê
 * thì vẫn đúng vì nó đọc `brandReference` — hai màn hình trả lời khác nhau cho cùng một câu hỏi.
 *
 * Nên hàm này là chỗ DUY NHẤT trả lời "mã brand của đơn là gì", và nó lọc mã nội bộ ở đầu ra:
 * dù dữ liệu cũ còn bẩn hay đường ghi nào đó lọt, màn hình cũng không bao giờ gọi mã vận hành
 * là mã của brand.
 */

/** Mã vận hành NỘI BỘ: `INSLG` của LOG/MMP, `INSMS` do SMS tự sinh. Không phải mã brand. */
export function laMaNoiBo(s: string | null | undefined): boolean {
  return typeof s === 'string' && /-INS(LG|MS)-/i.test(s);
}

export interface CoMaBrand {
  brandReference: string | null;
  customerRef: string | null;
}

/**
 * Ưu tiên `brandReference` (lấy thẳng cột "Brand Reference" trên Lark), thiếu thì tới
 * `customerRef` (đơn MMP gửi sang, hoặc người nhập tay). Mã nội bộ bị loại ở cả hai vế.
 *
 * Trả `null` = CHƯA BIẾT mã brand. Người đọc phải thấy ô trống chứ không phải một mã sai —
 * mã sai thì brand đối soát theo nó và không tìm ra đơn nào.
 */
export function maDonBrand(o: CoMaBrand): string | null {
  for (const x of [o.brandReference, o.customerRef]) {
    const s = x?.trim();
    if (s && !laMaNoiBo(s)) return s;
  }
  return null;
}
