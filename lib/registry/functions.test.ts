import { describe, expect, test } from 'vitest';
import { FUNCTIONS, getFunctionByKey } from './functions';

describe('function registry', () => {
  test('every function has a unique key', () => {
    const keys = FUNCTIONS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('getFunctionByKey returns the manifest', () => {
    expect(getFunctionByKey('wishlist')?.name).toBe('Wishlist');
  });

  test('getFunctionByKey returns undefined for unknown keys', () => {
    expect(getFunctionByKey('bogus')).toBeUndefined();
  });

  test('every function has an admin route', () => {
    for (const f of FUNCTIONS) expect(f.routes.admin).toMatch(/^\/f\/functions\//);
  });

  test('every function key matches its admin route slug', () => {
    for (const f of FUNCTIONS) {
      const slug = f.routes.admin.split('/').pop();
      expect(slug).toBe(f.key);
    }
  });
});
