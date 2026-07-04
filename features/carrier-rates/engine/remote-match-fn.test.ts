import { describe, it, expect } from 'vitest';
import { matchRemoteTier } from './remote-match';

describe('matchRemoteTier', () => {
  it('undefined map → null', () => {
    expect(matchRemoteTier(undefined, '90210', 'X')).toEqual({ tier: null, matchedBy: null });
  });

  it('postcode khớp raw (ưu tiên trước city)', () => {
    const m = new Map<string, string | null>([['90210', 'Tier A'], ['BEVERLYHILLS', 'Tier B']]);
    expect(matchRemoteTier(m, '90210', 'Beverly Hills')).toEqual({ tier: 'Tier A', matchedBy: 'postcode' });
  });

  it('postcode khớp sau strip (ZIP+4 → base)', () => {
    // stored as '90210', input as '90210-1234' → stripped prefix matches
    const m = new Map<string, string | null>([['90210', 'Tier A']]);
    expect(matchRemoteTier(m, '90210-1234', 'Beverly Hills')).toEqual({ tier: 'Tier A', matchedBy: 'postcode' });
  });

  it('city fallback khi postcode miss', () => {
    const m = new Map<string, string | null>([['JEDDAH', 'Tier C']]);
    expect(matchRemoteTier(m, '00000', 'Jeddah')).toMatchObject({ matchedBy: 'city' });
  });

  it('wildcard country-default', () => {
    const m = new Map<string, string | null>([['*', 'Tier D']]);
    expect(matchRemoteTier(m, 'zzz', 'Nowhere')).toEqual({ tier: 'Tier D', matchedBy: 'country_default' });
  });

  it('miss hoàn toàn → null', () => {
    expect(matchRemoteTier(new Map(), '123', 'Y')).toEqual({ tier: null, matchedBy: null });
  });

  it('null postcode + null city → country-default khi có wildcard', () => {
    const m = new Map<string, string | null>([['*', 'Tier E']]);
    expect(matchRemoteTier(m, null, null)).toEqual({ tier: 'Tier E', matchedBy: 'country_default' });
  });

  it('tier null (no-tier row) trả về đúng', () => {
    // tier stored as null means remote but no tier label
    const m = new Map<string, string | null>([['12345', null]]);
    expect(matchRemoteTier(m, '12345', 'City')).toEqual({ tier: null, matchedBy: 'postcode' });
  });
});
