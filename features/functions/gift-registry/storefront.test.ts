import { describe, expect, test, vi } from 'vitest';

vi.mock('@/db/client', () => ({ db: {}, schema: {} }));

import { assertCreateInput, getRegistryByToken } from './storefront';

describe('assertCreateInput', () => {
  test('accepts a minimal valid input', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'jane@example.com',
      eventName: 'Wedding',
    })).not.toThrow();
  });

  test('accepts a fully populated input', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'jane@example.com',
      ownerName: 'Jane Doe',
      eventName: 'Wedding',
      eventDate: '2027-06-12',
      message: 'Thanks for celebrating with us!',
    })).not.toThrow();
  });

  test('rejects missing ownerEmail', () => {
    expect(() => assertCreateInput({
      ownerEmail: '',
      eventName: 'Wedding',
    })).toThrow(/ownerEmail/);
  });

  test('rejects malformed ownerEmail', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'not-an-email',
      eventName: 'Wedding',
    })).toThrow(/ownerEmail/);
  });

  test('rejects missing eventName', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'jane@example.com',
      eventName: '   ',
    })).toThrow(/eventName/);
  });

  test('rejects too-long eventName', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'jane@example.com',
      eventName: 'x'.repeat(201),
    })).toThrow(/eventName/);
  });

  test('rejects badly-shaped eventDate', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'jane@example.com',
      eventName: 'Wedding',
      eventDate: '06-12-2027',
    })).toThrow(/YYYY-MM-DD/);
  });

  test('rejects too-long message', () => {
    expect(() => assertCreateInput({
      ownerEmail: 'jane@example.com',
      eventName: 'Wedding',
      message: 'x'.repeat(2001),
    })).toThrow(/message/);
  });
});

describe('getRegistryByToken token-shape gate', () => {
  test('rejects empty token without touching the DB', async () => {
    await expect(getRegistryByToken('')).resolves.toBeNull();
  });

  test('rejects missing gr_ prefix', async () => {
    await expect(getRegistryByToken('abc123def456')).resolves.toBeNull();
  });

  test('rejects too-short suffix', async () => {
    await expect(getRegistryByToken('gr_short')).resolves.toBeNull();
  });

  test('rejects non-alphanumeric suffix', async () => {
    await expect(getRegistryByToken("gr_'; DROP TABLE--")).resolves.toBeNull();
  });
});
