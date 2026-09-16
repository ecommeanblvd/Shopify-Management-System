import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chặn lỗi đã lọt lên production 16/09/2026: trong template `sql` của drizzle, một mảng JS bị
 * bung thành ($1, $2, …), nên `= ANY(${mảng})` sinh ra `= ANY(($1, $2))` và Postgres báo lỗi.
 * Muốn lọc theo mảng thì viết `IN ${mảng}` (đã chặn mảng rỗng) hoặc dùng tham số `$1::text[]`
 * với truy vấn thô.
 */
function quet(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) quet(p, ra);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) ra.push(p);
  }
  return ra;
}

describe('không dùng ANY(${mảng}) trong template sql của drizzle', () => {
  it('features/, lib/, app/ sạch', () => {
    const vi = ['features', 'lib', 'app'].flatMap((d) => quet(d))
      .filter((f) => /=\s*ANY\(\$\{/.test(readFileSync(f, 'utf8')));
    expect(vi).toEqual([]);
  });
});
