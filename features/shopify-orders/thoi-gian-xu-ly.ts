/**
 * THUẦN: rút "thời gian xử lý" và "dự kiến giao" của MỘT dòng hàng.
 *
 * CEO 25/09: email xác nhận đơn hiện "Processing time: 8 - 14 business days" và
 * "Estimated Delivery: 7 October - 22 October" dưới từng sản phẩm. Kho cần con
 * số đó theo từng dòng để còn điền sang Lark.
 *
 * HAI NGUỒN KHÁC HẲN NHAU, đừng lẫn:
 *
 *  - `theme.estimateStartDate` / `theme.estimateEndDate` là metafield của SẢN
 *    PHẨM, mang giá trị HIỆN TẠI. Brand sửa metafield là giá trị đổi theo, nên
 *    với đơn cũ nó KHÔNG chắc là con số khách đã nhìn thấy.
 *  - `Estimated Delivery` là thuộc tính của chính DÒNG ĐƠN, ĐÓNG BĂNG lúc đặt
 *    hàng. Đây mới đúng là thứ khách được hứa.
 *
 * Lưu cả hai: một cái để biết hiện brand đang cam kết bao lâu, một cái để biết
 * đã hứa gì với khách.
 */

export interface DongTho {
  customAttributes?: { key: string; value: string | null }[] | null;
  product?: {
    b?: { value: string | null } | null;
    e?: { value: string | null } | null;
  } | null;
}

export interface ThoiGianXuLy {
  soNgayMin: number | null;
  soNgayMax: number | null;
  duKienGiao: string | null;
}

function soNgay(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  // Số âm hoặc không phải số là metafield gõ sai — bỏ, đừng ghi rác xuống cơ sở
  // dữ liệu rồi hiện "-3 ngày" cho kho đọc.
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
}

export function rutThoiGianXuLy(node: DongTho): ThoiGianXuLy {
  const min = soNgay(node.product?.b?.value);
  const max = soNgay(node.product?.e?.value);
  const attr = (node.customAttributes ?? [])
    .find((a) => a.key.trim().toLowerCase() === 'estimated delivery');
  return {
    // Ghi ngược (min > max) là dữ liệu hỏng — đảo lại chứ không bịa.
    soNgayMin: min != null && max != null ? Math.min(min, max) : min,
    soNgayMax: min != null && max != null ? Math.max(min, max) : max,
    duKienGiao: attr?.value?.trim() || null,
  };
}
