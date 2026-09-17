import { describe, it, expect } from 'vitest';
import { mapUpsStatus, parseUpsTrack, parseUpsLichSu } from './track';

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
