import { describe, it, expect } from 'vitest';
import { nenGiuHang, trangThaiMoHoSo, trangThaiMoDong } from './nen-giu-hang';

describe('nenGiuHang', () => {
  it('đơn CHƯA giao thì giữ hàng — đây là việc bình thường', () => {
    expect(nenGiuHang('UNFULFILLED', null)).toBe(true);
  });

  it('đơn ĐÃ GIAO thì KHÔNG giữ — lỗi làm 55 món kẹt trên kệ', () => {
    /* Lượt nạp 3.238 đơn lịch sử 2025 giữ hàng cho đơn đã giao xong từ 2024–2025. Hàng nằm
       trên kệ nhưng bị đánh dấu "đã bán", và mọi màn tính tồn khả dụng đều thấy thiếu. */
    expect(nenGiuHang('FULFILLED', null)).toBe(false);
  });

  it('giao MỘT PHẦN thì VẪN GIỮ — phần còn lại vẫn phải bốc', () => {
    // Chặn cả ca này là làm kho không lấy được hàng cho phần chưa đi: hỏng việc thật để
    // chữa một việc ảo. Đo production: 126 đơn đang ở trạng thái này.
    expect(nenGiuHang('PARTIALLY_FULFILLED', null)).toBe(true);
  });

  it('đơn HUỶ thì không giữ — luật cũ, không được làm hỏng', () => {
    expect(nenGiuHang('UNFULFILLED', new Date())).toBe(false);
    expect(nenGiuHang('FULFILLED', new Date())).toBe(false);
  });

  it('không biết chắc thì VẪN GIỮ — bỏ sót đơn chờ bốc tốn hơn giữ oan một món', () => {
    /* Giữ oan thì nhả ra được; còn hàng bị đơn khác lấy mất thì phải đi mua lại. */
    expect(nenGiuHang(null, null)).toBe(true);
    expect(nenGiuHang('', null)).toBe(true);
    expect(nenGiuHang('TRẠNG THÁI LẠ', null)).toBe(true);
  });

  it('không phân biệt hoa thường hay khoảng trắng thừa', () => {
    // Giá trị đến từ Shopify và từ nhập tay; so cứng chuỗi là bỏ lọt ca thật.
    expect(nenGiuHang('fulfilled', null)).toBe(false);
    expect(nenGiuHang('  Fulfilled  ', null)).toBe(false);
  });
});

describe('trangThaiMoHoSo / trangThaiMoDong — hồ sơ mới mở ở đâu', () => {
  it('đơn đã giao mở thẳng ở "shipped", KHÔNG vào hàng đợi việc', () => {
    /* `received` và `ready_to_pick` là HÀNG ĐỢI VIỆC của kho. Lượt nạp 30/09 đẩy 19 đơn đã
       giao vào `received` và 16 đơn vào `ready_to_pick` — kho mở màn thấy việc phải bốc hàng
       cho đơn năm ngoái. */
    expect(trangThaiMoHoSo('FULFILLED')).toBe('shipped');
    expect(trangThaiMoDong('FULFILLED')).toBe('shipped');
  });

  it('đơn chưa giao / giao một phần vẫn mở ở hàng đợi như cũ', () => {
    for (const s of ['UNFULFILLED', 'PARTIALLY_FULFILLED', null, '']) {
      expect(trangThaiMoHoSo(s)).toBe('received');
      expect(trangThaiMoDong(s)).toBe('pending_check');
    }
  });

  it('dòng đơn đã giao KHÔNG mở ở "pending_check" — đó là thứ bộ cấp hàng đi tìm', () => {
    // Hai chốt chồng nhau có chủ ý: kể cả nếu ai bỏ chốt ở `allocateOrder`, dòng `shipped`
    // vẫn không lọt vào bộ lọc `pending_check` của nó.
    expect(trangThaiMoDong('FULFILLED')).not.toBe('pending_check');
  });
});
