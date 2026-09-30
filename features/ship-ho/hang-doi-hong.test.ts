import { describe, it, expect } from 'vitest';
import { lyDoNgan, tomTatHangDoiHong, type SuKienKetThat } from './hang-doi-hong';

const d = (s: string) => new Date(s);
const ev = (o: Partial<SuKienKetThat> = {}): SuKienKetThat => ({
  orderId: 'o1', code: '26-INSLG-SV-0001', brandReference: null,
  event: 'order.received', occurredAt: d('2026-09-01T00:00:00Z'),
  lastError: 'http 422 · unknown brandSlug: tinh-atelier', lastHttpStatus: 422, ...o,
});

describe('lyDoNgan', () => {
  it('lấy THÂN phản hồi MMP, bỏ phần mã HTTP', () => {
    expect(lyDoNgan('http 422 · unknown brandSlug: tinh-atelier', 422)).toBe('unknown brandSlug: tinh-atelier');
  });
  it('bản ghi CŨ chỉ có mã → nói rõ là chưa lưu lý do, không im lặng', () => {
    expect(lyDoNgan('http 409', 409)).toBe('http 409 — bản ghi cũ, chưa lưu lý do');
  });
  /**
   * Ca thật: 53 bản ghi có `last_error = "http 409"` nhưng `last_http_status` NULL (cột này mới
   * có từ 19/09/2026). Chỉ nhìn cột thì chúng mang nhãn "mạng/timeout" — đổ oan cho đường
   * truyền trong khi MMP đang TỪ CHỐI. Phải lấy mã từ chính chuỗi lỗi.
   */
  it('mã nằm trong chuỗi lỗi mà cột trạng thái NULL → vẫn đọc ra bị từ chối, KHÔNG đổ cho mạng', () => {
    expect(lyDoNgan('http 409', null)).toBe('http 409 — bản ghi cũ, chưa lưu lý do');
    expect(lyDoNgan('http 422', null)).toBe('http 422 — bản ghi cũ, chưa lưu lý do');
  });

  it('lỗi mạng (không có mã HTTP) phân biệt với bị từ chối', () => {
    expect(lyDoNgan('fetch failed', null)).toBe('fetch failed');
    expect(lyDoNgan(null, null)).toBe('không gửi tới nơi (mạng/timeout)');
  });
});

describe('tomTatHangDoiHong', () => {
  it('BỎ bản đã bị vượt — đếm cả vào thì cảnh báo mất uy tín', () => {
    const r = tomTatHangDoiHong(
      [ev({ occurredAt: d('2026-09-01T00:00:00Z') })],
      new Map([['o1', [{ event: 'order.received', occurredAt: d('2026-09-05T00:00:00Z') }]]]),
    );
    expect(r.tong).toBe(0);
  });

  it('nhiều lần thử CÙNG một sự kiện chỉ tính MỘT việc', () => {
    const r = tomTatHangDoiHong(
      [ev({ occurredAt: d('2026-09-01T00:00:00Z') }), ev({ occurredAt: d('2026-09-02T00:00:00Z') })],
      new Map(),
    );
    expect(r.tong).toBe(1);
  });

  it('cùng đơn nhưng KHÁC loại sự kiện là hai việc', () => {
    const r = tomTatHangDoiHong([ev(), ev({ event: 'order.reconciled' })], new Map());
    expect(r.tong).toBe(2);
  });

  it('gom theo lý do, nhiều nhất lên đầu, kèm tên đơn để đi tìm', () => {
    const r = tomTatHangDoiHong([
      ev({ orderId: 'a', brandReference: '#KLS1' }),
      ev({ orderId: 'b', brandReference: '#KLS2' }),
      ev({ orderId: 'c', brandReference: '#KLS3', lastError: 'http 409', lastHttpStatus: 409 }),
    ], new Map());
    expect(r.tong).toBe(3);
    expect(r.nhom[0].lyDo).toBe('unknown brandSlug: tinh-atelier');
    expect(r.nhom[0].so).toBe(2);
    expect(r.nhom[0].don).toEqual(['#KLS1', '#KLS2']);
  });

  it('không có mã shop thì hiện mã đơn — đừng để trống', () => {
    expect(tomTatHangDoiHong([ev({ brandReference: null })], new Map()).nhom[0].don).toEqual(['26-INSLG-SV-0001']);
  });

  it('giữ mốc CŨ NHẤT — "kẹt bao lâu rồi" mới là thứ thúc người ta làm', () => {
    const r = tomTatHangDoiHong([
      ev({ orderId: 'a', occurredAt: d('2026-09-18T00:00:00Z') }),
      ev({ orderId: 'b', occurredAt: d('2026-09-02T00:00:00Z') }),
    ], new Map());
    expect(r.cuNhat).toEqual(d('2026-09-02T00:00:00Z'));
  });

  it('hàng đợi sạch → tổng 0, không có mốc', () => {
    expect(tomTatHangDoiHong([], new Map())).toEqual({ tong: 0, nhom: [], cuNhat: null });
  });
});
