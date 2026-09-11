import { describe, it, expect } from 'vitest';
import { mapFedexStatus, parseFedexTrack, parseFedexTrackBatch, docMocFedex, TOI_DA_MOI_LO } from './track';

describe('mapFedexStatus', () => {
  it('các mã đã đối chiếu thật trên sandbox FedEx', () => {
    expect(mapFedexStatus('DL')).toBe('delivered');
    expect(mapFedexStatus('HL')).toBe('exception');      // chờ khách tới lấy — trước đây rơi vào unknown
    expect(mapFedexStatus('AD')).toBe('out_for_delivery'); // tới điểm giao — trước đây rơi vào unknown
    expect(mapFedexStatus('AR')).toBe('in_transit');
    expect(mapFedexStatus('DP')).toBe('in_transit');
    expect(mapFedexStatus('DE')).toBe('exception');
  });
  it('kiện CHẬM vẫn là đang đi, không phải sự cố — độ trễ đo bằng số ngày ở bảng SOP', () => {
    expect(mapFedexStatus('DY')).toBe('in_transit');
    expect(mapFedexStatus('DD')).toBe('in_transit');
  });
  it('mã thông quan và trung chuyển gặp trên hàng thật', () => {
    expect(mapFedexStatus('CP')).toBe('in_transit');
    expect(mapFedexStatus('CC')).toBe('in_transit');
    expect(mapFedexStatus('SF')).toBe('in_transit');
  });
  it('không phân biệt hoa thường; mã lạ hoặc rỗng → unknown', () => {
    expect(mapFedexStatus('dl')).toBe('delivered');
    expect(mapFedexStatus('ZZ')).toBe('unknown');
    expect(mapFedexStatus(null)).toBe('unknown');
  });
});

describe('docMocFedex', () => {
  it('giữ nguyên giờ đồng hồ, không dịch theo múi giờ của máy chạy', () => {
    expect(docMocFedex('2022-11-27T17:39:00')?.toISOString().slice(0, 16)).toBe('2022-11-27T17:39');
  });
  it('có offset thì vẫn giữ giờ địa phương nơi giao', () => {
    expect(docMocFedex('2022-11-27T17:39:00-06:00')?.toISOString().slice(0, 16)).toBe('2022-11-27T17:39');
    expect(docMocFedex('2022-11-27T17:39:00Z')?.toISOString().slice(0, 16)).toBe('2022-11-27T17:39');
  });
  it('rỗng hoặc rác → null', () => {
    expect(docMocFedex(null)).toBeNull();
    expect(docMocFedex('')).toBeNull();
    expect(docMocFedex('không phải ngày')).toBeNull();
  });
});

describe('parseFedexTrack', () => {
  const raw = {
    output: { completeTrackResults: [{ trackingNumber: '111', trackResults: [{
      latestStatusDetail: { code: 'DL', statusByLocale: 'Delivered' },
      dateAndTimes: [{ type: 'SHIP', dateTime: '2022-11-20T00:00:00' }, { type: 'ACTUAL_DELIVERY', dateTime: '2022-11-27T17:39:00' }],
    }] }] },
  };
  it('lấy mã, mô tả và ĐÚNG mốc ACTUAL_DELIVERY (không lấy nhầm ngày gửi)', () => {
    const p = parseFedexTrack(raw);
    expect(p.statusCode).toBe('DL');
    expect(p.status).toBe('delivered');
    expect(p.description).toBe('Delivered');
    expect(p.deliveredAt?.toISOString().slice(0, 16)).toBe('2022-11-27T17:39');
  });
  it('chưa giao thì không có ngày giao', () => {
    const p = parseFedexTrack({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: 'AR' }, dateAndTimes: [] }] }] } });
    expect(p.status).toBe('in_transit');
    expect(p.deliveredAt).toBeNull();
  });
  it('có mốc ACTUAL_DELIVERY thì là ĐÃ GIAO, kể cả khi mã trạng thái chưa có trong bảng', () => {
    const p = parseFedexTrack({ output: { completeTrackResults: [{ trackResults: [{
      latestStatusDetail: { code: 'ZZ' },
      dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-09-01T09:00:00' }],
    }] }] } });
    expect(p.statusCode).toBe('ZZ');
    expect(p.status).toBe('delivered');
  });
  it('phản hồi rỗng hoặc rác → unknown, không nổ', () => {
    expect(parseFedexTrack({}).status).toBe('unknown');
    expect(parseFedexTrack(null).statusCode).toBeNull();
  });
});

describe('parseFedexTrackBatch', () => {
  // Dựng lại đúng ca đã gặp trên sandbox: gửi 3 mã, FedEx trả về một mã KHÁC ở vị trí cuối.
  const raw = {
    output: { completeTrackResults: [
      { trackingNumber: '613746411451', trackResults: [{ latestStatusDetail: { code: 'DL' }, dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2022-11-27T17:39:00' }] }] },
      { trackingNumber: '771994867930', trackResults: [{ latestStatusDetail: { code: 'AR' } }] },
      { trackingNumber: '780476724189', trackResults: [{ latestStatusDetail: { code: 'DE' } }] },
    ] },
  };
  it('ghép theo MÃ VẬN ĐƠN trong phản hồi, không theo thứ tự gửi', () => {
    const m = parseFedexTrackBatch(raw);
    expect(m.get('613746411451')?.status).toBe('delivered');
    expect(m.get('613746411451')?.deliveredAt?.toISOString().slice(0, 10)).toBe('2022-11-27');
    expect(m.get('771994867930')?.status).toBe('in_transit');
  });
  it('mã đã gửi nhưng KHÔNG có trong phản hồi thì vắng mặt, không bị gán nhầm kết quả của mã khác', () => {
    const m = parseFedexTrackBatch(raw);
    expect(m.has('397773675776')).toBe(false);
    expect(m.size).toBe(3);
  });
  it('phản hồi rỗng → bản đồ rỗng', () => {
    expect(parseFedexTrackBatch({}).size).toBe(0);
  });
});

describe('giới hạn lô', () => {
  it('đúng 30 theo đặc tả Basic Integrated Visibility', () => { expect(TOI_DA_MOI_LO).toBe(30); });
});
