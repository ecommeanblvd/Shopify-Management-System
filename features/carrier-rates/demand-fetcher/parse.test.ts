import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDemandPdfText } from './parse';

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, '__fixtures__', name), 'utf8');

describe('parseDemandPdfText — OLD 2025 format', () => {
  const period = parseDemandPdfText(fixture('old-2025.txt'));

  it('parses the effective-from date (inclusive)', () => {
    expect(period.effectiveFrom.getTime()).toBe(Date.UTC(2025, 6, 21));
  });

  it('parses effective-to as the day AFTER the printed end date (exclusive)', () => {
    expect(period.effectiveTo?.getTime()).toBe(Date.UTC(2025, 8, 22));
  });

  it('extracts only the Israel export rate (Priority value)', () => {
    expect(period.exportRates).toEqual({ israel: 11200 });
  });
});

describe('parseDemandPdfText — NEW 2026 format', () => {
  const period = parseDemandPdfText(fixture('new-2026.txt'));

  it('parses the effective-from date', () => {
    expect(period.effectiveFrom.getTime()).toBe(Date.UTC(2026, 5, 18));
  });

  it('has no effective-to (open-ended)', () => {
    expect(period.effectiveTo).toBeNull();
  });

  it('extracts the positive export rates, taking the FIRST number per row', () => {
    expect(period.exportRates).toEqual({
      israel: 28400,
      europe: 28400,
      meisa: 39700,
    });
  });
});

describe('parseDemandPdfText — RANGE 2025 format ("From X to Y" + consolidated table)', () => {
  const period = parseDemandPdfText(fixture('range-2025.txt'));

  it('parses effective-from from the "From <date> to <date>" header', () => {
    expect(period.effectiveFrom.getTime()).toBe(Date.UTC(2025, 9, 20));
  });

  it('parses effective-to as the printed end date + 1 day (exclusive)', () => {
    // Printed "to December 7, 2025" → exclusive end Dec 8, 2025.
    expect(period.effectiveTo?.getTime()).toBe(Date.UTC(2025, 11, 8));
  });

  it('extracts export rates, incl. multi-line USA + MEISA regions (FIRST number per row)', () => {
    expect(period.exportRates).toEqual({
      australia_nz: 5700,
      asia: 2800,
      usa: 28400,
      canada: 28400,
      israel: 28400,
      europe: 28400,
      india: 2800,
      meisa: 28400,
      mexico: 28400,
      lac: 38700,
    });
  });
});

describe('parseDemandPdfText — error handling', () => {
  it('throws on empty text', () => {
    expect(() => parseDemandPdfText('')).toThrow();
  });

  it('throws on garbage text with no recognisable header', () => {
    expect(() => parseDemandPdfText('hello world, not a fedex pdf')).toThrow();
  });
});
