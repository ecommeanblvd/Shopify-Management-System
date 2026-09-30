/**
 * THUẦN: bóc MÃ VẬN ĐƠN khỏi nội dung một chứng từ điều chỉnh (giấy báo có /
 * hoá đơn sửa) của hãng vận chuyển.
 *
 * Vì sao cần: `credit_note_lines` đang RỖNG (0 dòng, đo 28/09/2026) nên không có
 * gì nối chứng từ điều chỉnh với kiện. Mã vận đơn chỉ nằm trong ô văn bản tự do
 * `noi_dung`. Hệ quả: KPI 1.4 vẫn chấm kho "sai thùng" cho kiện mà CHÍNH hãng đã
 * xuất chứng từ trả lại tiền — ví dụ `#MBLVD29877` (FedEx ghi 9,4 kg cho kiện
 * 0,9 kg, rồi trả lại 4.002.767đ bằng `1K26TFA/45602`).
 *
 * Hai dạng nội dung thật đang có trong hệ thống:
 *   FedEx: "876291039886 VN SA"            → mã vận đơn nằm ngay đầu
 *   DHL  : "…Số tài khoản: 527888723. Số tham chiếu DHL (27/08/2026): HANR000284295…"
 *          → KHÔNG có mã vận đơn, chỉ có số tài khoản và mã tham chiếu HANR…
 */

/** Mã vận đơn của FedEx/DHL/Aramex đang dùng dài 10–14 chữ số. */
const DAI_MIN = 10;
const DAI_MAX = 14;

/**
 * Mọi dãy số dài 10–14 chữ số đứng TÁCH BIỆT trong chuỗi.
 *
 * Chặn số tài khoản DHL `527888723` (9 chữ số) bằng độ dài tối thiểu, và chặn
 * ngày `27/08/2026` vì các cụm số của nó đều ngắn. Dùng biên "không kề chữ số"
 * để không cắt bừa giữa một dãy dài hơn 14 — dãy 15 số là thứ khác, bỏ qua còn
 * hơn bóc nhầm rồi gỡ oan sai cho kho.
 */
export function maVanDonTrongChungTu(noiDung: string | null | undefined): string[] {
  if (!noiDung) return [];
  const ra = new Set<string>();
  for (const m of noiDung.matchAll(/\d+/g)) {
    const so = m[0];
    if (so.length >= DAI_MIN && so.length <= DAI_MAX) ra.add(so);
  }
  return [...ra];
}

/** Một kiện nối được với chứng từ điều chỉnh. */
export interface KienNoiDuoc { tracking: string; maDon: string | null; nguon: 'shopify' | 'ship_ho' }

export interface NoiChungTu {
  /** Kiện tìm thấy trong hệ thống. */
  kien: KienNoiDuoc[];
  /** Mã bóc được từ nội dung nhưng KHÔNG có kiện nào mang mã đó. */
  maLa: string[];
  /** Vì sao chứng từ này không nối được kiện nào — để người đọc khỏi tưởng hệ thống hỏng. */
  vuongMac: string | null;
}

/**
 * Nối một chứng từ điều chỉnh với các kiện của nó (CEO 30/09/2026).
 *
 * Cột "Kiện liên quan" trước nay đếm `credit_note_lines` — bảng RỖNG HOÀN TOÀN, nên nó hiện "—"
 * cho mọi dòng và sẽ hiện "—" mãi mãi. Một cột không bao giờ có giá trị thì không phải là cột,
 * nó là chỗ trống có tiêu đề.
 *
 * Đo 13 chứng từ đang có (30/09/2026): 3 tờ FedEx bóc được mã vận đơn từ `noi_dung`, 2 trong số
 * đó khớp kiện thật; 10 tờ DHL KHÔNG hề ghi mã vận đơn — chúng chỉ ghi số tài khoản, mã tham
 * chiếu HANR và số hoá đơn gốc được điều chỉnh.
 *
 * Vì vậy hàm này trả về cả LÝ DO không nối được: "không nối được" vì hãng không ghi mã khác hẳn
 * với "không nối được" vì hệ thống chưa làm.
 */
export function noiChungTuVoiKien(
  noiDung: string | null | undefined,
  maThamChieu: readonly string[] | null | undefined,
  timKien: (ma: string) => KienNoiDuoc | null,
): NoiChungTu {
  const ma = maVanDonTrongChungTu(noiDung);
  const kien: KienNoiDuoc[] = [];
  const maLa: string[] = [];
  for (const m of ma) {
    const k = timKien(m);
    if (k) kien.push(k); else maLa.push(m);
  }
  if (kien.length > 0) return { kien, maLa, vuongMac: null };
  const soThamChieu = maThamChieu?.length ?? 0;
  return {
    kien, maLa,
    vuongMac: ma.length > 0
      ? 'Có mã vận đơn nhưng không kiện nào trong hệ thống mang mã đó'
      : soThamChieu > 0
        ? 'Chứng từ chỉ ghi mã tham chiếu của hãng, không ghi mã vận đơn'
        : 'Nội dung chứng từ không có mã vận đơn nào',
  };
}
