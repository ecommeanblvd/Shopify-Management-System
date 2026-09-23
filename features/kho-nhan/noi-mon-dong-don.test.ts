import { describe, it, expect } from 'vitest';
import { chonDongChoMon, maTemChoMon, type DongDonToiThieu } from './noi-mon-dong-don';

const d = (id: string, sku: string | null, daDung = false): DongDonToiThieu => ({ shopifyLineId: id, sku, daDung });

describe('chonDongChoMon', () => {
  it('khớp theo mã hàng', () => {
    expect(chonDongChoMon('A-1', [d('L1', 'B-2'), d('L2', 'A-1')])).toBe('L2');
  });
  it('đơn có HAI dòng cùng mã hàng → lấy dòng chưa ai dùng', () => {
    expect(chonDongChoMon('A-1', [d('L1', 'A-1', true), d('L2', 'A-1')])).toBe('L2');
  });
  it('mọi dòng cùng mã hàng đều đã dùng → null, không gán trùng', () => {
    expect(chonDongChoMon('A-1', [d('L1', 'A-1', true)])).toBeNull();
  });
  it('món không có mã hàng hoặc đơn không có dòng khớp → null', () => {
    expect(chonDongChoMon(null, [d('L1', 'A-1')])).toBeNull();
    expect(chonDongChoMon('X-9', [d('L1', 'A-1')])).toBeNull();
  });
});

describe('maTemChoMon', () => {
  it('ưu tiên dòng đơn, rồi biến thể, rồi mã kho', () => {
    expect(maTemChoMon({ shopifyLineId: '111', shopifyVariantId: '222', unitCode: 'WH-00000001' })).toBe('L:111');
    expect(maTemChoMon({ shopifyVariantId: '222', unitCode: 'WH-00000001' })).toBe('V:222');
    expect(maTemChoMon({ unitCode: 'WH-00000001' })).toBe('WH-00000001');
  });
  it('không có gì → null (màn phải cấp mã kho trước khi in)', () => {
    expect(maTemChoMon({})).toBeNull();
  });
});
