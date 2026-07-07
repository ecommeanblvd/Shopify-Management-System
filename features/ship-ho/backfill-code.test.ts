import { describe, it, expect } from 'vitest';
import { planCodeBackfill } from './backfill-code';

describe('planCodeBackfill', () => {
  it('đổi code→mmpRef cho đơn MMP khi khác nhau', () => {
    const r = planCodeBackfill([
      { id: 'a', code: 'SH1000', mmpRef: '26-INSLG-SV-0001', source: 'mmp' },
      { id: 'b', code: 'SH1001', mmpRef: '26-INSLG-SV-0002', source: 'mmp' },
    ]);
    expect(r.updates).toEqual([
      { id: 'a', from: 'SH1000', to: '26-INSLG-SV-0001' },
      { id: 'b', from: 'SH1001', to: '26-INSLG-SV-0002' },
    ]);
    expect(r.collisions).toEqual([]);
  });
  it('bỏ qua đơn nội bộ, đơn không mmpRef, đơn đã đúng code', () => {
    const r = planCodeBackfill([
      { id: 'c', code: '#KLS1983', mmpRef: null, source: 'internal' },
      { id: 'd', code: '26-INSLG-SV-0003', mmpRef: '26-INSLG-SV-0003', source: 'mmp' },
    ]);
    expect(r.updates).toEqual([]);
    expect(r.collisions).toEqual([]);
  });
  it('phát hiện trùng: mmpRef mới == code của đơn khác → collision, KHÔNG update', () => {
    const r = planCodeBackfill([
      { id: 'e', code: 'SH1004', mmpRef: '#KLS1983', source: 'mmp' },
      { id: 'f', code: '#KLS1983', mmpRef: null, source: 'internal' },
    ]);
    expect(r.updates).toEqual([]);
    expect(r.collisions).toEqual([{ id: 'e', mmpRef: '#KLS1983' }]);
  });
});
