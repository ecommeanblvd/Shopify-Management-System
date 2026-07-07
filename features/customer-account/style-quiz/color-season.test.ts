import { describe, it, expect } from 'vitest';
import { scoreColorAxes, deriveColorSeason, type ColorAnswers } from './color-season';

describe('scoreColorAxes', () => {
  it('renormalizes over answered questions (missing = ignored, not zero-dragged)', () => {
    // chỉ trả lời jewelry (warm=+1) → hue phải = +1, không bị kéo về 0 bởi câu thiếu
    const axes = scoreColorAxes({ jewelry: 1 });
    expect(axes.hue).toBeCloseTo(1, 5);
    expect(axes.value).toBe(0);
    expect(axes.chroma).toBe(0);
  });
  it('weights white-vs-cream highest, vein lowest for HUE', () => {
    const warm = scoreColorAxes({ whiteVsCream: 1, vein: -1 }); // cream(warm) mạnh hơn vein(cool)
    expect(warm.hue).toBeGreaterThan(0);
  });
  it('classifies contrast level from the contrast answer', () => {
    expect(scoreColorAxes({ contrast: 1 }).contrastLevel).toBe('high');
    expect(scoreColorAxes({ contrast: -1 }).contrastLevel).toBe('low');
    expect(scoreColorAxes({ contrast: 0 }).contrastLevel).toBe('medium');
  });
});

describe('deriveColorSeason', () => {
  const cases: Array<[string, { hue: number; value: number; chroma: number }, string]> = [
    ['cool + deep + bright (chroma dominant) → Bright Winter', { hue: -0.8, value: 0.5, chroma: 0.9 }, 'Bright Winter'],
    ['cool + light + soft (value dominant) → Light Summer', { hue: -0.6, value: -0.9, chroma: -0.5 }, 'Light Summer'],
    ['cool + deep (value dominant) → Deep Winter', { hue: -0.5, value: 0.9, chroma: 0.4 }, 'Deep Winter'],
    ['cool dominant hue → True Winter', { hue: -0.95, value: 0.4, chroma: 0.5 }, 'True Winter'],
    ['warm + deep + soft (chroma dominant) → Soft Autumn', { hue: 0.5, value: 0.6, chroma: -0.9 }, 'Soft Autumn'],
    ['warm + light + bright (value dominant) → Light Spring', { hue: 0.5, value: -0.9, chroma: 0.6 }, 'Light Spring'],
    ['warm dominant hue → True Spring', { hue: 0.95, value: -0.3, chroma: 0.5 }, 'True Spring'],
    ['warm + bright (chroma dominant) → Bright Spring', { hue: 0.5, value: -0.2, chroma: 0.9 }, 'Bright Spring'],
    ['neutral hue + deep + bright → Deep Winter (value dom)', { hue: 0.1, value: 0.8, chroma: 0.5 }, 'Deep Winter'],
    ['neutral hue + light + soft → Soft Summer (chroma dom)', { hue: -0.1, value: -0.4, chroma: -0.7 }, 'Soft Summer'],
  ];
  for (const [name, axes, expected] of cases) {
    it(name, () => {
      const r = deriveColorSeason({ ...axes, contrastLevel: 'medium' });
      expect(r.season).toBe(expected);
      expect(r.palette.length).toBeGreaterThanOrEqual(8);
      expect(r.avoid.length).toBeGreaterThanOrEqual(4);
    });
  }

  it('returns sister-season fallback when hue is neutral (olive/ambiguous)', () => {
    const r = deriveColorSeason({ hue: 0.05, value: 0.8, chroma: 0.4, contrastLevel: 'medium' });
    expect(r.season).toBe('Deep Winter');
    expect(r.sisterFallback).toBe('Deep Autumn'); // same dominant (deep), opposite temperature
  });
  it('no sister fallback for a confident warm/cool result', () => {
    const r = deriveColorSeason({ hue: -0.8, value: 0.5, chroma: 0.9, contrastLevel: 'high' });
    expect(r.sisterFallback).toBeNull();
  });
  it('confidence is refined only when opts.refined and signal is strong', () => {
    const strong = { hue: -0.8, value: 0.6, chroma: 0.9, contrastLevel: 'high' as const };
    expect(deriveColorSeason(strong, { refined: true }).confidence).toBe('refined');
    expect(deriveColorSeason(strong).confidence).toBe('coarse'); // level-1 default
    const weak = { hue: 0.1, value: 0.2, chroma: 0.15, contrastLevel: 'low' as const };
    expect(deriveColorSeason(weak, { refined: true }).confidence).toBe('coarse'); // weak signal stays coarse
  });

  it('end-to-end: answers → axes → season', () => {
    const answers: ColorAnswers = {
      whiteVsCream: -1, jewelry: -1, eyesHair: -1, // cool
      skinDepth: 1, hairDepth: 1, overall: 1,       // deep
      vividVsDusty: 1, eyesClearSoft: 1, contrast: 1, // bright, high contrast
    };
    const r = deriveColorSeason(scoreColorAxes(answers), { refined: true });
    expect(r.family).toBe('Winter');
    expect(['Bright Winter', 'Deep Winter', 'True Winter']).toContain(r.season);
  });
});
