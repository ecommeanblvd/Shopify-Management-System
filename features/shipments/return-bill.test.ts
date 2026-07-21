import { describe, it, expect } from 'vitest';
import { parseReturnRef } from './return-bill';

describe('parseReturnRef', () => {
  it('suffix _R (kể cả khoảng trắng lẫn trong) → đơn gốc, bỏ #', () => {
    expect(parseReturnRef('#MBLVD28712_ R')).toEqual({ kind: 'order', orderNumber: 'MBLVD28712' });
    expect(parseReturnRef('TA2186_R')).toEqual({ kind: 'order', orderNumber: 'TA2186' });
    expect(parseReturnRef('#MBLVD28712_R ')).toEqual({ kind: 'order', orderNumber: 'MBLVD28712' });
  });
  it('RETURN OF <tracking> → tracking chiều đi', () => {
    expect(parseReturnRef('RETURN OF 872181045003')).toEqual({ kind: 'tracking', trackingNumber: '872181045003' });
    expect(parseReturnRef('return of 872181045003')).toEqual({ kind: 'tracking', trackingNumber: '872181045003' });
  });
  it('orderRef thường / kết thúc R không có _ / rỗng → null (không nhận nhầm)', () => {
    expect(parseReturnRef('#MBLVD28712')).toBeNull();
    expect(parseReturnRef('26-INSLG-SV-0751')).toBeNull();
    expect(parseReturnRef('ORDER-R')).toBeNull(); // có '-' không phải '_'
    expect(parseReturnRef('SUMMER')).toBeNull();
    expect(parseReturnRef(null)).toBeNull();
    expect(parseReturnRef('')).toBeNull();
  });
});
