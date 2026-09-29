/**
 * THUẦN: đối chiếu SỐ credit note ghi trên dòng đối soát với chứng từ đã có trong `credit_notes`.
 *
 * Vì sao cần (CEO 29/09/2026): luật tiền 3C là **credit note xuất tháng nào thì tính tháng đó**.
 * Luật đúng, nhưng nó chỉ tính được những tờ đã có mặt trong hệ thống. Đo ngày 29/09: đội đã đòi
 * về **74.910.023đ trên 26 dòng đối soát, thuộc 16 số credit note FedEx** (K25TFA/K26TFA) — và
 * KHÔNG MỘT TỜ NÀO trong 16 tờ đó được tải lên. Bảng `credit_notes` chỉ có 12 tờ: 10 của DHL và
 * 2 của FedEx tháng 9, không tờ nào trùng.
 *
 * Nên 74,9 triệu tiền thật đã đòi được đang không được tính cho THÁNG NÀO CẢ. Không phải công
 * thức sai — là thiếu chứng từ. Việc của tệp này là làm chỗ thiếu ấy hiện ra thành con số, thay
 * vì để nó im lặng như trước.
 */

/** Một số credit note dạng "K26TFA-35641" tách thành ký hiệu + số hoá đơn. */
export interface SoCreditNote { kyHieu: string; so: string }

/**
 * Tách số credit note do người đối soát gõ tay.
 *
 * Chấp nhận cả gạch ngang, gạch chéo và khoảng trắng vì ba dạng đó đều có trong dữ liệu thật.
 * Không tách được thì trả null — gõ sai định dạng vẫn phải coi là CHƯA KHỚP, không được lặng lẽ
 * bỏ qua rồi báo "đủ chứng từ".
 */
export function tachSoCreditNote(v: string | null | undefined): SoCreditNote | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const m = /^([A-Za-z0-9]+)\s*[-/\s]\s*(\d+)$/.exec(s);
  if (!m) return null;
  return { kyHieu: m[1].toUpperCase(), so: m[2] };
}

/**
 * Ký hiệu trên chứng từ có thêm tiền tố mẫu số ("1K26TFA") so với cách người đối soát gõ
 * ("K26TFA"). So bằng "kết thúc bằng" theo cả hai chiều để không báo thiếu oan.
 */
export function khopKyHieu(a: string, b: string): boolean {
  const x = a.trim().toUpperCase(), y = b.trim().toUpperCase();
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

export interface DongDaDoi { soCreditNote: string | null; thuHoiVnd: number }
export interface ChungTuCo { kyHieu: string; so: string }

export interface ThieuChungTu {
  /** Số tờ credit note được nhắc trên dòng đối soát mà chưa có chứng từ trong hệ thống. */
  soTo: number;
  /** Tiền đã đòi được thuộc các tờ đó — hiện chưa được tính vào 3C của tháng nào. */
  tienVnd: number;
  /** Danh sách số tờ, để người đi tìm chứng từ biết phải tải những tờ nào. */
  danhSach: string[];
}

/**
 * Những tờ credit note đã đòi được nhưng CHƯA có chứng từ trong hệ thống.
 *
 * Gom theo SỐ TỜ chứ không theo dòng: một tờ credit note thường phủ nhiều kiện (đo thật: tờ
 * K26TFA-35641 phủ 6 dòng), nên đếm theo dòng sẽ thổi phồng số chứng từ cần đi tìm.
 */
export function thieuChungTu(dong: readonly DongDaDoi[], daCo: readonly ChungTuCo[]): ThieuChungTu {
  const theoTo = new Map<string, number>();
  for (const d of dong) {
    if (d.thuHoiVnd <= 0) continue;
    const s = (d.soCreditNote ?? '').trim();
    // Đòi được tiền mà không ghi số tờ thì cũng là thiếu chứng từ, gom vào một dòng riêng.
    const khoa = s || '(chưa ghi số)';
    const tach = tachSoCreditNote(s);
    const co = tach != null && daCo.some((c) => c.so === tach.so && khopKyHieu(c.kyHieu, tach.kyHieu));
    if (co) continue;
    theoTo.set(khoa, (theoTo.get(khoa) ?? 0) + d.thuHoiVnd);
  }
  const danhSach = [...theoTo.keys()].sort();
  return {
    soTo: danhSach.length,
    tienVnd: Math.round([...theoTo.values()].reduce((s, v) => s + v, 0)),
    danhSach,
  };
}
