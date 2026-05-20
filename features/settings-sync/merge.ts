export interface OverrideRow {
  path: string;
  value: unknown;
}

type Tree = Record<string, unknown>;

function setPath(target: Tree, parts: string[], value: unknown): void {
  let cursor: Tree = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    if (next === null || next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Tree;
  }
  cursor[parts[parts.length - 1]] = value;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function mergeEffective<T extends Tree>(template: T, overrides: OverrideRow[]): T {
  const result = deepClone(template);
  for (const o of overrides) {
    if (!o.path) throw new Error('Override has empty path');
    const parts = o.path.split('.');
    setPath(result, parts, o.value);
  }
  return result;
}
