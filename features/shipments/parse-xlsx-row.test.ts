import { describe, it, expect } from 'vitest';
import { parseXlsxRow, type Cell, type RawRow } from './parse-xlsx-row';

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
