import { describe, it, expect } from 'vitest';
import { scoreArchetype, ARCHETYPE_QUESTIONS, ARCHETYPES } from './archetype';

describe('scoreArchetype', () => {
  it('all-romantic answers → primary romantic', () => {
    const r = scoreArchetype({
      q1_dinner: 'floral', q2_offduty: 'soft', q6_lookas: 'pretty',
      q5_fabric: 'chiffon', q7_line: 'scoop', q8_palette: 'pastel',
    });
    expect(r.primary).toBe('romantic');
    expect(r.keywords).toContain('floral');
  });

  it('all-classic answers → primary classic', () => {
    const r = scoreArchetype({
      q1_dinner: 'blazer', q2_offduty: 'crisp', q6_lookas: 'refined',
      q5_fabric: 'wool', q7_line: 'crew', q8_palette: 'neutral',
    });
    expect(r.primary).toBe('classic');
  });

  it('all-edgy → primary edgy', () => {
    const r = scoreArchetype({ q1_dinner: 'leather', q2_offduty: 'hoodie', q6_lookas: 'cool', q5_fabric: 'leather', q8_palette: 'black' });
    expect(r.primary).toBe('edgy');
  });

  it('Q1 carries double weight (dinner outfit is most predictive)', () => {
    // q1=blazer(classic 4×2=8) vs q6=striking(dramatic 3). Classic phải thắng nhờ ×2.
    const r = scoreArchetype({ q1_dinner: 'blazer', q6_lookas: 'striking' });
    expect(r.scores.classic).toBe(8); // 4 × weight 2
    expect(r.primary).toBe('classic');
  });

  it('reports a secondary archetype when the runner-up is close (blend)', () => {
    // creative + natural gần nhau
    const r = scoreArchetype({ q1_dinner: 'maxi', q2_offduty: 'layer', q4_print: 'paisley', q5_fabric: 'linen' });
    expect(r.primary).toBe('creative');
    expect(['natural', 'romantic']).toContain(r.secondary);
  });

  it('tie-break: dramatic vs edgy resolved by structure (q3)', () => {
    // Dựng thế cân bằng dramatic≈edgy rồi để q3 quyết. polish→dramatic.
    const base = { q1_dinner: 'column', q8_palette: 'jewel' }; // column: Dra4,Edg1; jewel: Dra3,Edg1
    const polish = scoreArchetype({ ...base, q3_comfort: 'polish' }); // polish adds Dra3
    expect(polish.primary).toBe('dramatic');
  });

  it('confidence refined only when refined flag + enough answers', () => {
    const many = { q1_dinner: 'blazer', q2_offduty: 'crisp', q3_comfort: 'polish', q4_print: 'solid', q5_fabric: 'wool', q6_lookas: 'refined' };
    expect(scoreArchetype(many, { refined: true }).confidence).toBe('refined');
    expect(scoreArchetype(many).confidence).toBe('coarse');
    expect(scoreArchetype({ q1_dinner: 'blazer' }, { refined: true }).confidence).toBe('coarse'); // too few
  });

  it('every option vector has exactly 6 entries (matches ARCHETYPES order)', () => {
    for (const q of ARCHETYPE_QUESTIONS) for (const o of q.options) {
      expect(o.s).toHaveLength(ARCHETYPES.length);
    }
  });

  it('empty answers → deterministic default, no crash', () => {
    const r = scoreArchetype({});
    expect(ARCHETYPES).toContain(r.primary);
    expect(r.secondary).toBeNull();
  });
});
