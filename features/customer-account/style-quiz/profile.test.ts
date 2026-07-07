import { describe, it, expect } from 'vitest';
import { deriveProfile } from './profile';

describe('deriveProfile', () => {
  it('combines 3 independent axes into a coherent profile', () => {
    const p = deriveProfile({
      color: { whiteVsCream: -1, jewelry: -1, skinDepth: 1, hairDepth: 1, vividVsDusty: 1, eyesClearSoft: 1, contrast: 1 },
      archetype: { q1_dinner: 'floral', q6_lookas: 'pretty', q5_fabric: 'chiffon' },
      body: { q1_gain: 'hips', q2_widest: 'hips', q4_shoulders: 'hips' },
    }, { refined: true, levelReached: 2 });

    expect(p.color.family).toBe('Winter');           // cool + deep + bright
    expect(p.archetype.primary).toBe('romantic');
    expect(p.body.shape).toBe('pear');
    expect(p.levelReached).toBe(2);
    // 3 trục độc lập — romantic KHÔNG ép màu/dáng
    expect(p.color.palette.length).toBeGreaterThan(0);
    expect(p.archetype.keywords).toContain('floral');
  });

  it('empty answers → safe defaults, no crash, coarse confidence', () => {
    const p = deriveProfile({});
    expect(p.color.season).toBeTruthy();
    expect(p.archetype.primary).toBeTruthy();
    expect(p.body.shape).toBeTruthy();
    expect(p.levelReached).toBe(1);
    expect(p.color.confidence).toBe('coarse');
  });

  it('measurements in body answers upgrade body confidence to refined', () => {
    const p = deriveProfile({ body: { measurements: { bust: 36, waist: 26, hips: 37 } } });
    expect(p.body.shape).toBe('hourglass');
    expect(p.body.confidence).toBe('refined');
    expect(p.body.fromMeasurements).toBe(true);
  });
});
