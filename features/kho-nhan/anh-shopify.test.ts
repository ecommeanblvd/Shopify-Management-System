import { describe, it, expect } from 'vitest';
import { anhChatLuongCao } from './anh-shopify';

const GOC = 'https://cdn.shopify.com/s/files/1/0123/4567/files/ao.jpg?v=1700000000';

describe('anhChatLuongCao', () => {
  it('thêm width, GIỮ nguyên tham số v (bỏ v là mất bản đúng phiên bản)', () => {
    const u = new URL(anhChatLuongCao(GOC, 2400));
    expect(u.searchParams.get('width')).toBe('2400');
    expect(u.searchParams.get('v')).toBe('1700000000');
  });

  it('URL đã có width thì THAY, không nối thêm cái thứ hai', () => {
    const r = anhChatLuongCao(`${GOC}&width=400`, 2400);
    expect(r.match(/width=/g)).toHaveLength(1);
    expect(new URL(r).searchParams.get('width')).toBe('2400');
  });

  /* Thêm tham số vào máy chủ khác có thể phá chữ ký URL → ảnh 404 giữa màn QC. */
  it('URL không phải CDN Shopify thì trả NGUYÊN', () => {
    const la = 'https://anh.brand-nao-do.com/a.jpg?sig=abc';
    expect(anhChatLuongCao(la, 2400)).toBe(la);
  });

  it('tên miền chứa chữ shopify nhưng không phải CDN thì cũng không đụng', () => {
    const gia = 'https://cdn.shopify.com.kevin.net/a.jpg';
    expect(anhChatLuongCao(gia, 2400)).toBe(gia);
  });

  it('URL méo thì trả nguyên, không ném giữa màn QC', () => {
    expect(anhChatLuongCao('', 2400)).toBe('');
    expect(anhChatLuongCao('khong-phai-url', 2400)).toBe('khong-phai-url');
  });
});
