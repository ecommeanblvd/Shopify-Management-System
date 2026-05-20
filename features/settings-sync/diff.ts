export interface Operations {
  creates: Array<{ path: string; value: unknown }>;
  updates: Array<{ path: string; before: unknown; after: unknown }>;
  deletes: Array<{ path: string; value: unknown }>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function walk(
  current: unknown,
  effective: unknown,
  pathParts: string[],
  ops: Operations,
): void {
  const join = () => pathParts.join('.');
  const currentIsObj = isObject(current);
  const effectiveIsObj = isObject(effective);

  if (currentIsObj && effectiveIsObj) {
    const allKeys = new Set([...Object.keys(current), ...Object.keys(effective)]);
    for (const k of allKeys) {
      walk(current[k], effective[k], [...pathParts, k], ops);
    }
    return;
  }

  if (effective === undefined && current !== undefined) {
    ops.deletes.push({ path: join(), value: current });
    return;
  }
  if (current === undefined && effective !== undefined) {
    ops.creates.push({ path: join(), value: effective });
    return;
  }
  if (JSON.stringify(current) !== JSON.stringify(effective)) {
    ops.updates.push({ path: join(), before: current, after: effective });
  }
}

export function diffTrees(current: unknown, effective: unknown): Operations {
  const ops: Operations = { creates: [], updates: [], deletes: [] };
  walk(current, effective, [], ops);
  return ops;
}
