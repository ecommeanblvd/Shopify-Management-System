import { describe, it, expect } from 'vitest';
import { canDongTrangThai, canLapNgay, canSuaNgay, type ShipmentHienTai, chonTrangThaiChoKien } from './can-freeze';

const sp = (p: Partial<ShipmentHienTai> = {}): ShipmentHienTai => ({
  deliveryStatus: null, deliveredAt: null, deliverySource: null,
  trackingNumber: null, labelCreatedAt: null, ...p,
});

describe('canDongTrangThai', () => {
  it('đã delivered rồi → không cần chạy', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'delivered' })], true)).toBe(false);
  });
  it('chưa delivered, không phải đánh delivered → cần chạy', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit' })], false)).toBe(true);
  });
  it('đánh delivered mà CHƯA ship (không tracking, không label) → không chạy, đúng guard 29/07', () => {
    expect(canDongTrangThai([sp()], true)).toBe(false);
  });
  it('đánh delivered và đã có tracking → cần chạy', () => {
    expect(canDongTrangThai([sp({ trackingNumber: '123' })], true)).toBe(true);
  });
  it('đơn nhiều kiện: chỉ cần MỘT kiện thoả là phải chạy', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'delivered' }), sp({ trackingNumber: 'x' })], true)).toBe(true);
  });
  it('không có kiện nào → không chạy', () => {
    expect(canDongTrangThai([], true)).toBe(false);
  });
});

describe('canLapNgay', () => {
  it('delivered mà thiếu ngày → cần lấp', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'delivered' })])).toBe(true);
  });
  it('delivered và đã có ngày → thôi', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'delivered', deliveredAt: new Date() })])).toBe(false);
  });
  it('chưa delivered → thôi', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'in_transit' })])).toBe(false);
  });
});

describe('canSuaNgay', () => {
  const cu = new Date('2026-05-01');
  const moi = new Date('2026-05-03');
  it('nguồn lark, ngày khác → cần sửa', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark', deliveredAt: cu })], moi)).toBe(true);
  });
  it('ngày trùng → thôi', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark', deliveredAt: moi })], moi)).toBe(false);
  });
  it('nguồn KHÁC lark → không đụng (POD bill / FedEx track)', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'carrier_bill', deliveredAt: cu })], moi)).toBe(false);
  });
  it('không có ngày thực → thôi', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark', deliveredAt: cu })], null)).toBe(false);
  });
});

describe('chonTrangThaiChoKien — đơn tách kiện (CEO 16/09/2026)', () => {
  const d = (ngay: string) => ({ deliveryState: 'delivered' as const, actualDeliveredAt: new Date(ngay), expectedDeliveryDate: null });
  const theoTracking = new Map([
    ['876026631930', d('2026-08-24')],
    ['876817322555', d('2026-09-10')],
  ]);
  const cuaDon = d('2026-09-10');

  it('#MBLVD29942: mỗi kiện lấy ngày giao của CHÍNH dòng Lark có mã vận đơn đó', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: '876026631930' }, 2, theoTracking, cuaDon)?.actualDeliveredAt?.toISOString().slice(0, 10)).toBe('2026-08-24');
    expect(chonTrangThaiChoKien({ trackingNumber: '876817322555' }, 2, theoTracking, cuaDon)?.actualDeliveredAt?.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('đơn nhiều kiện mà kiện không có dòng Lark riêng → bỏ qua, không gán ngày của cả đơn', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: '999' }, 2, theoTracking, cuaDon)).toBeNull();
    expect(chonTrangThaiChoKien({ trackingNumber: null }, 2, theoTracking, cuaDon)).toBeNull();
  });

  /* THU HẸP 28/09/2026: luật 16/09 cho đơn MỘT kiện mượn trạng thái cả đơn, kể cả
     khi kiện chưa có mã vận đơn — đó chính là chỗ "delivered" ảo lọt vào. Nay đơn
     một kiện vẫn mượn được, nhưng kiện phải CÓ mã vận đơn đã. */
  it('đơn một kiện, kiện ĐÃ có mã vận đơn → vẫn dùng trạng thái cả đơn như luật 16/09', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: '876026631930' }, 1, new Map(), cuaDon)).toBe(cuaDon);
  });

  it('mã vận đơn có khoảng trắng thừa vẫn khớp', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: ' 876026631930 ' }, 2, theoTracking, cuaDon)).toBe(theoTracking.get('876026631930'));
  });
});

