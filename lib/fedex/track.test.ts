import { describe, it, expect } from 'vitest';
import { mapFedexStatus, parseFedexTrack, parseFedexTrackBatch, parseLichSuQuet, parseThongSoVanDon, docMocFedex, trangThaiSauKhiTrack, TOI_DA_MOI_LO } from './track';

describe('mapFedexStatus', () => {
  it('các mã đã đối chiếu thật trên sandbox FedEx', () => {
    expect(mapFedexStatus('DL')).toBe('delivered');
    // HL (chờ khách tới lấy): 'unknown' → 'exception' (13/09) → 'awaiting_pickup' (02/10) khi
    // CEO chốt thêm nấc riêng. Gộp vào exception thì nó nằm chung rổ với kiện giao thất bại.
    expect(mapFedexStatus('HL')).toBe('awaiting_pickup');
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
    // HL nay là nấc riêng, không còn lẫn vào exception (CEO 02/10/2026).
    expect(mapFedexStatus('HL')).toBe('awaiting_pickup');
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

/* Nấc `awaiting_pickup` (CEO 02/10/2026) — kiện nằm ở điểm nhận chờ khách tới lấy. */
describe('awaiting_pickup — cùng nấc với out_for_delivery, cả hai chiều đi được', () => {
  /* Hai thứ đều là chặng cuối và đi được CẢ HAI CHIỀU: giao không được thì về điểm nhận
     (ofd → chờ lấy); khách xin giao lại thì ra xe lần nữa (chờ lấy → ofd). Xếp nó thành nấc SAU
     ofd sẽ chặn chiều thứ hai, và trạng thái đứng im ở "chờ khách lấy" trong khi hãng đã mang đi. */
  it('ofd ⇄ chờ khách lấy: KHÔNG coi là kéo lùi', () => {
    expect(trangThaiSauKhiTrack('out_for_delivery', 'awaiting_pickup')).toBe('awaiting_pickup');
    expect(trangThaiSauKhiTrack('awaiting_pickup', 'out_for_delivery')).toBe('out_for_delivery');
  });

  it('chờ khách lấy → đã giao: tiến lên, nhận', () => {
    expect(trangThaiSauKhiTrack('awaiting_pickup', 'delivered')).toBe('delivered');
  });

  it('đã giao KHÔNG lùi về chờ khách lấy', () => {
    expect(trangThaiSauKhiTrack('delivered', 'awaiting_pickup')).toBeNull();
  });

  it('chờ khách lấy KHÔNG bị kéo về in_transit', () => {
    expect(trangThaiSauKhiTrack('awaiting_pickup', 'in_transit')).toBeNull();
  });

  /* HL = Hold at Location. Trước 02/10 nó nằm chung rổ 'exception' với kiện giao thất bại, nên
     không ai phân biệt được việc cần làm: sự cố thì gọi HÃNG, chờ lấy thì gọi KHÁCH. */
  it('FedEx HL tách khỏi exception sang nấc mới', () => {
    expect(mapFedexStatus('HL')).toBe('awaiting_pickup');
    expect(mapFedexStatus('DE')).toBe('exception');
  });
});

/* Phản hồi THẬT của FedEx cho `878631025811` (cắt bớt phần không liên quan), chụp 15/10/2026.
 * Giữ nguyên hình dạng gốc — kể cả chỗ FedEx trả cả CM lẫn INCH trong cùng một mảng — vì đúng
 * những chỗ đó mới sinh lỗi. */
const PHAN_HOI_THAT = {
  output: {
    completeTrackResults: [{
      trackingNumber: '878631025811',
      trackResults: [{
        recipientInformation: { address: { city: 'SHORELINE', stateOrProvinceCode: 'WA', countryCode: 'US', residential: false } },
        specialHandlings: [
          { type: 'DELIVER_WEEKDAY', description: 'Deliver Weekday' },
          { type: 'DIRECT_SIGNATURE_REQUIRED', description: 'Direct Signature Required' },
        ],
        packageDetails: {
          packagingDescription: { type: 'FEDEX_PAK', description: 'FedEx Pak' },
          weightAndDimensions: {
            weight: [{ value: '0.7', unit: 'KG' }, { value: '1.54', unit: 'LB' }],
            dimensions: [
              { length: 36, width: 27, height: 6, units: 'CM' },
              { length: 14, width: 10, height: 2, units: 'IN' },
            ],
          },
        },
        serviceDetail: { type: 'FEDEX_INTERNATIONAL_PRIORITY', description: 'FedEx International Priority' },
        additionalTrackingInfo: { packageIdentifiers: [{ type: 'SHIPPER_REFERENCE', values: ['#MBLVD30251'] }] },
        dateAndTimes: [
          { type: 'COMMITMENT', dateTime: '2026-10-16T20:00:00-07:00' },
          { type: 'ACTUAL_PICKUP', dateTime: '2026-10-14T14:46:00+07:00' },
          { type: 'SHIP', dateTime: '2026-10-14T00:00:00+00:00' },
        ],
      }],
    }],
  },
};

describe('parseThongSoVanDon', () => {
  const t = parseThongSoVanDon(PHAN_HOI_THAT)!;

  /* Đây là trường đã thiếu và làm lệch giá: không khai bao gói thì FedEx báo theo thang HỘP,
   * trong khi nhãn này là Túi FedEx. Đo trên hoá đơn thật: kiện túi 17/17 khớp thang PAK. */
  it('đọc LOẠI BAO GÓI của chính nhãn', () => {
    expect(t.loaiBaoGoi).toBe('FEDEX_PAK');
    expect(t.dichVu).toBe('FEDEX_INTERNATIONAL_PRIORITY');
  });

  /* FedEx trả kích thước ở CẢ hai đơn vị trong một mảng, thứ tự không cam kết. Lấy nhầm bản
   * INCH là thu nhỏ kiện 2,54 lần rồi báo một giá rẻ bịa ra. */
  it('lấy kích thước bản CM, không lấy bản INCH', () => {
    expect(t.kichThuocCm).toEqual({ dai: 36, rong: 27, cao: 6 });
    expect(t.canKg).toBe(0.7);
  });

  /* Cờ của HÃNG trên chính nhãn này thắng phép suy của mình: cột `addr_class` của hệ thống ghi
   * RESIDENTIAL, hãng ghi false và không thu 84.400 + nhiên liệu trên đó. */
  it('đọc cờ nhà dân của hãng, kể cả khi là false', () => {
    expect(t.nhaDan).toBe(false);
  });

  /* Tên thành phố HÃNG CHUẨN HOÁ, không phải tên khách gõ — FedEx tra phụ phí vùng sâu xa
   * theo tên của nó. Trên `878423234737` hãng ghi 'BUKAYRIYAH' còn Shopify giữ
   * 'Al Bukayriyah'; gửi tên khách thì khoản 550.000đ biến mất khỏi báo giá. */
  it('đọc tên thành phố + tỉnh/bang hãng đã chuẩn hoá', () => {
    expect(t.thanhPho).toBe('SHORELINE');
    expect(t.tinhBang).toBe('WA');
  });

  it('ký nhận trực tiếp suy từ specialHandlings, không suy theo nước', () => {
    expect(t.kyNhanTrucTiep).toBe(true);
  });

  it('ngày gửi lấy mốc SHIP, không lấy COMMITMENT hay ACTUAL_PICKUP', () => {
    expect(t.ngayGui).toBe('2026-10-14');
  });

  it('mã tham chiếu của người gửi để đối chiếu đúng đơn', () => {
    expect(t.maThamChieu).toBe('#MBLVD30251');
  });

  /* Track API KHÔNG trả tiền — đã soát sạch cây phản hồi. Nếu một ngày FedEx thêm trường tiền
   * thì hình dữ liệu này phải được xem lại, chứ không lặng lẽ bỏ qua. */
  it('hình dữ liệu KHÔNG có trường tiền nào', () => {
    expect(Object.keys(t)).toEqual([
      'loaiBaoGoi', 'dichVu', 'canKg', 'kichThuocCm', 'thanhPho', 'tinhBang', 'nhaDan',
      'kyNhanTrucTiep', 'ngayGui', 'maThamChieu',
    ]);
  });

  /* Nhãn vừa tạo thì FedEx chưa có dữ liệu. Phải trả null để tầng trên rơi về dữ liệu của mình
   * VÀ nói ra, chứ không ném cho cả thao tác nhập mã vận đơn chết theo. */
  it('hãng trả lỗi cho mã → null, không ném', () => {
    expect(parseThongSoVanDon({ output: { completeTrackResults: [{ trackResults: [{ error: { code: 'TRACKING.TRACKINGNUMBER.NOTFOUND' } }] }] } })).toBeNull();
    expect(parseThongSoVanDon({ output: { completeTrackResults: [] } })).toBeNull();
    expect(parseThongSoVanDon(null)).toBeNull();
  });

  /* Thiếu từng ô là chuyện thường (FedEx che tuỳ kiện) — người gọi rơi về nguồn của mình cho
   * ĐÚNG Ô thiếu. Thiếu một chiều thì bỏ cả khối kích thước, vì ba chiều mới là một kiện. */
  it('thiếu từng ô → null riêng ô đó, không kéo cả khối', () => {
    const t2 = parseThongSoVanDon({ output: { completeTrackResults: [{ trackResults: [{
      packageDetails: { packagingDescription: { type: 'YOUR_PACKAGING' },
        weightAndDimensions: { dimensions: [{ length: 36, width: 27, units: 'CM' }] } },
    }] }] } })!;
    expect(t2.loaiBaoGoi).toBe('YOUR_PACKAGING');
    expect(t2.kichThuocCm).toBeNull();
    expect(t2.canKg).toBeNull();
    expect(t2.nhaDan).toBeNull();
    expect(t2.thanhPho).toBeNull();
    expect(t2.kyNhanTrucTiep).toBe(false);
  });
});
