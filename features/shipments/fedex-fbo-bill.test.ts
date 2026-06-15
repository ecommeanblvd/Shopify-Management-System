import { describe, expect, it } from 'vitest';
import { parseFboDate, groupFboIntoBills } from './fedex-fbo-bill';
import type { FboBilledRow } from './fedex-fbo-parse';

function mkRow(p: Partial<FboBilledRow>): FboBilledRow {
  return {
    awb: 'X', orderRef: null, invoiceNumber: null, invoiceDate: null, dueDate: null,
    shipDate: null, service: null, recipientCountry: null, weightKg: null,
    base: 0, discount: 0, fuel: 0, demand: 0, remote: 0, signature: 0,
    residential: 0, importHandling: 0, vat: 0, duty: 0, other: 0, total: 0, ...p,
  };
}

describe('parseFboDate', () => {
  it('"17-Jun-2025" → ISO', () => expect(parseFboDate('17-Jun-2025')).toBe('2025-06-17'));
  it('"01-Jan-2026" → ISO', () => expect(parseFboDate('01-Jan-2026')).toBe('2026-01-01'));
  it('chấp nhận sẵn ISO', () => expect(parseFboDate('2025-12-31')).toBe('2025-12-31'));
  it('rỗng/sai → null', () => {
    expect(parseFboDate('')).toBeNull();
    expect(parseFboDate('bừa')).toBeNull();
    expect(parseFboDate(null)).toBeNull();
  });
});

describe('groupFboIntoBills', () => {
  const rows: FboBilledRow[] = [
    mkRow({ awb: 'A1', invoiceNumber: '734001324', invoiceDate: '17-Jun-2025', dueDate: '07-Jul-2025',
      shipDate: '10-Jun-2025', orderRef: '#MBLVD24535', base: 1_371_600, discount: -672_084,
      fuel: 224_442, signature: 88_000, residential: 0, vat: 80_957, duty: 0, total: 1_092_915 }),
    mkRow({ awb: 'A2', invoiceNumber: '734001324', invoiceDate: '17-Jun-2025', dueDate: '07-Jul-2025',
      shipDate: '12-Jun-2025', base: 500_000, fuel: 50_000, importHandling: 30_000,
      duty: 100_000, total: 680_000 }),
    mkRow({ awb: 'B1', invoiceNumber: '734005000', invoiceDate: '24-Jun-2025', dueDate: '14-Jul-2025',
      shipDate: '20-Jun-2025', base: 200_000, total: 200_000 }),
  ];

  it('nhóm theo số hoá đơn', () => {
    const bills = groupFboIntoBills(rows);
    expect(bills).toHaveLength(2);
    expect(bills.map((b) => b.billNumber).sort()).toEqual(['734001324', '734005000']);
  });

  it('kỳ = range ngày ship, issue/due từ FBO, amount GỒM duty', () => {
    const b = groupFboIntoBills(rows).find((x) => x.billNumber === '734001324')!;
    expect(b.periodStart).toBe('2025-06-10');
    expect(b.periodEnd).toBe('2025-06-12');
    expect(b.issueDate).toBe('2025-06-17');
    expect(b.dueDate).toBe('2025-07-07');
    // amount = 1.092.915 + 680.000 (đã gồm duty 100.000 trong A2)
    expect(b.amount).toBe(1_772_915);
    expect(b.lines).toHaveLength(2);
  });

  it('line gộp residential→signature, (importHandling+duty+other)→other, total khớp', () => {
    const b = groupFboIntoBills(rows).find((x) => x.billNumber === '734001324')!;
    const a2 = b.lines.find((l) => l.awb === 'A2')!;
    expect(a2.other).toBe(130_000); // importHandling 30k + duty 100k
    expect(a2.total).toBe(680_000);
    // số học từng line khớp total
    for (const l of b.lines) {
      expect(l.base + l.discount + l.fuel + l.remote + l.demand + l.signature + l.vat + l.other)
        .toBe(l.total);
    }
  });

  it('đơn không số hoá đơn → gom 1 bill (billNumber null)', () => {
    const bills = groupFboIntoBills([mkRow({ awb: 'Z', total: 10 })]);
    expect(bills).toHaveLength(1);
    expect(bills[0].billNumber).toBeNull();
  });
});
