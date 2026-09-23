import { thangKinhDoanh } from '@/lib/timezone';
import { doiTienTheoThang, type TiGiaThang } from '@/features/cogs/tien';
import { tongChiPhi } from './chi-phi';
import type { DongDon } from './types';

export interface DongBaoCao {
  khoa: string;
  /**
   * Nhãn hiển thị khi khoá gom KHÔNG phải thứ đọc được (ví dụ gom theo id người
   * nhận). Không có thì tầng hiển thị tự suy ra từ `khoa` như cũ.
   */
  nhan?: string;
  theoTienTe: Record<string, number>;
  soMonDaTieu: number;
  soMonDangTreo: number;
  soDongThieuGiaVon: number;
}

/** Gom theo khoá do caller quyết. Generic nên không cần ép kiểu ở chỗ gọi. */
function gom<T extends DongDon>(ds: readonly T[], khoaCua: (d: T) => string): DongBaoCao[] {
  const nhom = new Map<string, T[]>();
  for (const d of ds) {
    const k = khoaCua(d);
    const cu = nhom.get(k);
    if (cu) cu.push(d); else nhom.set(k, [d]);
  }
  return [...nhom.entries()].map(([khoa, dong]) => ({ khoa, ...tongChiPhi(dong) }));
}

/**
 * THUẦN: gom chi phí theo tháng của NGÀY GỬI.
 *
 * Dòng chưa gửi vào khoá 'chua_gui' chứ không bị bỏ im lặng — người đọc báo cáo
 * phải thấy có hàng đang nằm ngoài mọi tháng. Khoá đó KHÔNG phải một tháng nên
 * không tham gia so sánh chuỗi ngày cùng các khoá khác — so bằng
 * `localeCompare` thì 'chua_gui' (bắt đầu bằng 'c') lại lớn hơn mọi 'YYYY-MM'
 * (bắt đầu bằng chữ số), nhảy lên đầu bảng dù không phải tháng mới nhất. Xếp
 * riêng: luôn ở CUỐI, các tháng thật vẫn mới nhất trước như nhau.
 */
export function gomTheoThang(ds: readonly (DongDon & { guiLuc: string | null })[]): DongBaoCao[] {
  return gom(ds, (d) => thangKinhDoanh(d.guiLuc) ?? 'chua_gui')
    .sort((a, b) => {
      if (a.khoa === 'chua_gui') return 1;
      if (b.khoa === 'chua_gui') return -1;
      return b.khoa.localeCompare(a.khoa);
    });
}

/**
 * THUẦN: gom chi phí theo NGƯỜI NHẬN, nhiều tiền nhất lên trước (quy ước: theo VND).
 *
 * Gom theo `nguoiNhanId` chứ KHÔNG theo tên. Tên trên đơn (`tenNhan`) là ảnh
 * chụp lúc tạo đơn — cố ý giữ nguyên để đơn cũ đọc đúng lịch sử — còn sổ KOL
 * không có ràng buộc duy nhất trên tên và cho sửa tên bất cứ lúc nào. Gom theo
 * chuỗi tên thì hỏng hai chiều, cả hai đều IM LẶNG: hai người trùng tên nhập
 * làm một dòng, và một người đổi tên tách thành hai dòng nửa vời.
 *
 * Hiển thị thì ngược lại: lấy tên HIỆN TẠI trong sổ (`tenNhanHienTai`), để
 * người đọc thấy đúng người họ biết hôm nay. Không tra được (hồ sơ đã mất) thì
 * rớt về ảnh chụp trên đơn, không bao giờ phơi id trần ra màn hình.
 */
export function gomTheoNguoiNhan(
  ds: readonly (DongDon & { nguoiNhanId: string; tenNhan: string; tenNhanHienTai?: string | null })[],
): DongBaoCao[] {
  const nhanTheoId = new Map<string, string>();
  for (const d of ds) {
    if (!nhanTheoId.has(d.nguoiNhanId)) {
      nhanTheoId.set(d.nguoiNhanId, d.tenNhanHienTai?.trim() || d.tenNhan);
    }
  }
  return gom(ds, (d) => d.nguoiNhanId)
    .map((r) => ({ ...r, nhan: nhanTheoId.get(r.khoa) ?? r.khoa }))
    .sort((a, b) => (b.theoTienTe.VND ?? 0) - (a.theoTienTe.VND ?? 0));
}

export interface QuyDoi {
  vnd: number;
  /** Loại tiền KHÔNG đổi được vì thiếu tỷ giá tháng đó. Phải hiện lên màn. */
  khongDoiDuoc: string[];
}

/**
 * THUẦN: quy nhiều loại tiền về VND bằng tỷ giá THÁNG sẵn có (D-055 báo cáo VND).
 *
 * Thiếu tỷ giá thì KHÔNG cộng bừa: kê tên loại tiền vào `khongDoiDuoc` để màn
 * nói thẳng, thà thiếu một dòng còn hơn cho ra một tổng sai mà trông như đúng.
 *
 * `doiTienTheoThang` tự nó cho phép RỚT về tháng gần nhất TRƯỚC đó (cờ `tam`)
 * khi thiếu đúng tháng — hữu ích cho COGS nhưng SAI cho báo cáo chi phí KOL:
 * một tỷ giá "tạm" âm thầm trộn vào tổng thì người đọc không còn cách nào biết
 * số đó đáng tin tới đâu. Ở đây đòi ĐÚNG tháng; `tam === true` bị coi như
 * không có tỷ giá, vào thẳng `khongDoiDuoc`.
 */
export function quyVeVnd(theoTienTe: Record<string, number>, period: string, rates: TiGiaThang[]): QuyDoi {
  let vnd = 0;
  const khongDoiDuoc: string[] = [];
  for (const [tienTe, so] of Object.entries(theoTienTe)) {
    if (tienTe === 'VND') { vnd += so; continue; }
    const r = doiTienTheoThang(so, tienTe, 'VND', period, rates);
    if (r == null || r.tam) { khongDoiDuoc.push(tienTe); continue; }
    vnd += r.amount;
  }
  return { vnd, khongDoiDuoc: khongDoiDuoc.sort() };
}
