import { describe, it, expect } from 'vitest';
import { matchCreditToDisputing } from './credit-note-match';

const disp = [
  { shipmentId: 's1', tracking: '111', claimedVnd: 100000, recoveredVnd: 0 },
  { shipmentId: 's2', tracking: '222', claimedVnd: 100000, recoveredVnd: 30000 },
];

describe('matchCreditToDisputing', () => {
  it('khớp đủ → fullyRecovered', () => {
    const r = matchCreditToDisputing([{ tracking: '111', creditVnd: 100000 }], disp);
    expect(r.matched).toEqual([{ shipmentId: 's1', tracking: '111', creditVnd: 100000, newRecovered: 100000, fullyRecovered: true }]);
    expect(r.unmatched).toEqual([]);
  });
  it('cộng dồn recovered hiện có; thiếu → fullyRecovered=false', () => {
    const r = matchCreditToDisputing([{ tracking: '222', creditVnd: 40000 }], disp);
    expect(r.matched[0]).toMatchObject({ shipmentId: 's2', newRecovered: 70000, fullyRecovered: false });
  });
  it('tracking không đang đòi → unmatched', () => {
    const r = matchCreditToDisputing([{ tracking: '999', creditVnd: 50000 }], disp);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toEqual([{ tracking: '999', creditVnd: 50000, reason: 'Không phải đơn đang đòi NCC' }]);
  });
  it('recovered vượt claimed → vẫn fullyRecovered, giữ số thực', () => {
    const r = matchCreditToDisputing([{ tracking: '111', creditVnd: 150000 }], disp);
    expect(r.matched[0]).toMatchObject({ newRecovered: 150000, fullyRecovered: true });
  });
});
