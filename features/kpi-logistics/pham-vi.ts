/**
 * PHẠM VI chấm Pillar 1 của vị trí Logistics Operations Specialist.
 *
 * Không phải tiêu chí nào cũng cùng phạm vi, vì bốn tiêu chí đo bốn thứ khác nhau:
 *
 *   1.1 Bảo toàn biên cước — CHỈ MEAN BLVD. Tiêu chí này so cước carrier bill với cước KHÁCH
 *       trả ở checkout. Đơn brand khác không có checkout của mình: brand trả theo bảng giá đã
 *       deal, nên "âm cước" ở đó là chuyện giá bán chứ không phải vận hành, và đã theo dõi ở
 *       margin trong P&L ship hộ.
 *   1.4 Size thùng — CHỈ MEAN BLVD. Kiện TA/Mirer mình kiểm hàng và đo cân, đo kích thước,
 *       nhưng THÙNG là của brand nên không chấm người của mình về lựa chọn thùng đó
 *       (CEO 12/09/2026).
 *   1.2 SLA giao hàng và 1.3 Đơn giao hoàn hảo — MỌI KIỆN MÌNH CHẠY, gồm cả ship hộ
 *       (CEO 12/09/2026: "phải quản lí cả việc ship hộ mà"). Hai tiêu chí này đo chất lượng
 *       THỰC THI — giao đúng hạn và nhập đúng địa chỉ người nhận — việc đó là của nhân sự
 *       logistics bất kể kiện thuộc store nào. Gộp vào đây mới quy được đơn lỗi/đơn chậm của
 *       ship hộ ra để trừ liên tiêu chí. THAY THẾ D-072 ở phần 1.2 và 1.3.
 *
 * Kiện ship hộ nằm ở HAI nơi và phải cộng cả hai, không được lấy một nơi:
 *   - store brand retail trong Shopify (`tinhatelier`, `mirermirer-official`) → bảng `shipments`;
 *   - đơn Đức lên trên Lark → bảng `ship_ho_orders`.
 * Đã kiểm 12/09/2026: 132 kiện Lark có mã vận đơn, 0 kiện trùng tracking với `shipments`, nên
 * cộng thẳng hai nguồn không đếm đôi. Ai sửa sau này mà thấy số kiện nhảy vọt thì kiểm trùng
 * tracking trước khi nghi công thức.
 */
export const STORE_VAN_HANH = 'meanblvd.myshopify.com';

/** Tiêu chí chấm trên phạm vi nào. `mean` = chỉ store vận hành; `tat_ca` = mọi kiện kể cả ship hộ. */
export const PHAM_VI_TIEU_CHI = { '1.1': 'mean', '1.2': 'tat_ca', '1.3': 'tat_ca', '1.4': 'mean' } as const;

/** Store áp cho một tiêu chí: null = không lọc store (dùng cho 1.2 và 1.3). */
export function storeCuaTieuChi(ma: keyof typeof PHAM_VI_TIEU_CHI): string | null {
  return PHAM_VI_TIEU_CHI[ma] === 'mean' ? STORE_VAN_HANH : null;
}

const NHAN_STORE: Record<string, string> = {
  'meanblvd.myshopify.com': 'MEAN BLVD',
  'tinhatelier.myshopify.com': 'Tinh Atelier',
  'mirermirer-official.myshopify.com': 'Mirer',
  'cici-mean.myshopify.com': 'CiCi',
};

/** Nhãn "kiện này của ai" trên bảng chi tiết — để nhìn ra ngay nhóm nào đang kéo điểm. */
export function nhanThuocVe(storeDomain: string | null | undefined): string {
  if (!storeDomain) return '—';
  return NHAN_STORE[storeDomain] ?? storeDomain.replace(/\.myshopify\.com$/, '');
}

/** Nhãn cho kiện ship hộ lên từ Lark. */
export function nhanShipHo(brandSlug: string | null | undefined): string {
  return `Ship hộ · ${brandSlug ?? '?'}`;
}
