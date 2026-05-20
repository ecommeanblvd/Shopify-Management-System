import { describe, it, expect } from 'vitest';
import { diffTrees } from './diff';

describe('diffTrees', () => {
  it('returns no ops when trees are equal', () => {
    const t = { a: 1, b: { c: 2 } };
    expect(diffTrees(t, t)).toEqual({ creates: [], updates: [], deletes: [] });
  });

  it('detects a leaf update', () => {
    const ops = diffTrees({ a: 1 }, { a: 2 });
    expect(ops.updates).toEqual([{ path: 'a', before: 1, after: 2 }]);
    expect(ops.creates).toHaveLength(0);
    expect(ops.deletes).toHaveLength(0);
  });

  it('detects a create when the path is new in effective', () => {
    const ops = diffTrees({ a: 1 }, { a: 1, b: 2 });
    expect(ops.creates).toEqual([{ path: 'b', value: 2 }]);
  });

  it('detects a delete when the path is missing in effective', () => {
    const ops = diffTrees({ a: 1, b: 2 }, { a: 1 });
    expect(ops.deletes).toEqual([{ path: 'b', value: 2 }]);
  });

  it('treats new subtree as a create at the subtree root', () => {
    const ops = diffTrees({}, { z: { rates: { S: { price: 10 } } } });
    expect(ops.creates).toEqual([{ path: 'z', value: { rates: { S: { price: 10 } } } }]);
  });

  it('drills into a shared subtree to find leaf updates', () => {
    const ops = diffTrees(
      { z: { rates: { S: { price: 10 } } } },
      { z: { rates: { S: { price: 12 } } } },
    );
    expect(ops.updates).toEqual([{ path: 'z.rates.S.price', before: 10, after: 12 }]);
  });
});
