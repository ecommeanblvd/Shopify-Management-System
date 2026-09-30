/**
 * THUẦN: hình dạng ẢNH CHỤP số liệu KPI một kỳ, và luật đọc nó.
 *
 * Vì sao cần chốt (CEO 29/09/2026): bảng KPI trước nay tính lại từ dữ liệu SỐNG mỗi lần mở trang.
 * Hoá đơn carrier về trễ hàng tháng, credit note về sau nữa, nên con số của tháng 8 vẫn còn trôi
 * sau khi HR đã trả lương theo nó. Mở lại tháng 8 vào tháng 11 sẽ ra một con số khác, và không ai
 * chứng minh được lúc trả lương nó là bao nhiêu.
 *
 * Chốt KHÔNG đóng băng dữ liệu gốc — đối soát vẫn chạy tiếp, credit note vẫn về. Nó chỉ ghi lại
 * "tại thời điểm chốt, bảng nói thế này", và từ đó trang hiện ảnh chụp thay vì tính lại.
 */
import type { SoLieuTuDong } from './queries';
import type { BangDiemKpi } from './quy-che';
import type { ThieuChungTu } from './credit-note-thieu';

export interface AnhChupKpi {
  /** Phiên bản hình dạng ảnh chụp — đọc ảnh cũ bằng mã mới thì phải biết nó thuộc đời nào. */
  ban: 1;
  /** Số liệu tự động tại thời điểm chốt. */
  auto: SoLieuTuDong;
  /** Số quản lý nhập tay tại thời điểm chốt; null = kỳ đó chưa ai nhập. */
  nhap: Record<string, unknown> | null;
  /** Điểm Pillar 1 đã tính sẵn — để đọc nhanh mà không cần dựng lại cả bảng. */
  diemP1: number;
  gateDat: boolean;
  /**
   * TOÀN BỘ bảng điểm tại thời điểm chốt (CEO 30/09/2026).
   *
   * Trước nay ảnh chụp chỉ giữ ĐẦU VÀO, còn màn TÍNH LẠI bảng điểm mỗi lần mở. Nghĩa là chốt kỳ
   * đóng băng số liệu nhưng KHÔNG đóng băng CÔNG THỨC: đổi cách chấm một tiêu chí là điểm của
   * mọi kỳ đã chốt tự đổi theo, âm thầm, không ai mở lại kỳ nào cả. Phát hiện đúng lúc đổi cách
   * chấm 1.1 — điểm tháng 8 sẽ tự tụt từ 85 % xuống 70 % mà không ai bấm gì.
   *
   * Ảnh chụp ĐỜI CŨ không có trường này; màn phải tính lại và NÓI RÕ là đang tính lại.
   */
  bangDiem?: BangDiemKpi;
}

/**
 * Ảnh chụp có đọc được không. Dữ liệu trong cột `jsonb` là thứ đã nằm sẵn trong CSDL từ trước,
 * không phải thứ mã hiện tại vừa ghi ra — phải kiểm chứ không được ép kiểu rồi tin.
 */
export function laAnhChupHopLe(v: unknown): v is AnhChupKpi {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.ban === 1 && typeof o.auto === 'object' && o.auto !== null && typeof o.diemP1 === 'number';
}

/**
 * CHUẨN HOÁ ảnh chụp cũ về hình dạng hiện tại (CEO 30/09/2026 — lỗi bắt được khi dựng màn).
 *
 * Ảnh chụp là dữ liệu ĐÓNG BĂNG theo hình dạng của ngày chốt. Mỗi lần thêm một trường vào
 * `SoLieuTuDong`, mọi ảnh chụp cũ THIẾU trường đó — và màn đọc thẳng `auto.truongMoi.x` sẽ VỠ.
 * Lỗi này không test nào bắt được vì test dựng đối tượng đầy đủ; chỉ ảnh chụp thật mới thiếu.
 *
 * Đã suýt làm vỡ trắng màn KPI tháng 8 trên production: `bienCuoc` thêm sau khi kỳ đó đã chốt.
 *
 * Mặc định phải TRUNG TÍNH, không bịa số: tỉ lệ để `null` (bảng vẽ thành "—") chứ không phải 0,
 * vì 0 là một kết luận còn null là "ảnh chụp này không có số đó".
 *
 * THÊM TRƯỜNG MỚI vào `SoLieuTuDong` thì thêm mặc định của nó ở đây.
 */
export function chuanHoaAuto(auto: SoLieuTuDong): SoLieuTuDong {
  const mac: Partial<SoLieuTuDong> = {
    bienCuoc: { tongCuocVnd: 0, amDoLoiNoiBoVnd: 0, tyLeTien: null, tonChuaPhanDinh: 0 },
    chungTuThieu: { soTo: 0, tienVnd: 0, danhSach: [] },
  };
  // Ảnh chụp cũ THIẾU trường nên nó không thật sự là `SoLieuTuDong` cho tới khi lấp xong —
  // đi qua `unknown` là cách nói đúng điều đó, thay vì ép kiểu thẳng và giả vờ nó đã đủ.
  const ra = { ...(auto as unknown as Record<string, unknown>) };
  for (const [k, v] of Object.entries(mac)) if (ra[k] == null) ra[k] = v;
  return ra as unknown as SoLieuTuDong;
}

/** Kỳ dạng YYYY-MM. Chặn ở đây để không ai chốt nhầm một chuỗi bất kỳ thành khoá chính. */
export const laKyHopLe = (ky: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(ky);

/**
 * Thay con số "thiếu chứng từ credit note" trong ảnh chụp bằng số ĐO HIỆN TẠI (CEO 30/09/2026).
 *
 * Lỗi thật: kỳ tháng 8 chốt lúc 11:08 và đóng băng `chungTuThieu = 16 tờ · 74.910.023đ`. Đức tải
 * đủ 16 tờ lên lúc 12:22 — 74 phút SAU đó. Tính lại bây giờ ra 0 tờ · 0đ, nhưng màn đọc ảnh chụp
 * nên vẫn giục đi tìm 16 tờ đã nằm sẵn trong hệ thống. Cảnh báo ấy sẽ không bao giờ tắt được.
 *
 * LUẬT RÚT RA: chốt kỳ đóng băng ĐẦU VÀO ĐIỂM, KHÔNG đóng băng VIỆC CẦN LÀM.
 *   · đầu vào điểm (số đơn âm cước, tỉ lệ biên cước, tiền thu hồi…) phải đứng yên — HR đã trả
 *     lương theo nó, và mở lại là mất bằng chứng lúc trả (xem D-163).
 *   · việc cần làm (còn tờ nào chưa tải lên) tồn tại để GIỤC NGƯỜI LÀM. Làm xong thì phải tắt.
 *     Một lời giục không tắt được thì người đọc học cách bỏ qua nó, và lần sau nó giục thật cũng
 *     không ai nhìn.
 *
 * An toàn cho điểm: `chungTuThieu` KHÔNG có trong `quy-che.ts` — nó chỉ để hiển thị. Đổi nó không
 * làm điểm của kỳ đã chốt nhúc nhích. Ai đưa nó vào công thức chấm thì phải bỏ hàm này đi.
 */
export function vaChungTuThieuSong(auto: SoLieuTuDong, song: ThieuChungTu | null): SoLieuTuDong {
  if (song == null) return auto;
  return { ...auto, chungTuThieu: song };
}
