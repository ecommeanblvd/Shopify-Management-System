import { describe, it, expect } from 'vitest';
import { thuChiShipHo, type DonShipHoTho } from './thu-chi-ship-ho';

const don = (o: Partial<DonShipHoTho>): DonShipHoTho => ({
  chargedVnd: null, actualChargedVnd: null, actualDutyVnd: null,
  carrierCostVnd: null, actualCarrierCostVnd: null, ...o,
});

describe('thuChiShipHo — hai vế phải cùng thước (có duty hoặc không có duty)', () => {
  it('đơn đã đối soát: doanh thu CỘNG duty để so đúng với chi phí đã gồm duty', () => {
    // Đây là lỗi làm margin ship hộ âm mọi tháng: chi có duty, thu thì không.
    const r = thuChiShipHo(don({
      actualChargedVnd: 1_000_000, actualDutyVnd: 300_000, actualCarrierCostVnd: 1_200_000,
    }));
    expect(r.revenueVnd).toBe(1_300_000);
    expect(r.costVnd).toBe(1_200_000);
    expect(r.revenueVnd! - r.costVnd!).toBe(100_000); // dương, không phải −200.000
  });

  it('không cộng duty khi chưa đối soát — báo giá vốn không có duty', () => {
    const r = thuChiShipHo(don({
      chargedVnd: 1_000_000, actualDutyVnd: 300_000, carrierCostVnd: 900_000,
    }));
    expect(r.revenueVnd).toBe(1_000_000);
    expect(r.costVnd).toBe(900_000);
  });

  it('đã đối soát mà không có duty thì thu giữ nguyên', () => {
    const r = thuChiShipHo(don({ actualChargedVnd: 500_000, actualCarrierCostVnd: 400_000 }));
    expect(r.revenueVnd).toBe(500_000);
  });

  it('ưu tiên số THỰC ở từng vế', () => {
    const r = thuChiShipHo(don({
      chargedVnd: 111, actualChargedVnd: 222, actualDutyVnd: 0,
      carrierCostVnd: 333, actualCarrierCostVnd: 444,
    }));
    expect(r.revenueVnd).toBe(222);
    expect(r.costVnd).toBe(444);
  });

  it('thiếu cả thực lẫn dự tính thì null, KHÔNG thành 0', () => {
    const r = thuChiShipHo(don({}));
    expect(r.revenueVnd).toBeNull();
    expect(r.costVnd).toBeNull();
    expect(r.lechNguon).toBe(false);
  });
});

describe('lechNguon — đánh dấu đơn trộn dự tính với thực', () => {
  it('chi THỰC nhưng thu vẫn DỰ TÍNH → đánh dấu (4 đơn tháng 9/2026)', () => {
    const r = thuChiShipHo(don({ chargedVnd: 1_000_000, actualCarrierCostVnd: 1_200_000 }));
    expect(r.lechNguon).toBe(true);
  });

  it('cả hai vế cùng THỰC thì không lệch', () => {
    expect(thuChiShipHo(don({ actualChargedVnd: 1, actualCarrierCostVnd: 1 })).lechNguon).toBe(false);
  });

  it('cả hai vế cùng DỰ TÍNH thì không lệch', () => {
    expect(thuChiShipHo(don({ chargedVnd: 1, carrierCostVnd: 1 })).lechNguon).toBe(false);
  });

  it('thiếu một vế thì không đánh dấu lệch — đó là thiếu, không phải trộn', () => {
    expect(thuChiShipHo(don({ actualCarrierCostVnd: 1 })).lechNguon).toBe(false);
  });
});