describe('nguồn hãng thắng Lark (spec ghi ngược §6)', () => {
  it('canDongTrangThai: kiện nguồn fedex → không đè dù Lark nói khác', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', deliverySource: 'fedex', trackingNumber: 'x' })], true)).toBe(false);
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', deliverySource: 'carrier_bill', trackingNumber: 'x' })], false)).toBe(false);
  });
  it('canDongTrangThai: nguồn lark / null vẫn như cũ', () => {
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', deliverySource: 'lark', trackingNumber: 'x' })], true)).toBe(true);
    expect(canDongTrangThai([sp({ deliveryStatus: 'in_transit', trackingNumber: 'x' })], true)).toBe(true);
  });
  it('canLapNgay: delivered nguồn ups thiếu ngày → để hãng tự điền, Lark không lấp', () => {
    expect(canLapNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'ups' })])).toBe(false);
    expect(canLapNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'lark' })])).toBe(true);
  });
  it('canSuaNgay vốn chỉ nguồn lark — giữ nguyên', () => {
    expect(canSuaNgay([sp({ deliveryStatus: 'delivered', deliverySource: 'fedex', deliveredAt: new Date('2026-05-01') })], new Date('2026-05-03'))).toBe(false);
  });
});

describe('bằng chứng ĐÃ SHIP là MÃ VẬN ĐƠN, không phải ngày lên nhãn (28/09/2026)', () => {
  /* Guard 29/07 nhận `labelCreatedAt` làm bằng chứng đã ship. Không đủ: ngày lên
     nhãn KHÔNG bị xoá khi Lark đổi ô đó thành placeholder (patchFrom chỉ ghi khi
     có giá trị), nên một ngày CŨ nằm lại và mở cửa cho "delivered" ảo. Đo
     28/09/2026: đúng 16 kiện delivered mà không có tracking — y hệt con số 29/07,
     tức bản vá cũ không chạm vào gốc. 4 trong số đó là kiện đóng gói NGAY HÔM ĐÓ. */
  it('có ngày lên nhãn nhưng KHÔNG có mã vận đơn → KHÔNG được đánh delivered', () => {
    expect(canDongTrangThai([sp({ labelCreatedAt: new Date('2026-08-10') })], true)).toBe(false);
  });

  it('có mã vận đơn → vẫn chạy bình thường', () => {
    expect(canDongTrangThai([sp({ trackingNumber: '5563167186' })], true)).toBe(true);
  });

  it('trạng thái KHÁC delivered thì không cần bằng chứng ship', () => {
    expect(canDongTrangThai([sp({ labelCreatedAt: new Date('2026-08-10') })], false)).toBe(true);
  });
});

describe('chonTrangThaiChoKien — kiện KHÔNG có mã vận đơn', () => {
  const cuaDon = { deliveryState: 'delivered' as const, actualDeliveredAt: new Date('2026-09-28'), expectedDeliveryDate: null };

  it('đơn một kiện mà kiện chưa có mã vận đơn → KHÔNG lấy trạng thái cả đơn', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: null }, 1, new Map(), cuaDon)).toBeNull();
  });

  it('có mã vận đơn nhưng Lark không có dòng nào trùng mã → vẫn dùng trạng thái cả đơn', () => {
    expect(chonTrangThaiChoKien({ trackingNumber: 'T9' }, 1, new Map(), cuaDon)).toEqual(cuaDon);
  });
});
