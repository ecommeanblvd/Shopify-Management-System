import { describe, it, expect } from 'vitest';
import { mapFedexStatus, parseFedexTrack, parseFedexTrackBatch, parseLichSuQuet, docMocFedex, trangThaiSauKhiTrack, TOI_DA_MOI_LO } from './track';

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

describe('trangThaiSauKhiTrack — giữ trạng thái đang hoàn về', () => {
  it('đơn đang hoàn về KHÔNG bị hãng kéo về in_transit', () => {
    expect(trangThaiSauKhiTrack('returning', 'in_transit')).toBeNull();
    expect(trangThaiSauKhiTrack('returning', 'out_for_delivery')).toBeNull();
    expect(trangThaiSauKhiTrack('returning', 'exception')).toBeNull();
    expect(trangThaiSauKhiTrack('returning', 'unknown')).toBeNull();
  });

  it('hãng báo ĐÃ GIAO thì lật lại được — đó là tin đủ mạnh', () => {
    expect(trangThaiSauKhiTrack('returning', 'delivered')).toBe('delivered');
  });

  it('đơn bình thường thì lấy nguyên trạng thái hãng trả về', () => {
    expect(trangThaiSauKhiTrack('in_transit', 'out_for_delivery')).toBe('out_for_delivery');
    expect(trangThaiSauKhiTrack(null, 'in_transit')).toBe('in_transit');
    expect(trangThaiSauKhiTrack(undefined, 'delivered')).toBe('delivered');
  });

  it('mã RS của FedEx map sang returning, không lẫn vào exception', () => {
    expect(mapFedexStatus('RS')).toBe('returning');
    expect(mapFedexStatus('HL')).toBe('exception');
  });
});

describe('parseLichSuQuet', () => {
  it('ghép theo mã vận đơn, giữ sự kiện, tách mã lỗi', () => {
    const m = parseLichSuQuet({ output: { completeTrackResults: [
      { trackingNumber: '1Z2050VDDG23324091', trackResults: [{ error: { code: 'TRACKING.TRACKINGNUMBER.INVALID' } }] },
      { trackingNumber: '875529338575', trackResults: [{ scanEvents: [{ eventType: 'DE', exceptionCode: '08', exceptionDescription: 'Customer not available or business closed' }] }] },
    ] } });
    expect(m.get('1Z2050VDDG23324091')).toEqual({ loi: 'TRACKING.TRACKINGNUMBER.INVALID' });
    const k = m.get('875529338575');
    expect(k && 'suKien' in k ? k.suKien[0].exceptionCode : null).toBe('08');
  });
  it('phản hồi rỗng hoặc hỏng → bản đồ rỗng', () => {
    expect(parseLichSuQuet(null).size).toBe(0);
    expect(parseLichSuQuet({}).size).toBe(0);
  });
});

describe('mới tạo nhãn (CEO 17/09/2026)', () => {
  it('OC "Label created" và IN không còn là đang vận chuyển', () => {
    expect(mapFedexStatus('OC')).toBe('label_created');
    expect(mapFedexStatus('IN')).toBe('label_created');
    expect(mapFedexStatus('PU')).toBe('in_transit');
  });
});

/* CEO 02/10/2026 — "hãng thắng, nhưng không lùi".
   Bối cảnh đo được: cả 43 kiện UPS đang mang delivery_source='lark' (trạng thái do đội vận hành
   gõ, vì tracking UPS chưa từng chạy). Bật tracking là có NGƯỜI GHI THỨ HAI trên cùng một cột:
   sync-lark mỗi giờ, track-shipments mỗi 6 giờ. Không có luật này thì hai bên lật qua lật lại. */
describe('trangThaiSauKhiTrack — hãng không kéo trạng thái LÙI', () => {
  it('tiến lên hoặc ngang nấc → nhận', () => {
    expect(trangThaiSauKhiTrack('in_transit', 'out_for_delivery')).toBe('out_for_delivery');
    expect(trangThaiSauKhiTrack('label_created', 'in_transit')).toBe('in_transit');
    expect(trangThaiSauKhiTrack('out_for_delivery', 'delivered')).toBe('delivered');
    expect(trangThaiSauKhiTrack('in_transit', 'in_transit')).toBe('in_transit');
  });

  /* 4 kiện UPS thật đang out_for_delivery mà hãng nói in_transit — lùi như vậy là xoá công của
     người vừa nhìn thấy hàng đi giao. */
  it('LÙI → null, giữ trạng thái đang có', () => {
    expect(trangThaiSauKhiTrack('out_for_delivery', 'in_transit')).toBeNull();
    expect(trangThaiSauKhiTrack('delivered', 'out_for_delivery')).toBeNull();
    expect(trangThaiSauKhiTrack('in_transit', 'label_created')).toBeNull();
  });

  it('ĐÃ GIAO là nấc cuối — chỉ "đang hoàn về" lật lại được', () => {
    expect(trangThaiSauKhiTrack('delivered', 'in_transit')).toBeNull();
    expect(trangThaiSauKhiTrack('delivered', 'exception')).toBeNull();
    expect(trangThaiSauKhiTrack('delivered', 'returning')).toBe('returning');
  });

  /* 'unknown' không mang tin gì — ghi nó lên một trạng thái đang đúng là xoá tin bằng vô tin.
     Trước bản này nó ghi đè được, nên một lượt hãng trả rỗng là mất trạng thái. */
  it('hãng trả "unknown" → KHÔNG ghi đè', () => {
    expect(trangThaiSauKhiTrack('in_transit', 'unknown')).toBeNull();
    expect(trangThaiSauKhiTrack('out_for_delivery', 'unknown')).toBeNull();
  });

  /* exception/returning không ở trên thang nấc nên vẫn qua: đó là tin CÓ NGHĨA. Và từ 02/10
     exception của UPS chỉ còn là ngoại lệ thật (thông báo chậm đã về in_transit). */
  it('exception và returning vẫn qua — tin có nghĩa, không phải lùi', () => {
    expect(trangThaiSauKhiTrack('out_for_delivery', 'exception')).toBe('exception');
    expect(trangThaiSauKhiTrack('in_transit', 'returning')).toBe('returning');
  });

  /* Hãng nói ĐÚNG thứ đang có thì cho qua, không xếp vào "giữ" — nếu không thì 35 kiện
     delivered khớp hãng cũng bị báo là "giữ trạng thái", và người gọi bỏ việc ghi deliveredAt. */
  it('hãng nói trùng trạng thái đang có → cho qua, không coi là giữ', () => {
    expect(trangThaiSauKhiTrack('delivered', 'delivered')).toBe('delivered');
    expect(trangThaiSauKhiTrack('returning', 'returning')).toBe('returning');
    expect(trangThaiSauKhiTrack('out_for_delivery', 'out_for_delivery')).toBe('out_for_delivery');
  });

  it('đang exception/unknown/chưa có → nhận mọi tin mới', () => {
    expect(trangThaiSauKhiTrack('exception', 'in_transit')).toBe('in_transit');
    expect(trangThaiSauKhiTrack('unknown', 'out_for_delivery')).toBe('out_for_delivery');
    expect(trangThaiSauKhiTrack(null, 'in_transit')).toBe('in_transit');
  });
});
