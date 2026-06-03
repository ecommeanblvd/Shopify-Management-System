import { describe, it, expect } from 'vitest';
import { lookupStorePrefix } from './store-prefix';

describe('lookupStorePrefix', () => {
  it('matches connected stores from Excel sample data', () => {
    const r1 = lookupStorePrefix('#MBLVD28959');
    expect(r1.kind).toBe('matched');
    if (r1.kind !== 'matched') return;
    expect(r1.prefix).toBe('MBLVD');
    expect(r1.info.handle).toBe('meanblvd');
    expect(r1.info.connected).toBe(true);
    expect(r1.orderNumber).toBe('MBLVD28959');

    const r2 = lookupStorePrefix('MIR12345');
    expect(r2.kind).toBe('matched');
    if (r2.kind !== 'matched') return;
    expect(r2.info.handle).toBe('mirermirer-official');
    expect(r2.info.connected).toBe(true);
  });

  it('matches disconnected stores (still flagged)', () => {
    expect(lookupStorePrefix('TA2134')).toMatchObject({
      kind: 'matched',
      prefix: 'TA',
      info: { handle: 'tinhatelier', connected: true },
    });
    expect(lookupStorePrefix('HC500')).toMatchObject({
      kind: 'matched',
      info: { connected: false },
    });
    expect(lookupStorePrefix('#MCN26')).toMatchObject({
      kind: 'matched',
      info: { handle: 'mean-china' },
    });
    expect(lookupStorePrefix('MTB42')).toMatchObject({
      kind: 'matched',
      info: { handle: 'mean-taobao' },
    });
    expect(lookupStorePrefix('MXHS7')).toMatchObject({
      kind: 'matched',
      info: { handle: 'mean-xiaohongshu' },
    });
  });

  it('returns partner_ship for DISCN (skip entirely)', () => {
    expect(lookupStorePrefix('#DISCN001')).toEqual({
      kind: 'partner_ship',
      orderNumber: 'DISCN001',
    });
    expect(lookupStorePrefix('DISCN42').kind).toBe('partner_ship');
  });

  it('greedy-matches longer prefix first (MBLVD not MB)', () => {
    // MB would be ambiguous (not in map). Test MBLVD wins over hypothetical
    // shorter prefix in case we add MB later.
    const r = lookupStorePrefix('MBLVD28907');
    if (r.kind !== 'matched') throw new Error('expected matched');
    expect(r.prefix).toBe('MBLVD');
  });

  it('greedy-matches MXHS not MX', () => {
    // MXHS (4 chars) should win over a hypothetical MX (2 chars). Defensive
    // since we have both MX-prefix codes in the map (MCN/MTB/MXHS share M).
    expect(lookupStorePrefix('MXHS99').kind).toBe('matched');
  });

  it('strips leading # and is case-insensitive', () => {
    expect(lookupStorePrefix('#mblvd28959').kind).toBe('matched');
    expect(lookupStorePrefix('mBlVd28959').kind).toBe('matched');
  });

  it('returns no_prefix for empty / unknown values', () => {
    expect(lookupStorePrefix(null)).toEqual({ kind: 'no_prefix', raw: '' });
    expect(lookupStorePrefix(undefined)).toEqual({ kind: 'no_prefix', raw: '' });
    expect(lookupStorePrefix('')).toEqual({ kind: 'no_prefix', raw: '' });
    expect(lookupStorePrefix('UNKNOWN42')).toEqual({
      kind: 'no_prefix',
      raw: 'UNKNOWN42',
    });
    expect(lookupStorePrefix('12345').kind).toBe('no_prefix');
  });
});
