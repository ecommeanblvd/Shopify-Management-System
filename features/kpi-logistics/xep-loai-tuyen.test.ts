import { describe, it, expect } from 'vitest';
import { xepLoaiTuyen } from './xep-loai-tuyen';

const NGUONG = 0.65; // ngưỡng kỳ 2026

describe('xepLoaiTuyen', () => {
  it('trên ngưỡng → Đạt', () => {
    // Số thật trên màn: US 84,1% trên 471 kiện.
    expect(xepLoaiTuyen(0.841, 471, NGUONG).ma).toBe('dat');
    expect(xepLoaiTuyen(NGUONG, 100, NGUONG).ma).toBe('dat'); // đúng bằng ngưỡng vẫn đạt
  });

  it('dưới ngưỡng → nói THIẾU BAO NHIÊU ĐIỂM, không chỉ đỏ lên', () => {
    const r = xepLoaiTuyen(0.55, 100, NGUONG);
    expect(r.ma).toBe('chua_dat');
    expect(r.thieuDiem).toBe(10);
    expect(r.nhan).toBe('Thiếu 10 điểm');
  });

  it('ÍT KIỆN thì không gọi đạt hay trượt — kết luận trên nhiễu', () => {
    // Ca thật: Aramex trên tuyến IL có 5 kiện, 40%. Đỏ lên là kết tội một tuyến bằng 5 kiện.
    const r = xepLoaiTuyen(0.4, 5, NGUONG);
    expect(r.ma).toBe('it_kien');
    expect(r.thieuDiem).toBeNull();
  });

  it('UPS 9 kiện 11,1% vẫn là ít kiện — nhưng KHÔNG còn vô hình như trước', () => {
    const r = xepLoaiTuyen(1 / 9, 9, NGUONG);
    expect(r.ma).toBe('it_kien');
    expect(r.nhan).toContain('Chưa đủ kiện');
  });

  it('đúng mốc 10 kiện thì bắt đầu kết luận được', () => {
    expect(xepLoaiTuyen(0.5, 10, NGUONG).ma).toBe('chua_dat');
    expect(xepLoaiTuyen(0.5, 9, NGUONG).ma).toBe('it_kien');
  });

  it('không có kiện nào → chưa đo được, khác với trượt', () => {
    expect(xepLoaiTuyen(null, 0, NGUONG).ma).toBe('chua_do');
    expect(xepLoaiTuyen(0.9, 0, NGUONG).ma).toBe('chua_do');
  });

  it('ngưỡng siết theo lộ trình: cùng một kết quả, kỳ sau có thể trượt', () => {
    // 84,1% đạt ở ngưỡng 65% (2026) nhưng thiếu 0,9 điểm ở ngưỡng 85% (Q1/2027).
    expect(xepLoaiTuyen(0.841, 471, 0.65).ma).toBe('dat');
    expect(xepLoaiTuyen(0.841, 471, 0.85).ma).toBe('chua_dat');
    expect(xepLoaiTuyen(0.841, 471, 0.85).thieuDiem).toBe(0.9);
  });
});
