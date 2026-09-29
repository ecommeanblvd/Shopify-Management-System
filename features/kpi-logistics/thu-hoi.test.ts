import { describe, it, expect } from 'vitest';
import { gomThuHoi } from './thu-hoi';
import { heSoK } from './quy-che';

describe('gomThuHoi — tỉ lệ thực thu cho hệ số K', () => {
  it('tỉ lệ bình thường', () => {
    const t = gomThuHoi([{ khieuNaiVnd: 1_000_000, thuHoiVnd: 800_000 }]);
    expect(t.tyLe).toBeCloseTo(0.8, 10);
  });

  it('CHẶN TRẦN từng dòng: một dòng trả dư KHÔNG được che dòng khác còn thiếu', () => {
    // Đo production: 2 dòng hãng trả nhiều hơn mức khiếu nại, dư tổng 1.773.893đ.
    const dong = [
      { khieuNaiVnd: 1_000_000, thuHoiVnd: 2_000_000 }, // trả dư 1tr
      { khieuNaiVnd: 1_000_000, thuHoiVnd: 0 },         // chưa đòi được đồng nào
    ];
    // Cộng gộp sẽ ra 2.000.000 / 2.000.000 = 100% — "đòi đủ", trong khi còn một dòng trắng tay.
    expect(gomThuHoi(dong).thuHoiThoVnd).toBe(2_000_000);
    expect(gomThuHoi(dong).thuHoiVnd).toBe(1_000_000);
    expect(gomThuHoi(dong).tyLe).toBeCloseTo(0.5, 10);
  });

  it('tỉ lệ KHÔNG BAO GIỜ vượt 100% — đó là dấu hiệu hai vế khác tập', () => {
    const t = gomThuHoi([{ khieuNaiVnd: 100, thuHoiVnd: 10_000 }]);
    expect(t.tyLe).toBe(1);
  });

  it('không có dòng khiếu nại nào → null (CHƯA ĐO ĐƯỢC), không phải 0%', () => {
    expect(gomThuHoi([]).tyLe).toBeNull();
    // null đi vào K cho mức thận trọng 0,6 chứ không phải 0 — chưa đo được khác với đòi hỏng.
    expect(heSoK(gomThuHoi([]).tyLe)).toBe(0.6);
    expect(heSoK(0)).toBe(0.6);
  });

  it('mức chênh ÂM (mình trả thừa) vẫn tính bằng trị tuyệt đối', () => {
    expect(gomThuHoi([{ khieuNaiVnd: -500_000, thuHoiVnd: 250_000 }]).tyLe).toBeCloseTo(0.5, 10);
  });

  it('số tháng 8 thật: chặn trần kéo 82,3% xuống 76,8%', () => {
    // Ba nhóm trạng thái đo được trên production tháng 8.
    const t = gomThuHoi([
      { khieuNaiVnd: 4_433_997, thuHoiVnd: 1_775_571 },  // disputing
      { khieuNaiVnd: 14_360_112, thuHoiVnd: 15_502_919 }, // credited — trả dư
      { khieuNaiVnd: 2_207_160, thuHoiVnd: 0 },           // carrier_error, chưa đòi được
    ]);
    expect(t.khieuNaiVnd).toBe(21_001_269);
    // Gộp thô cho 82,3%; chặn trần cho 76,8% vì phần trả dư không bù sang nhóm chưa đòi được.
    expect(Math.round((t.thuHoiThoVnd / t.khieuNaiVnd) * 1000) / 10).toBe(82.3);
    expect(Math.round((t.tyLe ?? 0) * 1000) / 10).toBe(76.8);
    expect(heSoK(t.tyLe)).toBe(0.6);
  });
});
