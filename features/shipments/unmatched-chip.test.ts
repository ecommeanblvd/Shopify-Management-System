import { describe, expect, it } from 'vitest';
import { tomTatChip, gopMaTheoDon } from './unmatched-chip';
import type { UnmatchedBilledRow } from './unmatched-billed';

const row = (o: Partial<UnmatchedBilledRow>): UnmatchedBilledRow => ({
  tracking: 't', billNumber: null, carrierKey: 'fedex', accountId: 'a', accountName: 'A',
  amountVnd: null, billPeriodStart: null, shipHoCode: null, returnOfOrderNumber: null, ...o,
});

describe('tomTatChip', () => {
  it('đếm số dòng và cộng tiền', () => {
    const t = tomTatChip([row({ amountVnd: 1000 }), row({ amountVnd: 2500 })]);
    expect(t).toEqual({ soDong: 2, tongVnd: 3500 });
  });

  it('dòng thiếu số tiền vẫn được đếm, coi tiền là 0', () => {
    expect(tomTatChip([row({ amountVnd: null }), row({ amountVnd: 500 })])).toEqual({ soDong: 2, tongVnd: 500 });
  });

  it('không có dòng nào thì về 0', () => {
    expect(tomTatChip([])).toEqual({ soDong: 0, tongVnd: 0 });
  });
});

describe('gopMaTheoDon', () => {
  // Bảng kê một kỳ có 60 mã ship hộ; in hết ra chiếm gần nửa màn hình. Gom
  // theo đơn để đóng lại thì chỉ còn một dòng.
  it('gom nhiều tracking của cùng một đơn thành một mục', () => {
    const r = gopMaTheoDon([
      row({ tracking: 't1', shipHoCode: 'SV-0012' }),
      row({ tracking: 't2', shipHoCode: 'SV-0012' }),
      row({ tracking: 't3', shipHoCode: 'SV-0011' }),
    ], (x) => x.shipHoCode);
    expect(r).toEqual([
      { ma: 'SV-0011', soTracking: 1, tongVnd: 0 },
      { ma: 'SV-0012', soTracking: 2, tongVnd: 0 },
    ]);
  });

  it('cộng tiền theo từng đơn', () => {
    const r = gopMaTheoDon([
      row({ returnOfOrderNumber: '#A', amountVnd: 1000 }),
      row({ returnOfOrderNumber: '#A', amountVnd: 500 }),
      row({ returnOfOrderNumber: '#B', amountVnd: 300 }),
    ], (x) => x.returnOfOrderNumber);
    expect(r).toEqual([
      { ma: '#A', soTracking: 2, tongVnd: 1500 },
      { ma: '#B', soTracking: 1, tongVnd: 300 },
    ]);
  });

  it('sắp theo mã để danh sách ổn định giữa các lần tải trang', () => {
    const r = gopMaTheoDon([
      row({ shipHoCode: 'SV-0030' }), row({ shipHoCode: 'SV-0002' }), row({ shipHoCode: 'SV-0011' }),
    ], (x) => x.shipHoCode);
    expect(r.map((x) => x.ma)).toEqual(['SV-0002', 'SV-0011', 'SV-0030']);
  });

  it('bỏ qua dòng không có mã', () => {
    expect(gopMaTheoDon([row({ shipHoCode: null })], (x) => x.shipHoCode)).toEqual([]);
  });
});
