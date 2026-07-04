// features/lifecycle/playbook.test.ts
import { describe, it, expect } from 'vitest';
import { STAGE_PLAYBOOK, stagePlaybook } from './playbook';
import { STAGE_ORDER } from './display';

describe('STAGE_PLAYBOOK', () => {
  it('có entry cho mọi StageKey trong STAGE_ORDER', () => {
    for (const s of STAGE_ORDER) {
      const p = stagePlaybook(s);
      expect(p.whatToDo.length).toBeGreaterThan(0);
      expect(Array.isArray(p.infoKeys)).toBe(true);
    }
  });
  it('production nhắc brand + KCS', () => {
    expect(stagePlaybook('production').infoKeys).toContain('brand');
    expect(stagePlaybook('production').infoKeys).toContain('brandEta');
  });
  it('shipped có carrier + tracking', () => {
    expect(stagePlaybook('shipped').infoKeys).toContain('tracking');
  });
});
