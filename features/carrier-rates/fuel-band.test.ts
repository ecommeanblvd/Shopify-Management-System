import { describe, it, expect } from 'vitest';
import { fuelBandMidpoint, fuelBandLabel } from './fuel-band';

describe('fuelBandMidpoint', () => {
  it('pins to the midpoint of the 5%-wide band', () => {
    expect(fuelBandMidpoint(43)).toBe(42.5);
    expect(fuelBandMidpoint(37)).toBe(37.5);
    expect(fuelBandMidpoint(45.25)).toBe(47.5);
    expect(fuelBandMidpoint(40)).toBe(42.5);
    expect(fuelBandMidpoint(44.99)).toBe(42.5);
    expect(fuelBandMidpoint(45)).toBe(47.5);
  });
});

describe('fuelBandLabel', () => {
  it('formats the band range', () => {
    expect(fuelBandLabel(43)).toBe('40–45%');
    expect(fuelBandLabel(37)).toBe('35–40%');
  });
});
