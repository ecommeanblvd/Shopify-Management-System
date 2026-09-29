/**
 * THUẦN: đọc số đo của đơn MAY ĐO từ thuộc tính dòng hàng Shopify (CEO 28/09/2026).
 *
 * Khách đặt hàng may đo nhập số đo trên storefront; Shopify lưu chúng ở
 * `lineItem.customAttributes`. KCS cần thấy đúng những số đó lúc kiểm hàng, nếu
 * không thì không có gì để đối chiếu với thân áo đang cầm.
 *
 * Khoá thật Shopify trả về (đo từ đơn #MBLVD có "Rosaline Off-Shoulder"):
 *   "_Customize Type"        → loại rập, khoá bắt đầu bằng "_" là khoá ẨN của hệ thống
 *   "1--1.Bust*"             → nhóm 1, thứ tự 1, tên "Bust", dấu * = bắt buộc
 *   "7--13.1.Dress Length - Measure from the collar stand"
 *   "Estimated Delivery"     → không phải số đo
 *
 * Shopify trả theo thứ tự khách nhập chứ KHÔNG theo thứ tự đo, nên phải xếp lại
 * theo số thứ tự trong khoá — nhìn ảnh chụp đơn thật thì "3--6.Arm Hole" đang
 * nằm sau "6--11.Your Weight", đọc rất khó.
 */

export interface ThuocTinhTho { key?: string | null; value?: string | null }

export interface SoDo {
  /** Số thứ tự để xếp (13.1 → 13.1). */
  thuTu: number;
  /** Nhóm đo trên rập (1 = thân trên, 6 = cơ thể…). Giữ để gom nhóm sau này. */
  nhom: number;
  ten: string;
  /** Bắt buộc khách phải nhập (khoá có dấu *). */
  batBuoc: boolean;
  /** NULL = khách bỏ trống. Phải HIỆN ra là trống, không được ẩn đi (D-124). */
  giaTri: string | null;
}

export interface SoDoMayDo {
  /** Loại rập, vd "Collar Dresses". NULL = đơn không khai loại. */
  loai: string | null;
  soDo: SoDo[];
  /** Ngày giao dự kiến khách thấy lúc đặt — KCS cần biết còn bao nhiêu thời gian. */
  giaoDuKien: string | null;
  /** Còn bao nhiêu số đo khách bỏ trống. */
  soTrong: number;
}

const KHOA_SO_DO = /^(\d+)--(\d+(?:\.\d+)?)\.(.+)$/;

const sach = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

/** THUẦN: thuộc tính dòng hàng → số đo đã xếp thứ tự. */
export function docSoDoMayDo(ds: readonly ThuocTinhTho[] | null | undefined): SoDoMayDo {
  const soDo: SoDo[] = [];
  let loai: string | null = null;
  let giaoDuKien: string | null = null;

  for (const t of ds ?? []) {
    const khoa = (t.key ?? '').trim();
    if (!khoa) continue;
    // Khoá ẩn: bỏ "_" đứng đầu rồi mới so tên.
    const tran = khoa.replace(/^_+/, '');
    if (/^customize type$/i.test(tran)) { loai = sach(t.value); continue; }
    if (/^estimated delivery$/i.test(tran)) { giaoDuKien = sach(t.value); continue; }

    const m = KHOA_SO_DO.exec(tran);
    if (!m) continue;
    const ten = m[3]!.trim();
    soDo.push({
      nhom: Number(m[1]),
      thuTu: Number(m[2]),
      ten: ten.replace(/\*+$/, '').trim(),
      batBuoc: ten.endsWith('*'),
      giaTri: sach(t.value),
    });
  }
  soDo.sort((a, b) => a.thuTu - b.thuTu);
  return { loai, soDo, giaoDuKien, soTrong: soDo.filter((s) => s.giaTri == null).length };
}

/** THUẦN: dòng này có phải hàng may đo không — cứ có MỘT số đo là có. */
export function laMayDo(s: SoDoMayDo): boolean {
  return s.soDo.length > 0;
}
