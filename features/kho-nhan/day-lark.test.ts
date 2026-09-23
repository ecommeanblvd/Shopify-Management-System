import { describe, it, expect } from 'vitest';
import { docCheDoGhi, duocGhi, GHI_THAT_TOAN_BO } from './day-lark';

describe('chế độ ghi Lark', () => {
  it('mặc định AN TOÀN: trống / chưa đặt / không nhận ra đều là dry — KHÔNG ghi thật', () => {
    expect(docCheDoGhi(undefined)).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi('')).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi('dry')).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi('xyz-khong-nhan-ra')).toEqual({ kieu: 'dry' });
  });
  it('chỉ đúng chuỗi GHI_THAT_TOAN_BO mới ghi thật mọi món', () => {
    expect(docCheDoGhi(GHI_THAT_TOAN_BO)).toEqual({ kieu: 'that' });
    expect(docCheDoGhi(GHI_THAT_TOAN_BO.toUpperCase())).toEqual({ kieu: 'that' });
    // Gõ gần đúng vẫn phải là dry — không có "gần đúng" cho việc ghi hàng loạt.
    expect(docCheDoGhi(`${GHI_THAT_TOAN_BO}!`)).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi(GHI_THAT_TOAN_BO.slice(0, -1))).toEqual({ kieu: 'dry' });
  });
  it('chon: — cả không dấu và có dấu (chọn:) đều nhận, không phân biệt hoa/thường', () => {
    expect(docCheDoGhi('chon:dd1,dd2')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
    expect(docCheDoGhi(' CHON: dd1 , dd2 ')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
    expect(docCheDoGhi('chọn:dd1,dd2')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
    expect(docCheDoGhi('CHỌN: dd1')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1'] });
  });
  it('gõ nhầm tiền tố chon:/chọn: (ví dụ thiếu một chữ) rơi về dry, KHÔNG ghi thật', () => {
    expect(docCheDoGhi('chonn:dd1')).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi('chn:dd1')).toEqual({ kieu: 'dry' });
  });
  it('chỉ món khai tên mới ghi thật', () => {
    const c = docCheDoGhi('chon:dd1');
    expect(duocGhi(c, 'dd1')).toBe(true);
    expect(duocGhi(c, 'dd2')).toBe(false);
    expect(duocGhi({ kieu: 'dry' }, 'dd1')).toBe(false);
    expect(duocGhi({ kieu: 'that' }, 'dd2')).toBe(true);
  });
  it('chon: rỗng → coi như dry, KHÔNG ghi gì', () => {
    expect(docCheDoGhi('chon:')).toEqual({ kieu: 'dry' });
    expect(duocGhi(docCheDoGhi('chon:'), 'dd1')).toBe(false);
  });
  it('chọn: dạng NFD (chữ rời + dấu tổ hợp, macOS hay gõ ra kiểu này) vẫn nhận y hệt NFC', () => {
    // Dựng tay từ mã điểm để CHẮC CHẮN là NFD, không phải dán một ký tự không nhìn được hình
    // thức thật — 'o' (U+006F) + dấu chấm dưới tổ hợp (U+0323) = 'ọ' dạng RỜI, khác 'ọ' NFC
    // (U+1ECD) mã nguồn day-lark.ts đang so khớp.
    const oNang_NFD = 'ọ'; // 'o' + combining dot below
    const choNFD = 'ch' + oNang_NFD + 'n:dd1'; // 'chọn:dd1' dạng NFD
    expect(choNFD.normalize('NFC')).toBe('chọn:dd1'); // xác nhận đúng là cùng chữ, khác dạng mã hoá
    expect(docCheDoGhi(choNFD)).toEqual({ kieu: 'chon', dinhDanhs: ['dd1'] });
  });
  it('chuỗi chỉ toàn khoảng trắng → dry, không phải "gõ gì đó" nên không suy diễn thành ghi thật', () => {
    expect(docCheDoGhi('   ')).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi('\n\t ')).toEqual({ kieu: 'dry' });
  });
  it('literal ghi thật kèm dòng mới cuối (Railway hay tự thêm) vẫn nhận; gần đúng kèm dòng mới thì KHÔNG', () => {
    expect(docCheDoGhi(`${GHI_THAT_TOAN_BO}\n`)).toEqual({ kieu: 'that' });
    expect(docCheDoGhi(`${GHI_THAT_TOAN_BO}!\n`)).toEqual({ kieu: 'dry' });
  });
});
