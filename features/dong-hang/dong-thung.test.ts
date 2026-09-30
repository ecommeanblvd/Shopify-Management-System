import { describe, it, expect } from 'vitest';
import { kiemNhapDongThung, canhBaoLechCan, CAN_KIEN_TOI_DA_KG, NGUONG_CANH_BAO } from './dong-thung';

const nhap = (p: Partial<Parameters<typeof kiemNhapDongThung>[0]> = {}) =>
  kiemNhapDongThung({ hop: 'MEAN-BOX-30x25x20', canKg: '1.2', dai: '', rong: '', cao: '', ...p });

describe('kiemNhapDongThung', () => {
  it('nhận thùng + cân, không bắt nhập kích thước', () => {
    // Nhiều kiện dùng túi, không có kích thước nào để đo — bắt nhập là bắt người ta bịa số.
    const r = nhap();
    expect(r.ok).toBe(true);
    expect(r.sach).toEqual({ hop: 'MEAN-BOX-30x25x20', canKg: 1.2, dai: null, rong: null, cao: null });
  });

  it('nhận dấu phẩy thập phân kiểu Việt', () => {
    expect(nhap({ canKg: '1,25' }).sach?.canKg).toBe(1.25);
  });

  it('BẮT BUỘC có cân — đó là lý do bước này tồn tại', () => {
    expect(nhap({ canKg: '' }).loi).toContain('Chưa cân cả kiện');
    expect(nhap({ canKg: '0' }).ok).toBe(false);
    expect(nhap({ canKg: 'nặng' }).ok).toBe(false);
  });

  it('BẮT BUỘC chọn thùng', () => {
    expect(nhap({ hop: '   ' }).loi).toContain('Chưa chọn thùng đã dùng');
  });

  it('cân vượt trần thì CẢNH BÁO gõ nhầm, không im lặng nhận', () => {
    const r = nhap({ canKg: String(CAN_KIEN_TOI_DA_KG + 1) });
    expect(r.ok).toBe(false);
    expect(r.loi.join(' ')).toContain('gõ nhầm');
  });

  it('kích thước nhập thì phải ĐỦ BA chiều', () => {
    /* Một chiều lẻ không tính được cân quy đổi, mà lưu nửa vời thì màn sau tưởng có dữ liệu. */
    expect(nhap({ dai: '30', rong: '25' }).ok).toBe(false);
    expect(nhap({ dai: '30', rong: '25', cao: '20' }).sach).toMatchObject({ dai: 30, rong: 25, cao: 20 });
  });

  it('gom HẾT lỗi một lượt, không bắt sửa từng cái một', () => {
    const r = nhap({ hop: '', canKg: '' });
    expect(r.loi.length).toBe(2);
  });
});

describe('canhBaoLechCan — nhắc, KHÔNG chặn', () => {
  it('lệch trong ngưỡng thì im', () => {
    expect(canhBaoLechCan(1.2, 1.1)).toBeNull();
    expect(canhBaoLechCan(1.1, 1.1)).toBeNull();
  });

  it('nặng hơn nhiều thì nhắc gõ nhầm', () => {
    expect(canhBaoLechCan(2, 1)).toContain('Nặng hơn dự kiến 100 %');
  });

  it('nhẹ hơn nhiều thì nhắc THIẾU MÓN — không phải lỗi gõ', () => {
    // Hai chiều lệch có nghĩa khác nhau: nặng hơn là gõ nhầm, nhẹ hơn là có thể sót món.
    expect(canhBaoLechCan(0.4, 1)).toContain('đã đủ món chưa');
  });

  it('không có dự kiến thì không nhắc bừa', () => {
    expect(canhBaoLechCan(1.2, null)).toBeNull();
    expect(canhBaoLechCan(1.2, 0)).toBeNull();
  });

  it('đúng mốc ngưỡng thì chưa nhắc — chỉ nhắc khi VƯỢT', () => {
    expect(canhBaoLechCan(1 + NGUONG_CANH_BAO, 1)).toBeNull();
  });
});
