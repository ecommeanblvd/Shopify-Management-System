import { describe, it, expect } from 'vitest';
import { khopOBangGia, type OBangGia } from './bill-base-check';

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
});
