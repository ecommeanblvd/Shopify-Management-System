import { describe, it, expect } from 'vitest';
import { khopOBangGia, type OBangGia, canTinhCuocTuO } from './bill-base-check';

const cells: OBangGia[] = [
  { kg: 1.5, loaiGoi: 'pak', vnd: 668_580 },
  { kg: 1.5, loaiGoi: 'package', vnd: 744_049 },
  { kg: 2, loaiGoi: 'package', vnd: 863_313 },
  { kg: 3.5, loaiGoi: 'package', vnd: 1_213_978 },
  { kg: 4, loaiGoi: 'package', vnd: 1_332_863 },
];

describe('khopOBangGia — cước net FedEx trên bill phải bằng đúng một ô bảng giá cố định', () => {
  it('SV-0010: net 744.049 = ô package 1,5 kg → khớp', () => {
    expect(khopOBangGia(744_049, cells)).toEqual({ khop: true, o: { kg: 1.5, loaiGoi: 'package', vnd: 744_049 } });
  });
  it('lệch làm tròn ≤ 1đ vẫn khớp', () => {
    expect(khopOBangGia(744_049.6, cells).khop).toBe(true);
  });
  it('SV-0075: net 1.324.381 không bằng ô nào → lệch, kèm ô gần nhất + số lệch', () => {
    expect(khopOBangGia(1_324_381, cells)).toEqual({ khop: false, ganNhat: { kg: 4, loaiGoi: 'package', vnd: 1_332_863 }, lechVnd: -8_482 });
  });
  it('không có ô nào (thiếu bảng giá cho nước) → lệch, không có ô gần nhất', () => {
    expect(khopOBangGia(500_000, [])).toEqual({ khop: false, ganNhat: null, lechVnd: null });
  });
  it('net ≤ 0 (bill thiếu cột base) → không kết luận: coi là khớp để không báo nhiễu', () => {
    expect(khopOBangGia(0, cells).khop).toBe(true);
  });

  /**
   * Đo 30/09/2026 trên 42 đơn kalisa của 2 kỳ đã phát hành: cân TRÊN BILL so với mốc cân của
   * ô biểu giá mà chính hoá đơn trùng — bằng nhau 8, thấp hơn 34, cao hơn 0. Tức cột cân trên
   * bill là cân FedEx CÂN ĐƯỢC, còn mốc cân đã tính tiền thì không in ra, phải suy từ ô.
   */
  describe('canTinhCuocTuO — cân ĐÃ TÍNH TIỀN suy từ ô biểu giá', () => {
    it('trùng một ô → lấy mốc cân của ô đó, KHÔNG lấy số rơi về', () => {
      expect(canTinhCuocTuO(khopOBangGia(1_213_978, cells), 4)).toBe(3.5);
    });
    it('cân bill thấp hơn mốc ô vẫn lấy MỐC — như #KLS2011: bill 1,4kg, hoá đơn tính ô 1,5kg', () => {
      expect(canTinhCuocTuO(khopOBangGia(744_049, cells), 2.5)).toBe(1.5);
    });
    it('net không trùng ô nào → rơi về số cũ, KHÔNG bịa cân', () => {
      expect(canTinhCuocTuO(khopOBangGia(1_324_381, cells), 4)).toBe(4);
    });
    it('net ≤ 0 (bill thiếu cột base) → rơi về số cũ', () => {
      expect(canTinhCuocTuO(khopOBangGia(0, cells), 2)).toBe(2);
    });
    it('không có số rơi về và không tra được ô → null', () => {
      expect(canTinhCuocTuO(khopOBangGia(0, cells), null)).toBeNull();
    });
  });
});
