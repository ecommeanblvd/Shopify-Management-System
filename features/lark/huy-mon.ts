/**
 * Món (line item) bị HUỶ trên bảng Lark "WH ngày MEAN nhận hàng".
 *
 * Vì sao cần: đóng gói xong rồi vẫn có thể huỷ — khách bỏ món, vendor hết hàng, OC cancel.
 * Kiện mà mọi món đều huỷ thì KHÔNG đi hàng nữa, dù đã cân đo đóng gói (CEO 22/09/2026,
 * ví dụ #MBLVD29309). Nhưng một đơn nhiều món có thể chỉ huỷ một món, phần còn lại vẫn đi
 * bình thường — nên phải xét TỪNG MÓN, không được thấy một dòng huỷ là kết luận cả đơn.
 *
 * Hai cột mang nghĩa huỷ (đo 22/09/2026 trên 7.712 dòng):
 *   "WH-Điều phối đơn"        = "Cancel packing"                (425 dòng)
 *   "PROCU - Final Order Stt" = "Cancel - SOLD OUT by Vendor"…  (409 dòng)
 */
import { larkText } from './parse-pack-row';

export interface MonLark {
  /** "Định danh" của Lark — khoá ổn định: '#MBLVD29309-Larmes-LAR1612-L-RED-PDL-21184'. */
  dinhDanh: string;
  /** Record id của món trên bảng Lark — để nối link "Import (select order)" khi tạo dòng kho. */
  recordId: string;
  orderNumber: string;
  sku: string | null;
  lineitemName: string | null;
  store: string | null;
  vendor: string | null;
  huy: boolean;
  /** Giá trị cột đã làm nên quyết định huỷ, để người đọc biết vì sao. */
  lyDo: string | null;
}

/** THUẦN: một giá trị cột có mang nghĩa huỷ không. */
export function laGiaTriHuy(v: string | null | undefined): boolean {
  return /cancel/i.test(v ?? '');
}

/** THUẦN: 1 record bảng brand-received → món, kèm cờ huỷ. Thiếu định danh/đơn → null. */
export function docMonLark(fields: Record<string, unknown>, recordId: string): MonLark | null {
  const dinhDanh = larkText(fields['Định danh']);
  const orderNumber = larkText(fields['order_number'])?.replace(/^#/, '') ?? null;
  if (!dinhDanh || !orderNumber) return null;
  const dieuPhoi = larkText(fields['WH-Điều phối đơn']);
  const procu = larkText(fields['PROCU - Final Order Stt']);
  const lyDo = laGiaTriHuy(dieuPhoi) ? dieuPhoi : laGiaTriHuy(procu) ? procu : null;
  return {
    dinhDanh, recordId, orderNumber,
    sku: larkText(fields['Lineitem SKU']),
    lineitemName: larkText(fields['Lineitem name']),
    store: larkText(fields['Store']),
    vendor: larkText(fields['vendor']),
    huy: lyDo != null, lyDo,
  };
}

export type LoaiHuyKien = 'khong' | 'mot_phan' | 'toan_bo';

export interface TinhTrangHuy {
  loai: LoaiHuyKien;
  /** Số món của ĐƠN đã huỷ / tổng số món của đơn. */
  soHuy: number;
  tong: number;
  lyDo: string | null;
}

/**
 * THUẦN: kiện này còn phải đi hàng không.
 *
 * Kiện ghi rõ SKU nào thì xét ĐÚNG những SKU đó: mọi SKU trong kiện đều huỷ → cả kiện bỏ.
 * Kiện không ghi SKU thì đành xét theo đơn: chỉ khi CẢ ĐƠN huỷ mới dám kết luận kiện bỏ,
 * còn lại chỉ cảnh báo — thà để Đức kiểm tay còn hơn chặn nhầm một kiện vẫn phải đi.
 */
export function tinhTrangHuyKien(skuText: string | null, monCuaDon: readonly MonLark[]): TinhTrangHuy {
  const tong = monCuaDon.length;
  const daHuy = monCuaDon.filter((m) => m.huy);
  const soHuy = daHuy.length;
  const lyDo = daHuy[0]?.lyDo ?? null;
  if (tong === 0 || soHuy === 0) return { loai: 'khong', soHuy, tong, lyDo: null };
  if (soHuy === tong) return { loai: 'toan_bo', soHuy, tong, lyDo };

  const skuKien = (skuText ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (skuKien.length === 0) return { loai: 'mot_phan', soHuy, tong, lyDo };

  const skuHuy = new Set(daHuy.map((m) => m.sku).filter((s): s is string => !!s));
  const conDi = skuKien.filter((s) => !skuHuy.has(s));
  if (conDi.length === 0) return { loai: 'toan_bo', soHuy, tong, lyDo };
  return { loai: skuKien.length === conDi.length ? 'khong' : 'mot_phan', soHuy, tong, lyDo };
}
