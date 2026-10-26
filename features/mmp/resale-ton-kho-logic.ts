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

/** Tỷ lệ tụt dòng tối đa so với lần gửi thành công trước, trước khi từ chối gửi. */
export const TRAN_TUT_TY_LE = 0.5;

/**
 * THUẦN: hôm nay (giờ NGHIỆP VỤ) đã gửi thành công chưa?
 *
 * Job gửi nằm trong cron chạy MỖI GIỜ (`sync Lark operation`, `15 * * * *`) vì ảnh chụp phải
 * dựng từ tồn VỪA được đồng bộ trong cùng tiến trình — đặt nó ở một service daily riêng thì
 * không có gì bảo đảm thứ tự đó. Nên cadence "mỗi ngày" do chốt này quyết, không do lịch cron.
 *
 * Kiểm "đã gửi THÀNH CÔNG" chứ không phải "đã chạy": lượt lỗi mạng sẽ được giờ sau thử lại và
 * tự khỏi, không cần ai bấm. Hợp đồng cho phép — mỗi lượt mang `snapshotId` mới, và MMP áp
 * ảnh mới nhất.
 *
 * Ngày theo giờ nghiệp vụ (`Asia/Bangkok`): "mỗi ngày" là ngày làm việc của kho. Dùng mốc UTC
 * sẽ gửi hai lần trong một ngày làm việc ở khoảng 00:00–07:00 giờ VN.
 */
export function nenGuiHomNay(lanCuoiThanhCong: Date | null, bayGio: Date): boolean {
  if (!lanCuoiThanhCong) return true;
  const ngay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return ngay(lanCuoiThanhCong) !== ngay(bayGio);
}

/**
 * THUẦN: lý do KHÔNG gửi ảnh chụp, hoặc `null` nếu an toàn.
 *
 * Vì sao cần, và vì sao nó khác mọi cổng khác trong repo: ảnh chụp mới **THAY HẲN** ảnh
 * trước — biến thể không có trong ảnh được MMP hiểu là **tồn 0**. Nên một lượt đọc hụt (Lark
 * lỗi giữa chừng, view bị sửa bộ lọc, một brand tạm biến mất khỏi sổ nhập) không chỉ sai một
 * dòng: nó **xoá cả danh sách resale bên đối tác**, và nhân sự MMP thấy hàng biến mất khỏi
 * màn Resale mà không biết vì sao. Cùng họ với `lyDoTuChoiGhi` của tồn kho — và cùng lý do:
 * "không đọc được" trông y hệt "không còn hàng".
 */
export function lyDoKhongGui(soDong: number, soDongLanTruoc: number | null): string | null {
  if (soDong === 0) {
    return 'Ảnh chụp 0 dòng — nghi lỗi đọc sổ nhập/tồn. KHÔNG gửi, vì ảnh rỗng sẽ xoá sạch danh sách resale bên MMP.';
  }
  if (soDongLanTruoc != null && soDongLanTruoc > 0 && soDong < soDongLanTruoc * (1 - TRAN_TUT_TY_LE)) {
    return `Ảnh chụp ${soDong} dòng, tụt quá nửa so với lần gửi trước (${soDongLanTruoc}) — KHÔNG gửi.`
      + ' Chạy script đối soát xem vì sao rồi gửi tay nếu đúng là tồn giảm thật.';
  }
  return null;
}
