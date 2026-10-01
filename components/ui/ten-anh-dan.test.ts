import { describe, it, expect } from 'vitest';
import { datTenAnhDan } from './ten-anh-dan';

const anh = (ten: string, kieu = 'image/png') => new File([new Uint8Array([1])], ten, { type: kieu });

describe('datTenAnhDan', () => {
  it('ảnh người ta tự chọn thì GIỮ NGUYÊN tên — tên đó có nghĩa', () => {
    const f = anh('ao-bung-chi.jpg', 'image/jpeg');
    expect(datTenAnhDan(f, 1759300000000)).toBe(f);
  });

  /* image.png là tên Zalo/clipboard trả về. Giữ nguyên là một loạt ảnh lỗi QC cùng tên
     chồng nhau, không ai phân biệt được chiếc nào. */
  it('ảnh dán từ clipboard (image.png) → đặt lại theo thời điểm', () => {
    expect(datTenAnhDan(anh('image.png'), 1759300000000).name).toBe('dan-1759300000000.png');
  });

  it('tên rỗng cũng đặt lại', () => {
    expect(datTenAnhDan(anh(''), 1759300000000).name).toBe('dan-1759300000000.png');
  });

  it('jpeg ra đuôi jpg, và GIỮ kiểu MIME gốc — MIME mới là thứ máy chủ dùng', () => {
    const j = datTenAnhDan(anh('image.png', 'image/jpeg'), 7);
    expect(j.name).toBe('dan-7.jpg');
    expect(j.type).toBe('image/jpeg');
  });

  it('webp giữ đúng đuôi webp', () => {
    expect(datTenAnhDan(anh('image.png', 'image/webp'), 7).name).toBe('dan-7.webp');
  });

  /* Bản inline cũ lấy thẳng `type.split('/')[1]` nên ra `dan-7.octet-stream` và
     `dan-7.svg+xml` — tên rác không ai thấy cho tới lúc mở storage. */
  it('MIME không phải ảnh, hoặc đuôi có ký tự lạ → về png', () => {
    expect(datTenAnhDan(anh('image.png', 'application/octet-stream'), 7).name).toBe('dan-7.png');
    expect(datTenAnhDan(anh('image.png', 'image/svg+xml'), 7).name).toBe('dan-7.png');
    expect(datTenAnhDan(anh('image.png', ''), 7).name).toBe('dan-7.png');
  });
});
