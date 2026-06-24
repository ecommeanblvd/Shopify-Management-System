import { describe, expect, it } from 'vitest';
import { parseQcRow, reduceQcStatus } from './parse-qc-row';

describe('parseQcRow', () => {
  it('đọc Order Number final + QC Check', () => {
    expect(parseQcRow({ 'Order Number final': '#MBLVD29248', 'QC Check': 'QC Pass' }))
      .toEqual({ orderNumber: '#MBLVD29248', qcCheck: 'QC Pass' });
  });
  it('thiếu field → null', () => {
    expect(parseQcRow({})).toEqual({ orderNumber: null, qcCheck: null });
  });
});

describe('reduceQcStatus', () => {
  it('ưu tiên Failed > chưa-QC > Pass > Gửi dư', () => {
    expect(reduceQcStatus(['QC Pass', 'QC Failed', 'Tiếp nhận - chưa QC'])).toBe('fail');
    expect(reduceQcStatus(['QC Pass', 'Tiếp nhận - chưa QC'])).toBe('pending');
    expect(reduceQcStatus(['QC Pass', 'Gửi dư'])).toBe('pass');
    expect(reduceQcStatus(['Gửi dư'])).toBe('extra');
  });
  it('rỗng / không khớp → null', () => {
    expect(reduceQcStatus([])).toBeNull();
    expect(reduceQcStatus([null, 'gì đó lạ'])).toBeNull();
  });
});
