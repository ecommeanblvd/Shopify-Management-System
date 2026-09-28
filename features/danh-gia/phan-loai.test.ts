import { describe, it, expect } from 'vitest';
import {
  TRANG_THAI, soSaoHopLe, mapTrang, nhanTrang, mapTrangThai, nhanTrangThai,
  daXuLy, mapKenh, nhanKenh, locQuocGia, maDanhGia,
} from './phan-loai';

describe('soSaoHopLe', () => {
  it('nhận số nguyên 1–5', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(soSaoHopLe(n)).toBe(true);
    expect(soSaoHopLe('5')).toBe(true);
  });

  it('từ chối ngoài khoảng, số thập phân và rác', () => {
    expect(soSaoHopLe(0)).toBe(false);
    expect(soSaoHopLe(6)).toBe(false);
    expect(soSaoHopLe(4.5)).toBe(false); // nửa sao không tồn tại, đây là dữ liệu sai
    expect(soSaoHopLe('')).toBe(false);
    expect(soSaoHopLe(null)).toBe(false);
    expect(soSaoHopLe('năm')).toBe(false);
  });
});

describe('mapTrang', () => {
  it('nhận cả cách viết sai "Truspilot" trong tên bảng Lark', () => {
    expect(mapTrang('Trustpilot')).toBe('trustpilot');
    expect(mapTrang('Truspilot')).toBe('trustpilot');
    expect(mapTrang('Judge.me')).toBe('judge_me');
    expect(mapTrang('judge me')).toBe('judge_me');
  });

  it('TRỐNG trả null, không ép về "khác" — 40% dòng Lark để trống cột này', () => {
    expect(mapTrang('')).toBeNull();
    expect(mapTrang(null)).toBeNull();
  });

  it('trang lạ về "khac"', () => {
    expect(mapTrang('Google Reviews')).toBe('khac');
  });

  it('nhãn không nổ', () => {
    expect(nhanTrang('judge_me')).toBe('Judge.me');
    expect(nhanTrang(null)).toBe('—');
  });
});

describe('trạng thái', () => {
  it('giữ đủ 9 trạng thái do Trustpilot định nghĩa', () => {
    expect(TRANG_THAI).toHaveLength(9);
    expect(new Set(TRANG_THAI.map((t) => t.ma)).size).toBe(9);
  });

  it('dịch từ giá trị Lark', () => {
    expect(mapTrangThai('Responded')).toBe('responded');
    expect(mapTrangThai('Pending Customer Feedback')).toBe('pending_customer_feedback');
    expect(mapTrangThai('Request Info')).toBe('request_info');
    expect(mapTrangThai('Archived')).toBe('archived');
  });

  it('trống hoặc lạ trả null', () => {
    expect(mapTrangThai('')).toBeNull();
    expect(mapTrangThai(null)).toBeNull();
    expect(mapTrangThai('Đang xem')).toBeNull();
  });

  it('chỉ responded và archived là đã xử lý; TRỐNG là chưa', () => {
    expect(daXuLy('responded')).toBe(true);
    expect(daXuLy('archived')).toBe(true);
    expect(daXuLy('pending_customer_feedback')).toBe(false);
    expect(daXuLy('request_info')).toBe(false);
    // 7/45 dòng Lark để trống — thà hiện ra để CX rà còn hơn coi là xong.
    expect(daXuLy(null)).toBe(false);
  });

  it('nhãn nói rõ "chưa ghi" khi trống', () => {
    expect(nhanTrangThai('archived')).toBe('Đã lưu trữ');
    expect(nhanTrangThai(null)).toBe('chưa ghi');
    expect(nhanTrangThai('la')).toBe('la');
  });
});

describe('mapKenh', () => {
  it('bốn kênh của Lark', () => {
    expect(mapKenh('Email')).toBe('email');
    expect(mapKenh('Facebook')).toBe('facebook');
    expect(mapKenh('Instagram')).toBe('instagram');
    expect(mapKenh('WhatsApp')).toBe('whatsapp');
  });
  it('trống hoặc lạ trả null', () => {
    expect(mapKenh('')).toBeNull();
    expect(mapKenh(null)).toBeNull();
    expect(mapKenh('Zalo')).toBeNull();
  });
  it('nhãn', () => {
    expect(nhanKenh('whatsapp')).toBe('WhatsApp');
    expect(nhanKenh(null)).toBe('—');
  });
});

describe('locQuocGia — bỏ chuỗi 75 nước của lookup hỏng', () => {
  it('bỏ ĐÚNG chuỗi rác thật của Lark', () => {
    const rac = "Qatar,Italy,Saudi Arabia,United States,South Africa,Angola,"
      + "United Arab Emirates,Kuwait,Canada,Georgia,Philippines,United Kingdom,"
      + "Singapore,Indonesia,Lao People's Democratic Republic,Taiwan,Germany,Japan,"
      + "Malaysia,France,Bahamas,Bahrain,Oman,Hong Kong,Australia,Jordan,Rwanda";
    expect(locQuocGia(rac)).toBeNull();
  });

  it('GIỮ tên nước thật, kể cả tên dài nhiều từ', () => {
    expect(locQuocGia('United States')).toBe('United States');
    expect(locQuocGia('Saudi Arabia')).toBe('Saudi Arabia');
    // Hai tên dài nhất trong danh sách — không tên nào chứa dấu phẩy.
    expect(locQuocGia("Lao People's Democratic Republic")).toBe("Lao People's Democratic Republic");
    expect(locQuocGia('Trinidad and Tobago')).toBe('Trinidad and Tobago');
  });

  it('trim khoảng trắng, trống trả null', () => {
    expect(locQuocGia('  Australia  ')).toBe('Australia');
    expect(locQuocGia('')).toBeNull();
    expect(locQuocGia('   ')).toBeNull();
    expect(locQuocGia(null)).toBeNull();
  });
});

describe('maDanhGia', () => {
  it('đệm 4 chữ số', () => {
    expect(maDanhGia(1)).toBe('DG-0001');
    expect(maDanhGia(46)).toBe('DG-0046');
    expect(maDanhGia(12345)).toBe('DG-12345');
  });
});
