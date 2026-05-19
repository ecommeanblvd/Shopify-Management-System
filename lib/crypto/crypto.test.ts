import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, needsReEncryption } from './index';

const keys = {
  v1: '11'.repeat(32), // 32 bytes hex
  v2: '22'.repeat(32),
};

describe('crypto', () => {
  it('round-trips a value with the current key', () => {
    const cipher = encrypt('shpat_secret', { keys, current: 'v1' });
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(decrypt(cipher, { keys, current: 'v1' })).toBe('shpat_secret');
  });

  it('decrypts a v1 ciphertext even when current key is v2', () => {
    const cipher = encrypt('shpat_secret', { keys, current: 'v1' });
    expect(decrypt(cipher, { keys, current: 'v2' })).toBe('shpat_secret');
  });

  it('reports re-encryption is needed when ciphertext version != current', () => {
    const v1cipher = encrypt('x', { keys, current: 'v1' });
    expect(needsReEncryption(v1cipher, 'v2')).toBe(true);
    expect(needsReEncryption(v1cipher, 'v1')).toBe(false);
  });

  it('throws when the ciphertext key version is unknown', () => {
    expect(() => decrypt('v9:aa:bb:cc', { keys, current: 'v1' })).toThrow();
  });

  it('throws when the auth tag has been tampered with', () => {
    const cipher = encrypt('shpat_secret', { keys, current: 'v1' });
    // Format: version:ivHex:tagHex:dataHex
    const parts = cipher.split(':');
    // Replace the tag segment (index 2) with a different valid-length hex string
    const originalTag = parts[2];
    const tamperedTag = originalTag
      .split('')
      .map((c, i) => (i === 0 ? (c === 'a' ? 'b' : 'a') : c))
      .join('');
    parts[2] = tamperedTag;
    const tampered = parts.join(':');
    expect(() => decrypt(tampered, { keys, current: 'v1' })).toThrow();
  });
});
