import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * File `'use server'` chỉ được phép export HÀM ASYNC (và kiểu, vốn bị xoá lúc
 * biên dịch). Export một GIÁ TRỊ — hằng chuỗi, mảng, object — thì `next build`
 * VẪN XANH nhưng production ném `ReferenceError` lúc nạp module.
 *
 * Đã trả giá đúng 24/09/2026: `shopify-qc.ts` export `TRUY_VAN_QC` (một chuỗi
 * GraphQL) và re-export kiểu; production ném `ReferenceError: DongQc is not
 * defined`, ô tìm món im lặng trả rỗng, CEO thử ba lần không ai biết vì sao.
 *
 * Quét CẢ `features/` chứ không riêng kho-nhan: cái bẫy này không chừa ai.
 */
function moiFileTs(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) { ra.push(...moiFileTs(p)); continue; }
    if (p.endsWith('.ts') && !p.endsWith('.test.ts')) ra.push(p);
  }
  return ra;
}

describe("file 'use server' không được export giá trị", () => {
  it('không file nào trong features/ export const/let/var từ module use server', () => {
    const pham: string[] = [];
    for (const p of moiFileTs('features')) {
      const s = readFileSync(p, 'utf8');
      // Chỉ tính chỉ thị ở ĐẦU file, không tính chữ 'use server' trong chú thích.
      if (!/^\s*(['"])use server\1\s*;?/.test(s)) continue;
      for (const m of s.matchAll(/^export\s+(const|let|var)\s+(\w+)/gm)) {
        pham.push(`${p}: export ${m[1]} ${m[2]}`);
      }
    }
    expect(pham).toEqual([]);
  });
});
