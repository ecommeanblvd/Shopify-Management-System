import { describe, expect, it } from 'vitest';
import { bacCanTuTenRate, dungRateStandard } from './zone-standard-rates';

describe('bacCanTuTenRate', () => {
  it('đọc bậc cân từ tên rate của hệ thống', () => {
    expect(bacCanTuTenRate('FedEx IP (0–0.5 kg)')).toEqual({ hang: 'FedEx IP', min: 0, max: 0.5 });
    expect(bacCanTuTenRate('DHL Express (2.5–3 kg)')).toEqual({ hang: 'DHL Express', min: 2.5, max: 3 });
  });

  it('nhận cả gạch nối thường lẫn gạch dài', () => {
    expect(bacCanTuTenRate('FedEx IP (25-30 kg)')?.max).toBe(30);
  });

  it('tên không theo khuôn thì trả null', () => {
    expect(bacCanTuTenRate('Standard shipping')).toBeNull();
    expect(bacCanTuTenRate('')).toBeNull();
  });
});

describe('dungRateStandard', () => {
  const rates = {
    'FedEx IP (0–0.5 kg)': { price: 56, currency: 'USD' },
    'FedEx IP (0.5–1 kg)': { price: 65, currency: 'USD' },
    'FedEx IP (1–1.5 kg)': { price: 71, currency: 'USD' },
    'DHL Express (0–0.5 kg)': { price: 78, currency: 'USD' },
    'DHL Express (0.5–1 kg)': { price: 90, currency: 'USD' },
  };

  // Các zone đang chạy đều lấy FedEx kể cả khi DHL rẻ hơn (SEA1: FedEx 51,5 vs
  // DHL 39,5 → Shopify đang để 51,5). Zone mới phải theo cùng quy tắc, nếu
  // không giá sẽ không nhất quán giữa các nước.
  it('ưu tiên FedEx IP kể cả khi DHL rẻ hơn', () => {
    const r = dungRateStandard({ 'FedEx IP (0–0.5 kg)': { price: 51.5, currency: 'USD' }, 'DHL Express (0–0.5 kg)': { price: 39.5, currency: 'USD' } });
    expect(r).toEqual([{ minKg: 0, maxKg: 0.5, price: 51.5, currency: 'USD' }]);
  });

  it('không có FedEx thì dùng DHL', () => {
    const r = dungRateStandard({ 'DHL Express (0–0.5 kg)': { price: 137, currency: 'USD' } });
    expect(r).toEqual([{ minKg: 0, maxKg: 0.5, price: 137, currency: 'USD' }]);
  });

  // Khuôn đang chạy: bậc đầu ≥0, các bậc sau bắt đầu từ mốc trên của bậc trước
  // cộng 0,01 — nếu để bằng nhau thì đơn đúng mốc khớp hai bậc và Shopify hiện
  // hai lựa chọn giá cho cùng một đơn.
  it('mốc dưới của bậc sau = mốc trên bậc trước + 0,01', () => {
    const r = dungRateStandard(rates);
    expect(r.map((x) => [x.minKg, x.maxKg])).toEqual([[0, 0.5], [0.51, 1], [1.01, 1.5]]);
  });

  it('sắp theo cân tăng dần', () => {
    const r = dungRateStandard({
      'FedEx IP (1–1.5 kg)': { price: 71, currency: 'USD' },
      'FedEx IP (0–0.5 kg)': { price: 56, currency: 'USD' },
    });
    expect(r.map((x) => x.maxKg)).toEqual([0.5, 1.5]);
  });

  // Bảng giá khuyết bậc 0,5–1kg: bậc sau phải giữ mốc gốc 1kg, không kéo xuống
  // 0,51 — kéo xuống là tự đặt giá cho khoảng cân mà hãng chưa báo giá.
  it('bảng giá khuyết một bậc thì không lấp chỗ trống', () => {
    const r = dungRateStandard({
      'FedEx IP (0–0.5 kg)': { price: 56, currency: 'USD' },
      'FedEx IP (1–1.5 kg)': { price: 71, currency: 'USD' },
    });
    expect(r.map((x) => x.minKg)).toEqual([0, 1]);
  });

  it('bỏ qua rate không đọc được bậc cân', () => {
    expect(dungRateStandard({ 'Linh tinh': { price: 10, currency: 'USD' } })).toEqual([]);
  });

  it('không có rate nào thì trả mảng rỗng', () => {
    expect(dungRateStandard({})).toEqual([]);
  });
});
