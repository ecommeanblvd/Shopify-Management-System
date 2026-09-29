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

/** Kỳ dạng YYYY-MM. Chặn ở đây để không ai chốt nhầm một chuỗi bất kỳ thành khoá chính. */
export const laKyHopLe = (ky: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(ky);
