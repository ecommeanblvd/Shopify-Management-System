import { describe, expect, it } from 'vitest';
import { tachGiaTronGoi, ghepLaiTronGoi, saiLechSauTach } from './tach-gia-tron-goi';

// Đọc từ bảng kê HNC kỳ 25/07–22/08/2026.
const HNC = { fuelPercent: 30, vatPercent: 8, phiPhatSinh: 0.4 };

describe('tachGiaTronGoi', () => {
  it('tách đúng thứ tự hãng cộng: bỏ VAT trước, trừ phí phát sinh, rồi bỏ xăng dầu', () => {
    // 25,17 / 1,08 = 23,306 → −0,4 = 22,906 → / 1,3 = 17,62
    expect(tachGiaTronGoi(25.17, HNC)).toBe(17.62);
  });

  it('chọn cent khôi phục sát nhất chứ không làm tròn máy móc', () => {
    // 16,74 không khôi phục khít được; ứng viên tốt nhất sai đúng 1 cent.
    expect(saiLechSauTach(16.74, HNC)).toBeLessThanOrEqual(0.01);
  });

  it('không có phí phát sinh thì chỉ bỏ VAT và xăng dầu', () => {
    expect(tachGiaTronGoi(25.17, { ...HNC, phiPhatSinh: 0 })).toBe(17.93);
  });

  it('xăng dầu 0% thì cước gốc chỉ khác phần VAT và phí phát sinh', () => {
    expect(tachGiaTronGoi(10.8, { fuelPercent: 0, vatPercent: 8, phiPhatSinh: 0 })).toBe(10);
  });
});

describe('ghép lại phải ra đúng số cũ', () => {
  // Giá báo cho khách ở khâu thanh toán lấy từ chính bảng giá này. Tách sai là
  // giá bán đổi — hậu quả nặng hơn nhiều so với việc đối soát thiếu chi tiết.
  it('ô giá thật khôi phục lại sai không quá 1 cent', () => {
    for (const gia of [16.74, 25.17, 42.47, 85.50, 19.22, 29.33, 49.16, 99.36, 48.22, 53.19, 49.41, 89.03]) {
      expect(saiLechSauTach(gia, HNC)).toBeLessThanOrEqual(0.01);
    }
  });

  it('trên cả dải giá của bảng, sai lệch không bao giờ quá 1 cent', () => {
    for (let g = 5; g <= 500; g += 0.37) {
      expect(saiLechSauTach(Math.round(g * 100) / 100, HNC)).toBeLessThanOrEqual(0.01);
    }
  });

  it('phần lớn ô khôi phục KHÍT — sai lệch chỉ rơi vào số lẻ', () => {
    let khit = 0, tong = 0;
    for (let g = 5; g <= 500; g += 0.37) {
      const gia = Math.round(g * 100) / 100;
      tong++;
      if (saiLechSauTach(gia, HNC) === 0) khit++;
    }
    expect(khit / tong).toBeGreaterThan(0.4);
  });

  it('ô giá 0 thì tách ra số âm nhỏ — chỗ gọi phải bỏ qua ô rỗng', () => {
    expect(tachGiaTronGoi(0, HNC)).toBeLessThanOrEqual(0);
  });
});

// Bảng giá HNC 01/07/2026: cước gốc + 30% xăng dầu + 8% VAT, KHÔNG gồm phí
// hải quan. Đây là bộ tham số đã dùng cho 1.000 ô đang chạy; đổi nhầm là sai
// cả bảng giá nên khoá lại bằng số thật.
describe('bộ tham số của bảng giá HNC 01/07/2026', () => {
  const HNC_2026_07 = { fuelPercent: 30, vatPercent: 8, phiPhatSinh: 0 };

  it('tách rồi ghép lại ra đúng giá trên bảng giá PDF', () => {
    for (const gia of [16.74, 25.17, 42.47, 49.16, 48.22, 53.19, 89.03]) {
      expect(saiLechSauTach(gia, HNC_2026_07)).toBeLessThanOrEqual(0.01);
    }
  });

  it('cước gốc suy ra cao hơn cước gốc hãng thu ĐỀU 3% ở các tuyến Trung Đông', () => {
    // [giá bảng giá, cước gốc hãng thực thu trên bảng kê]
    const doiChieu: Array<[number, number]> = [
      [16.74, 11.57], [25.17, 17.40], [42.47, 29.37],
      [49.16, 34.00], [48.22, 33.34], [53.19, 36.78],
    ];
    for (const [tron, gocHang] of doiChieu) {
      const bien = (tachGiaTronGoi(tron, HNC_2026_07) / gocHang - 1) * 100;
      expect(bien).toBeGreaterThan(2.9);
      expect(bien).toBeLessThan(3.1);
    }
  });

  it('trừ nhầm phí hải quan ra thì biên hết đều — dấu hiệu tham số sai', () => {
    const sai = { ...HNC_2026_07, phiPhatSinh: 0.4 };
    const biens = ([[16.74, 11.57], [53.19, 36.78]] as Array<[number, number]>)
      .map(([tron, goc]) => (tachGiaTronGoi(tron, sai) / goc - 1) * 100);
    expect(Math.abs(biens[0] - biens[1])).toBeGreaterThan(1);
  });
});
