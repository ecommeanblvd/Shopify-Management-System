import { describe, it, expect } from 'vitest';
import { filterWorklist, queryTokens, normalizeText } from './worklist-search';

const rows = [
  { orderNumber: '#MBLVD29431', storeName: 'MEAN BLVD', tracks: [{ trackingNumber: '874588278487' }] },
  { orderNumber: 'TA1225', storeName: 'Tinh Atelier', tracks: [] },
  { orderNumber: '#MIR1019', storeName: 'Mirer', tracks: [{ trackingNumber: '111222333' }, { trackingNumber: '999888777' }] },
  { orderNumber: null, storeName: null, tracks: [] },
];

describe('normalizeText', () => {
  it('bỏ dấu tiếng Việt + hạ chữ thường', () => {
    expect(normalizeText('Tinh Atelier — Đơn')).toContain('don');
    expect(normalizeText('MEAN BLVD')).toBe('mean blvd');
  });
  it("bỏ '#' để gõ có hay không dấu thăng đều khớp", () => {
    expect(normalizeText('#MBLVD29431')).toBe('mblvd29431');
  });
});

describe('filterWorklist', () => {
  it('query rỗng / chỉ khoảng trắng → giữ nguyên toàn bộ', () => {
    expect(filterWorklist(rows, '')).toHaveLength(4);
    expect(filterWorklist(rows, '   ')).toHaveLength(4);
  });
  it('tìm theo mã đơn — có hoặc không có #, hoa hay thường', () => {
    expect(filterWorklist(rows, 'MBLVD29431')).toHaveLength(1);
    expect(filterWorklist(rows, '#mblvd29431')).toHaveLength(1);
    expect(filterWorklist(rows, 'ta1225')[0].orderNumber).toBe('TA1225');
  });
  it('tìm theo TRACKING number (kể cả đơn nhiều kiện)', () => {
    expect(filterWorklist(rows, '874588278487')[0].orderNumber).toBe('#MBLVD29431');
    expect(filterWorklist(rows, '999888777')[0].orderNumber).toBe('#MIR1019');
  });
  it('tìm theo tên store, bỏ dấu vẫn khớp', () => {
    expect(filterWorklist(rows, 'mirer')).toHaveLength(1);
    expect(filterWorklist(rows, 'tinh atelier')).toHaveLength(1);
  });
  it('nhiều từ khoá = AND (lọc hẹp dần)', () => {
    expect(filterWorklist(rows, 'mean 29431')).toHaveLength(1);
    expect(filterWorklist(rows, 'mean tinh')).toHaveLength(0);
  });
  it('khớp một phần (gõ dở vẫn ra)', () => {
    expect(filterWorklist(rows, '2943')).toHaveLength(1);
    expect(filterWorklist(rows, '8745')).toHaveLength(1);
  });
  it('không khớp gì → mảng rỗng', () => {
    expect(filterWorklist(rows, 'khongtontai')).toHaveLength(0);
  });
  it('dòng thiếu mã đơn/store (null) không làm vỡ tìm kiếm', () => {
    expect(() => filterWorklist(rows, 'x')).not.toThrow();
  });
  it('queryTokens tách đúng số từ khoá', () => {
    expect(queryTokens('  mean   29431 ')).toEqual(['mean', '29431']);
    expect(queryTokens('')).toEqual([]);
  });
});
