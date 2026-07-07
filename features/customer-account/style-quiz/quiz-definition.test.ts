import { describe, it, expect } from 'vitest';
import { QUIZ_QUESTIONS, assembleAnswers } from './quiz-definition';
import { deriveProfile } from './profile';

describe('quiz-definition', () => {
  it('has questions for all 3 axes across levels', () => {
    const axes = new Set(QUIZ_QUESTIONS.map((q) => q.axis));
    expect(axes).toEqual(new Set(['color', 'body', 'archetype']));
    expect(QUIZ_QUESTIONS.some((q) => q.level === 1)).toBe(true);
    expect(QUIZ_QUESTIONS.some((q) => q.level === 2)).toBe(true);
  });

  it('assembleAnswers routes raw selections to the right axis + parses color numbers', () => {
    const a = assembleAnswers({
      c_jewelry: '-1', c_depth: '1',        // color → numbers
      q1_gain: 'hips', q3_waist: 'sharp',   // body → ids
      q1_dinner: 'floral', q6_lookas: 'pretty', // archetype → ids
    }, { heightCm: 160 });
    expect(a.color).toEqual({ jewelry: -1, skinDepth: 1 });
    expect(a.body).toMatchObject({ q1_gain: 'hips', q3_waist: 'sharp', heightCm: 160 });
    expect(a.archetype).toEqual({ q1_dinner: 'floral', q6_lookas: 'pretty' });
  });

  it('end-to-end: raw selections → assembleAnswers → deriveProfile', () => {
    const p = deriveProfile(assembleAnswers({
      c_jewelry: '-1', c_white: '-1', c_depth: '1', c_chroma: '1',
      q1_gain: 'hips', q2_widest: 'hips', q4_shoulders: 'hips',
      q1_dinner: 'floral', q6_lookas: 'pretty', q5_fabric: 'chiffon',
    }), { refined: true });
    expect(p.color.family).toBe('Winter');
    expect(p.body.shape).toBe('pear');
    expect(p.archetype.primary).toBe('romantic');
  });

  it('ignores empty/missing selections', () => {
    const a = assembleAnswers({ c_jewelry: '', q1_gain: 'hips' });
    expect(a.color).toEqual({});
    expect(a.body).toMatchObject({ q1_gain: 'hips' });
  });
});
