/**
 * THUẦN (không I/O): dựng ảnh chụp tồn kho RESALE để gửi MMP.
 *
 * Hợp đồng: `docs/mmp/resale-ton-kho.md` (MMP gửi 26/10/2026). MMP dùng ảnh chụp này cho
 * nhân sự quyết **đưa hàng lên bán lại và giảm bao nhiêu %**. Nên hai thứ phải đúng, và sai
 * cái nào cũng là sai trên hàng thật:
 *  - **Phạm vi**: chỉ hàng MEAN đã MUA ĐỨT.
 *  - **Ngày nhập của từng lô**: MMP tính tuổi hàng theo lô cũ nhất còn tồn.
 */

/**
 * Loại tồn tính là RESALE — CEO chốt 26/10/2026 sau khi đọc số đo từng loại.
 *
 * `Tồn kho (Consignment)` CỐ Ý KHÔNG có mặt: đó là hàng KÝ GỬI, brand vẫn sở hữu. Đẩy nó
 * sang màn Resale là để nhân sự giảm giá và bán hàng MEAN **chưa mua** — rủi ro với brand,
 * không phải lỗi kỹ thuật. Đo 26/10/2026: 460 chiếc đang nằm kho thuộc loại này.
 *
 * Cũng không có: `Đồ lỗi (k bán)` (không bán được), `CompGift` / `Mượn Vendor*` (không phải
 * hàng của mình), `VTĐG1` / `VTĐG2` (vật tư đóng gói, không phải hàng bán), `Retail` (hàng
 * đi đơn, không phải tồn để bán lại).
 */
export const LOAI_RESALE = new Set<string>([
  'Tồn kho (PO)',
  'Tồn kho (Return)',
  'Tồn kho (Cancel/ Sai địa chỉ)',
  'Tồn kho (MEAN Design)',
  'Tồn kho TQ',
]);

export function laLoaiResale(loai: string | null | undefined): boolean {
  return loai != null && LOAI_RESALE.has(loai);
}

/** Một dòng sổ nhập Lark (`wh_action = 'Lưu kho'`) = một lô. */
export interface LoNhap {
  sku: string;
  kho: string;
  /** `YYYY-MM-DD`. */
  ngayNhapKho: string;
  soLuong: number;
  loaiTon: string;
}

/** Tồn hiện tại của một cặp (sku, kho) — nguồn là `warehouse_inventory`, đồng bộ từ Lark. */
export interface TonHienTai {
  sku: string;
  kho: string;
  qtyOnHand: number;
  qtyReserved: number;
}

/** Một dòng của payload gửi MMP. */
export interface DongResale {
  sku: string;
  kho: string;
  ngayNhapKho: string;
  soLuong: number;
  loaiTon: string;
}

/**
 * Chia tồn hiện tại vào các lô theo **CŨ TRƯỚC**, rồi chỉ giữ lô thuộc loại resale.
 *
 * Vì sao FIFO chạy trên MỌI lô rồi mới lọc, chứ không chỉ chạy trên lô resale: tồn hiện tại
 * của một (sku,kho) là **hỗn hợp mọi loại** — `warehouse_inventory` chỉ giữ `(sku, kho) →
 * số lượng`, không có chiều loại hàng lẫn chiều lô. Nếu FIFO chỉ trên lô resale thì tồn của
 * hàng KÝ GỬI bị gán sai thành resale. Kho thật xuất cũ-trước bất kể loại, nên tiêu thụ theo
 * đúng thứ tự đó rồi giữ lại phần rơi vào lô resale mới là trung thực.
 *
 * `qty_reserved` bị trừ ra: đó là hàng đã HỨA cho đơn chưa đóng, không được mời bán lại.
 *
 * Tồn nhiều hơn tổng lô ghi nhận thì **KHÔNG bịa lô** — chỉ gửi phần truy được. Thà thiếu
 * một dòng còn hơn gửi một `ngayNhapKho` không có căn cứ, vì MMP giảm giá theo ngày đó.
 */
export function phanLoFifo(ton: readonly TonHienTai[], loNhap: readonly LoNhap[]): DongResale[] {
  const theoCap = new Map<string, LoNhap[]>();
  for (const l of loNhap) {
    const k = `${l.sku}\u0000${l.kho}`;
    (theoCap.get(k) ?? theoCap.set(k, []).get(k)!).push(l);
  }

  const ra: DongResale[] = [];
  for (const t of ton) {
    // Phần CÒN BÁN ĐƯỢC, không phải phần đang nằm trong kho.
    let con = t.qtyOnHand - t.qtyReserved;
    if (con <= 0) continue;
    const lo = theoCap.get(`${t.sku}\u0000${t.kho}`);
    if (!lo) continue;

    // Cũ trước. Cùng ngày thì thứ tự không ảnh hưởng kết quả vì được gộp lại ngay dưới.
    const xep = [...lo].sort((a, b) => a.ngayNhapKho.localeCompare(b.ngayNhapKho));
    // Gộp theo (ngày, loại) để một ngày không ra nhiều dòng trùng nhau trong payload.
    const gop = new Map<string, DongResale>();
    for (const l of xep) {
      if (con <= 0) break;
      const lay = Math.min(con, l.soLuong);
      con -= lay;
      if (lay <= 0 || !laLoaiResale(l.loaiTon)) continue;
      const k = `${l.ngayNhapKho}\u0000${l.loaiTon}`;
      const da = gop.get(k);
      if (da) da.soLuong += lay;
      else gop.set(k, { sku: t.sku, kho: t.kho, ngayNhapKho: l.ngayNhapKho, soLuong: lay, loaiTon: l.loaiTon });
    }
    ra.push(...gop.values());
  }
  return ra;
}
