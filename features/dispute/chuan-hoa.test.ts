import { describe, it, expect } from 'vitest';
import {
  mapTrangThai, mapLyDo, mapCongThanhToan, mapLoai, dangMo,
  conBaoNhieuNgay, capBaoDong, nhanLyDo, nhanCong,
} from './chuan-hoa';

describe('mapTrangThai', () => {
  it('nhận đúng giá trị Shopify', () => {
    expect(mapTrangThai('NEEDS_RESPONSE')).toBe('needs_response');
    expect(mapTrangThai('UNDER_REVIEW')).toBe('under_review');
    expect(mapTrangThai('WON')).toBe('won');
    expect(mapTrangThai('LOST')).toBe('lost');
    expect(mapTrangThai('ACCEPTED')).toBe('accepted');
    expect(mapTrangThai('CHARGE_REFUNDED')).toBe('charge_refunded');
  });

  it('dịch giá trị chép tay của Lark', () => {
    expect(mapTrangThai('Open')).toBe('needs_response');
    expect(mapTrangThai('Under Review')).toBe('under_review');
    expect(mapTrangThai('Closed')).toBe('closed');
    expect(mapTrangThai('Won')).toBe('won');
  });

  it('trả null với giá trị lạ — nơi gọi quyết định, không âm thầm coi là đã đóng', () => {
    expect(mapTrangThai('Pending')).toBeNull();
    expect(mapTrangThai('')).toBeNull();
    expect(mapTrangThai(null)).toBeNull();
    expect(mapTrangThai(undefined)).toBeNull();
  });

  it('chỉ needs_response và under_review là còn phải làm', () => {
    expect(dangMo('needs_response')).toBe(true);
    expect(dangMo('under_review')).toBe(true);
    expect(dangMo('lost')).toBe(false);
    expect(dangMo('closed')).toBe(false);
  });
});

describe('mapLyDo', () => {
  it('gộp các cách gọi khác nhau của Lark về một mã', () => {
    expect(mapLyDo('Item not received')).toBe('product_not_received');
    expect(mapLyDo('Product not received')).toBe('product_not_received');
    expect(mapLyDo('Product unacceptable')).toBe('product_unacceptable');
    expect(mapLyDo('Item not as described')).toBe('product_unacceptable');
    expect(mapLyDo('Credit not processed')).toBe('credit_not_processed');
    expect(mapLyDo('Missing refund or credit')).toBe('credit_not_processed');
    expect(mapLyDo('Duplicate payment')).toBe('duplicate');
  });

  it('nhận cả lỗi gõ "Fradulent" của chính bảng Lark', () => {
    expect(mapLyDo('Fradulent')).toBe('fraudulent');
    expect(mapLyDo('Unauthorized transaction')).toBe('fraudulent');
    expect(mapLyDo('Did not authorize')).toBe('fraudulent');
  });

  it('lý do Shopify chỉ hạ chữ thường', () => {
    expect(mapLyDo('FRAUDULENT')).toBe('fraudulent');
    expect(mapLyDo('PRODUCT_NOT_RECEIVED')).toBe('product_not_received');
    expect(mapLyDo('CREDIT_NOT_PROCESSED')).toBe('credit_not_processed');
  });

  it('lý do LẠ giữ nguyên, KHÔNG ép về khac — Shopify thêm lý do mới là chuyện thường', () => {
    expect(mapLyDo('SOME_NEW_REASON')).toBe('some_new_reason');
    expect(mapLyDo('Bank cannot process')).toBe('bank_cannot_process');
  });

  it('trống trả null', () => {
    expect(mapLyDo('')).toBeNull();
    expect(mapLyDo('  ')).toBeNull();
    expect(mapLyDo(null)).toBeNull();
  });

  it('nhãn không nổ với mã lạ', () => {
    expect(nhanLyDo('fraudulent')).toBe('Giao dịch gian lận');
    expect(nhanLyDo('some_new_reason')).toBe('some_new_reason');
    expect(nhanLyDo(null)).toBe('—');
  });
});

describe('mapCongThanhToan', () => {
  it('Stripes và "Stripes mới" là CÙNG một cổng', () => {
    expect(mapCongThanhToan('Stripes')).toBe('stripe');
    expect(mapCongThanhToan('Stripes mới')).toBe('stripe');
    expect(mapCongThanhToan('Stripe')).toBe('stripe');
  });

  it('nhận Shopify payment và Paypal', () => {
    expect(mapCongThanhToan('Shopify payment')).toBe('shopify_payments');
    expect(mapCongThanhToan('shopify_payments')).toBe('shopify_payments');
    expect(mapCongThanhToan('Paypal')).toBe('paypal');
  });

  it('trống hoặc lạ trả null — bảng Lark có 1 dòng trống cổng', () => {
    expect(mapCongThanhToan('')).toBeNull();
    expect(mapCongThanhToan(null)).toBeNull();
    expect(mapCongThanhToan('Momo')).toBeNull();
  });

  it('nhãn đọc được', () => {
    expect(nhanCong('shopify_payments')).toBe('Shopify Payments');
    expect(nhanCong(null)).toBe('—');
  });
});

describe('mapLoai', () => {
  it('inquiry giữ nguyên, còn lại là chargeback', () => {
    expect(mapLoai('INQUIRY')).toBe('inquiry');
    expect(mapLoai('CHARGEBACK')).toBe('chargeback');
    expect(mapLoai(null)).toBe('chargeback');
  });
});

describe('conBaoNhieuNgay', () => {
  const moc = new Date('2026-09-27T10:00:00Z');

  it('làm tròn LÊN — còn 6 tiếng vẫn là 1 ngày, không phải 0', () => {
    expect(conBaoNhieuNgay(new Date('2026-09-27T16:00:00Z'), moc)).toBe(1);
  });

  it('đếm đúng số ngày còn lại', () => {
    expect(conBaoNhieuNgay(new Date('2026-10-04T10:00:00Z'), moc)).toBe(7);
  });

  it('quá hạn thì âm', () => {
    expect(conBaoNhieuNgay(new Date('2026-09-20T10:00:00Z'), moc)).toBe(-7);
  });

  it('không có hạn thì null', () => {
    expect(conBaoNhieuNgay(null, moc)).toBeNull();
  });
});

describe('capBaoDong', () => {
  it('đã nộp bằng chứng thì không báo động dù hạn đã qua', () => {
    expect(capBaoDong(-5, true)).toBe('binh_thuong');
    expect(capBaoDong(1, true)).toBe('binh_thuong');
  });

  it('chưa nộp: quá hạn / gấp (≤3 ngày) / sắp (≤7) / bình thường', () => {
    expect(capBaoDong(-1, false)).toBe('qua_han');
    expect(capBaoDong(0, false)).toBe('gap');
    expect(capBaoDong(3, false)).toBe('gap');
    expect(capBaoDong(4, false)).toBe('sap');
    expect(capBaoDong(7, false)).toBe('sap');
    expect(capBaoDong(8, false)).toBe('binh_thuong');
  });

  it('không có hạn thì nói rõ là không có, không giả vờ bình thường', () => {
    expect(capBaoDong(null, false)).toBe('khong_han');
  });
});
