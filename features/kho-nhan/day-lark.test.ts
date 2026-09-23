import { describe, it, expect } from 'vitest';
import { docCheDoGhi, duocGhi } from './day-lark';

describe('chế độ ghi Lark', () => {
  it('dry / trống / chon:', () => {
    expect(docCheDoGhi('dry')).toEqual({ kieu: 'dry' });
    expect(docCheDoGhi(undefined)).toEqual({ kieu: 'that' });
    expect(docCheDoGhi('')).toEqual({ kieu: 'that' });
    expect(docCheDoGhi('chon:dd1,dd2')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
    expect(docCheDoGhi(' CHON: dd1 , dd2 ')).toEqual({ kieu: 'chon', dinhDanhs: ['dd1', 'dd2'] });
  });
  it('chỉ món khai tên mới ghi thật', () => {
    const c = docCheDoGhi('chon:dd1');
    expect(duocGhi(c, 'dd1')).toBe(true);
    expect(duocGhi(c, 'dd2')).toBe(false);
    expect(duocGhi({ kieu: 'dry' }, 'dd1')).toBe(false);
    expect(duocGhi({ kieu: 'that' }, 'dd2')).toBe(true);
  });
  it('chon: rỗng → coi như dry, KHÔNG ghi gì', () => {
    expect(duocGhi(docCheDoGhi('chon:'), 'dd1')).toBe(false);
  });
});
