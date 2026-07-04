import { describe, it, expect } from 'vitest';
import { pickLookupResult } from './lookup-logic';

describe('pickLookupResult', () => {
  it('rỗng → invalid', () => {
    expect(pickLookupResult([])).toEqual({ valid: false, city: null, stateCode: null, candidates: [] });
  });
  it('1 kết quả → valid + city/state', () => {
    const r = pickLookupResult([{ city: 'Beverly Hills', stateCode: 'CA' }]);
    expect(r).toMatchObject({ valid: true, city: 'Beverly Hills', stateCode: 'CA' });
  });
  it('nhiều → dòng đầu + candidates đầy đủ', () => {
    const r = pickLookupResult([
      { city: 'A', stateCode: 'X' }, { city: 'B', stateCode: 'X' },
    ]);
    expect(r.valid).toBe(true);
    expect(r.city).toBe('A');
    expect(r.candidates).toHaveLength(2);
  });
});
