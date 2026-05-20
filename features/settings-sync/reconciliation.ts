function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function walk(current: unknown, template: unknown, path: string[], out: string[]): void {
  if (!isObject(current)) return;
  if (!isObject(template)) {
    // Template has nothing at this path; the entire current subtree is unreconciled.
    if (path.length > 0) out.push(path.join('.'));
    return;
  }
  for (const key of Object.keys(current)) {
    if (!(key in template)) {
      out.push([...path, key].join('.'));
    } else {
      walk(current[key], template[key], [...path, key], out);
    }
  }
}

/**
 * Returns dotted paths in `current` that do not appear in `template`.
 * The reconciliation wizard offers each path as "keep as override" or "discard".
 */
export function listUnreconciledPaths(current: unknown, template: unknown): string[] {
  const out: string[] = [];
  walk(current, template, [], out);
  return out;
}
