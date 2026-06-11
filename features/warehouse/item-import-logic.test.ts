import { describe, expect, it } from 'vitest';
import { mapStockStatus, mapWarehouseCode } from './item-import-logic';

describe('item-import-logic', () => {
  it('map kho từ cột "HN | GVM"', () => { expect(mapWarehouseCode('HN | GVM')).toBe('GVM'); expect(mapWarehouseCode('SG | DM')).toBe('DM'); });
  it('map status', () => {
    expect(mapStockStatus({ qc: 'QC Failed', action: 'Lưu kho', exportDate: 'Chưa xuất đơn' })).toBe('qc_failed');
    expect(mapStockStatus({ qc: 'QC Pass', action: 'Tạm nhập (đi đơn)', exportDate: 'Chưa xuất đơn' })).toBe('staging');
    expect(mapStockStatus({ qc: 'QC Pass', action: 'Lưu kho', exportDate: '2026/03/19' })).toBe('shipped');
    expect(mapStockStatus({ qc: 'QC Pass', action: 'Lưu kho', exportDate: 'Chưa xuất đơn' })).toBe('in_stock');
  });
});
