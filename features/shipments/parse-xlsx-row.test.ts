import { describe, it, expect } from 'vitest';
import { parseXlsxRow, type Cell, type RawRow } from './parse-xlsx-row';
import { resolveColumns } from './xlsx-columns';

/** Build a row keyed by column index. Everything else is null. */
function rowFromIndex(values: Record<number, Cell>): RawRow {
  const max = Math.max(...Object.keys(values).map(Number)) + 1;
  const arr: Cell[] = new Array(max).fill(null);
  for (const [idx, v] of Object.entries(values)) arr[Number(idx)] = v;
  return arr;
}

/** MBLVD28959 row 22 — verified manually against the operator's Excel. */
const MBLVD28959_ROW: Record<number, Cell> = {
  4: '872518272457',                                    // tracking
  5: 'SG',                                              // origin hub
  6: 'FedEx',                                           // carrier
  8: '#MBLVD28959',                                     // order number
  12: 'United States',                                  // country
  15: new Date('2026-06-01'),                           // label date
  26: 'MEAN-BOX-40x31x2-CAR-02-VTĐG1-WH-25611',          // packaging code
  27: 0.7,                                              // weight
  28: '40x31x2',                                        // dim
  34: 1340167,                                          // total cost
  35: 2244600,                                          // published base
  36: 386937,                                           // fuel
  37: 82200,                                            // remote
  38: 68300,                                            // demand
  40: 99272,                                            // VAT
  42: '-1541142',                                       // discount (string from operator)
  46: 'PK-29103',                                       // log unique code
};

describe('parseXlsxRow', () => {
  it('parses a real FedEx US row (MBLVD28959 row 22)', () => {
    const r = parseXlsxRow(rowFromIndex(MBLVD28959_ROW));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row).toMatchObject({
      trackingNumber: '872518272457',
      orderNumber: 'MBLVD28959',
      storeHandle: 'meanblvd',
      carrier: 'fedex',
      shipCountry: 'US',
      actualWeightKg: 0.7,
      dimensions: { lengthCm: 40, widthCm: 31, heightCm: 2 },
      packagingType: 'box',
      logUniqueCode: 'PK-29103',
      originHub: 'SG',
      totalAmount: 1_340_167,
      base: 2_244_600,
      fuel: 386_937,
      remote: 82_200,
      demand: 68_300,
      directSignature: null,    // not on this row
      vat: 99_272,
      gogreen: null,
      discount: -1_541_142,     // ← stored negative
      elevatedRisk: null,
    });
  });

  it('parses a real DHL Saudi Arabia row (MBLVD28558)', () => {
    // From the prior DHL invoice the operator pasted in chat —
    // 8 kg, ER + GoGreen + Direct Signature populated.
    const r = parseXlsxRow(rowFromIndex({
      4: '3146159774',
      5: 'HN',
      6: 'DHL',
      8: '#MBLVD28558',
      12: 'Saudi Arabia',
      15: new Date('2026-04-28'),
      26: 'MEAN-BOX-45x29x28-CAR-02-VTĐG1',
      27: 2.5,
      28: '45x29x28',
      34: 6914808,
      35: 3287473,
      36: 2018627,
      38: 0,
      39: 150000,                 // Direct Sig
      40: 512208,                 // VAT
      41: 28500,                  // GoGreen
      42: '0',                    // no discount
      74: 918000,                 // Elevated Risk
    }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row).toMatchObject({
      trackingNumber: '3146159774',
      carrier: 'dhl',
      shipCountry: 'SA',
      packagingType: 'box',
      totalAmount: 6_914_808,
      directSignature: 150_000,
      gogreen: 28_500,
      elevatedRisk: 918_000,
      discount: 0,
    });
  });

  it('skips rows with no tracking number (pre-ship)', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 4: null }));
    expect(r.kind).toBe('skip_no_tracking');
  });

  it('skips rows with no total cost (label-only)', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 34: null }));
    expect(r.kind).toBe('skip_no_cost');
  });

  it('skips non-FedEx/DHL carriers (ViettelPost, GHTK, …)', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 6: 'ViettelPost' }));
    expect(r.kind).toBe('skip_carrier_unknown');
    if (r.kind !== 'skip_carrier_unknown') return;
    expect(r.carrier).toBe('ViettelPost');
  });

  it('skips DISCN partner-ship rows entirely', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 8: '#DISCN001' }));
    expect(r.kind).toBe('skip_store_partner');
  });

  it('skips disconnected stores (HC / MCN / MTB / MXHS)', () => {
    // TA (Tinh Atelier) IS connected on prod — covered in the
    // "ok" path tests below.
    for (const orderNo of ['HC500', '#MCN26', 'MTB42', 'MXHS9']) {
      const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 8: orderNo }));
      expect(r.kind).toBe('skip_store_disconnected');
    }
  });

  it('routes TA-prefix rows to tinhatelier (connected store)', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 8: 'TA2134' }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.storeHandle).toBe('tinhatelier');
  });

  it('skips rows with unparseable country', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 12: 'Wakanda' }));
    expect(r.kind).toBe('skip_no_country');
  });

  it('handles the Excel concat-bug "X,X,X" country values', () => {
    const r = parseXlsxRow(rowFromIndex({
      ...MBLVD28959_ROW,
      12: 'Saudi Arabia,Saudi Arabia,Saudi Arabia',
    }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.shipCountry).toBe('SA');
  });

  it('parses ISO-2 country values that bypass the name table', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 12: 'AE' }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.shipCountry).toBe('AE');
  });

  it('strips ₫ + comma + Unicode-minus from cell strings', () => {
    const r = parseXlsxRow(rowFromIndex({
      ...MBLVD28959_ROW,
      34: '₫1,340,167',
      42: '−1,541,142', // U+2212 minus sign
    }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.totalAmount).toBe(1_340_167);
    expect(r.row.discount).toBe(-1_541_142);
  });

  it('rejects malformed dimensions (returns null, row still ok)', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 28: '40x31' }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.dimensions).toBeNull();
  });

  it('strips leading # from order numbers in the parsed output', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 8: '#MBLVD28959' }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.orderNumber).toBe('MBLVD28959');
  });
});

