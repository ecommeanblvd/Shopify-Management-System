import { describe, expect, it } from 'vitest';
import { parseQcRow, mapQcCheck, latestQcCheck } from './parse-qc-row';

describe('parseQcRow', () => {
  it('đọc Order Number final + QC Check', () => {
    expect(parseQcRow({ 'Order Number final': '#MBLVD29248', 'QC Check': 'QC Pass' }))
      .toEqual({ orderNumber: '#MBLVD29248', qcCheck: 'QC Pass' });
  });
  it('thiếu field → null', () => {
    expect(parseQcRow({})).toEqual({ orderNumber: null, qcCheck: null });
  });
});

describe('mapQcCheck', () => {
  it('map từng giá trị QC Check → status', () => {
    expect(mapQcCheck('QC Failed')).toBe('fail');
    expect(mapQcCheck('Tiếp nhận - chưa QC')).toBe('pending');
    expect(mapQcCheck('QC Pass')).toBe('pass');
    expect(mapQcCheck('Gửi dư')).toBe('extra');
    expect(mapQcCheck('lạ')).toBeNull();
    expect(mapQcCheck(null)).toBeNull();
  });
});

describe('latestQcCheck', () => {
  it('QC fail (cũ) + QC pass (mới) → lấy pass theo createdTime', () => {
    expect(latestQcCheck([
      { qcCheck: 'QC Failed', createdTime: 100 },
      { qcCheck: 'QC Pass', createdTime: 200 },
    ])).toBe('QC Pass');
  });
  it('bỏ qua record qcCheck null, lấy non-null mới nhất', () => {
    expect(latestQcCheck([
      { qcCheck: 'QC Pass', createdTime: 300 },
      { qcCheck: null, createdTime: 400 },
    ])).toBe('QC Pass');
  });
  it('rỗng / toàn null → null', () => {
    expect(latestQcCheck([])).toBeNull();
    expect(latestQcCheck([{ qcCheck: null, createdTime: 1 }])).toBeNull();
  });
});
