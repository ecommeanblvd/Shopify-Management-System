import { describe, it, expect } from 'vitest';
import { mapUpsStatus, mapUpsCode, parseUpsTrack, parseUpsLichSu } from './track';

const mau = (activity: unknown[], extra: Record<string, unknown> = {}) => ({
  trackResponse: { shipment: [{ package: [{ trackingNumber: '1Z2050VDDG23324091', activity, ...extra }] }] },
});
const hd = (type: string, description: string, date = '20260827', code = 'XX') =>
  ({ date, time: '143005', status: { type, code, description } });

describe('mapUpsStatus', () => {
  it('map các loại trạng thái', () => {
    expect(mapUpsStatus('D', 'DELIVERED')).toBe('delivered');
    expect(mapUpsStatus('I', 'Arrived at Facility')).toBe('in_transit');
    expect(mapUpsStatus('I', 'Out For Delivery Today')).toBe('out_for_delivery');
    expect(mapUpsStatus('O', null)).toBe('out_for_delivery');
    expect(mapUpsStatus('X', 'x')).toBe('exception');
    expect(mapUpsStatus('RS', 'x')).toBe('returning');
    expect(mapUpsStatus('M', 'Shipper created a label')).toBe('label_created');
    expect(mapUpsStatus('zz', null)).toBe('unknown');
    expect(mapUpsStatus(null, null)).toBe('unknown');
  });
});

describe('parseUpsTrack', () => {
  it('đã giao → lấy ngày giao DEL', () => {
    const r = parseUpsTrack(mau([hd('D', 'DELIVERED', '20260902')], {
      currentStatus: { description: 'Delivered', code: '011' },
      deliveryDate: [{ type: 'DEL', date: '20260902' }],
      deliveryTime: { type: 'DEL', endTime: '101500' },
    }));
    expect(r.status).toBe('delivered');
    expect(r.deliveredAt?.toISOString()).toBe('2026-09-02T10:15:00.000Z');
  });
  it('thiếu type ở currentStatus → lấy hoạt động mới nhất', () => {
    expect(parseUpsTrack(mau([hd('X', 'The receiver was not available'), hd('I', 'Departed')])).status).toBe('exception');
  });
  it('phản hồi rỗng không nổ', () => {
    expect(parseUpsTrack(null).status).toBe('unknown');
    expect(parseUpsTrack({}).status).toBe('unknown');
  });
});

describe('parseUpsLichSu', () => {
  it('chỉ sự kiện X mới có mã ngoại lệ', () => {
    const r = parseUpsLichSu(mau([hd('X', 'Receiver not available', '20260827', 'UZ'), hd('I', 'Clearance in progress')]));
    expect('suKien' in r && r.suKien[0]).toMatchObject({ eventType: 'X', exceptionCode: 'UZ', exceptionDescription: 'Receiver not available' });
    expect('suKien' in r && r.suKien[1]).toMatchObject({ eventType: 'I', exceptionCode: null, exceptionDescription: null });
  });
  it('không có kiện → lỗi kèm cảnh báo UPS', () => {
    const r = parseUpsLichSu({ trackResponse: { shipment: [{ warnings: [{ code: 'TW0001', message: 'Tracking Information Not Found' }] }] } });
    expect(r).toEqual({ loi: 'UPS TW0001 Tracking Information Not Found' });
  });
});

/* Bộ ca dưới đây lấy từ 47 kiện UPS THẬT (đo 02/10/2026, toàn bộ kiện 1Z 17/08–30/09), không
   phải từ tài liệu. Phát hiện quyết định: `currentStatus.type` KHÔNG CÓ ở một mã nào — 0/47. */
describe('mapUpsCode — bộ mã đo trên 47 kiện thật', () => {
  it('011 Delivered → delivered (37/47 kiện)', () => {
    expect(mapUpsCode('011')).toBe('delivered');
  });

  /* 005 là ca đã gây lỗi: kèm thông báo "có thể chậm", lần quét cuối mang type X. CHẬM KHÔNG
     PHẢI NGOẠI LỆ, và chính UPS vẫn đặt tiêu đề "On the Way". */
  it('005 · 087 · 160 → in_transit, dù lần quét cuối là X', () => {
    expect(mapUpsCode('005')).toBe('in_transit');
    expect(mapUpsCode('087')).toBe('in_transit');
    expect(mapUpsCode('160')).toBe('in_transit');
  });

  it('062 Delivery Attempted: Funds Needed → exception (ngoại lệ THẬT)', () => {
    expect(mapUpsCode('062')).toBe('exception');
  });

  /* Mã lạ trả null để người gọi rơi về luật cũ theo `type` — luật cũ sai ở ca 005 nhưng đúng
     ở phần lớn ca khác, nên nó là chỗ rơi an toàn hơn `unknown`. */
  it('mã lạ → null, KHÔNG ép thành unknown', () => {
    expect(mapUpsCode('999')).toBeNull();
    expect(mapUpsCode('')).toBeNull();
    expect(mapUpsCode(null)).toBeNull();
  });
});

describe('parseUpsTrack — ca thật đã gây lỗi', () => {
  const goi = (currentStatus: unknown, actType: string, actDesc: string) => ({
    trackResponse: { shipment: [{ package: [{
      currentStatus, activity: [{ status: { type: actType, description: actDesc } }],
    }] }] },
  });

  /* 1Z2050VDD901619464 và 3 kiện nữa: trước bản sửa ra `exception`, và order-stage.ts bật
     cảnh báo "Sự cố giao hàng" cho hàng đang đi bình thường. */
  it('code 005 "On the Way" + lần quét cuối X → in_transit, KHÔNG phải exception', () => {
    const r = parseUpsTrack(goi(
      { code: '005', description: 'On the Way' },
      'X', 'Due to operating conditions, your package may be delayed.',
    ));
    expect(r.status).toBe('in_transit');
    expect(r.description).toBe('On the Way');
  });

  it('CÙNG code 005 mà lần quét cuối I → vẫn in_transit: một tình trạng, một câu trả lời', () => {
    expect(parseUpsTrack(goi({ code: '005', description: 'On the Way' }, 'I', 'Processing at UPS Facility')).status)
      .toBe('in_transit');
  });

  it('code 062 → exception: ngoại lệ thật vẫn phải nhận', () => {
    expect(parseUpsTrack(goi({ code: '062', description: 'Delivery Attempted: Funds Needed' }, 'X', 'Funds Needed')).status)
      .toBe('exception');
  });

  it('mã đang đi mà mô tả nói ra giao → out_for_delivery', () => {
    expect(parseUpsTrack(goi({ code: '087', description: 'Out For Delivery Today' }, 'I', 'x')).status)
      .toBe('out_for_delivery');
  });

  /* Mã lạ: rơi về luật cũ theo type lần quét — giữ nguyên hành vi trước đây. */
  it('mã lạ → dùng type của lần quét như trước', () => {
    expect(parseUpsTrack(goi({ code: '999', description: 'Weird' }, 'D', 'Delivered')).status).toBe('delivered');
    expect(parseUpsTrack(goi({ code: '999', description: 'Weird' }, 'RS', 'Returning')).status).toBe('returning');
  });
});