describe('label date normalization (xlsx timezone/leap drift)', () => {
  // xlsx `cellDates:true` materialises a date-only cell as LOCAL midnight
  // minus a ~30s rounding drift — i.e. 23:59:30 of the previous LOCAL day.
  // Parsed on a +07 machine, ops-sheet "05/03/2026" arrived as
  // 2026-03-04T16:59:30Z and the whole DB ran a day behind the ops sheet.
  // The parser must snap to the real date at UTC midnight regardless of
  // the parsing machine's timezone.
  it('snaps a drifted date-only cell to UTC midnight of the real date', () => {
    const drifted = new Date(2026, 2, 4, 23, 59, 30); // local — exactly what xlsx emits for "05/03/2026"
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 15: drifted }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.labelCreatedAt?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });

  it('leaves an already-clean UTC-midnight date unchanged', () => {
    const clean = new Date('2026-04-28T00:00:00.000Z');
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 15: clean }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.labelCreatedAt?.toISOString()).toBe('2026-04-28T00:00:00.000Z');
  });
});

describe('import handling (CK) consistency gate', () => {
  it('keeps CK when the billed total includes it (MBLVD pattern)', () => {
    const r = parseXlsxRow(rowFromIndex({
      ...MBLVD28959_ROW,
      34: 1_408_467, // total = old parts (1,340,167) + CK 68,300
      88: 68_300,
    }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.importHandling).toBe(68_300);
  });

  it('drops CK when the total does NOT include it (TA pattern)', () => {
    const r = parseXlsxRow(rowFromIndex({ ...MBLVD28959_ROW, 88: 150_000 }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.row.importHandling).toBeNull();
  });
});

describe('parseXlsxRow with 2024-25 layout (resolveColumns)', () => {
  it('đọc đúng row layout 2024-25 qua resolveColumns', () => {
    const header: string[] = new Array(80).fill('');
    header[1]='Label Created Date'; header[2]='Base'; header[3]='Couriers'; header[5]='Order Number';
    header[16]='Weights'; header[19]='Country'; header[22]='Tracking Number';
    header[23]='INS | Chi phí Tổng (đ)'; header[24]='Mức giá cơ sở'; header[25]='Phụ phí nhiên liệu';
    const { columns } = resolveColumns(header);
    const row: Cell[] = new Array(80).fill(null);
    row[3]='FedEx'; row[5]='#MBLVD26831'; row[16]=0.5; row[19]='Saudi Arabia';
    row[22]='887499675299'; row[23]=1504643; row[24]=4747300; row[25]=200000;
    const r = parseXlsxRow(row, columns);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.row.trackingNumber).toBe('887499675299');
      expect(r.row.carrier).toBe('fedex');
      expect(r.row.totalAmount).toBe(1504643);
      expect(r.row.base).toBe(4747300);
      expect(r.row.fuel).toBe(200000);
    }
  });
});
