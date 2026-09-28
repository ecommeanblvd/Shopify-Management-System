import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chặn một cái bẫy đã làm modal hoá đơn bị bó còn 384px (CEO báo 28/09/2026).
 *
 * `DialogContent` có sẵn `sm:max-w-sm` trong class gốc. Truyền `max-w-5xl` vào
 * `className` KHÔNG đè được nó: twMerge chỉ gộp các class CÙNG biến thể, mà
 * `max-w-*` và `sm:max-w-*` là hai biến thể khác nhau nên nó GIỮ CẢ HAI. Trong
 * CSS đã biên dịch, luật `sm:` đứng SAU (vị trí 127.432 so với 29.280) nên thắng
 * ở mọi màn ≥640px — `max-w-5xl` thành class chết.
 *
 * Muốn đặt bề rộng modal thì phải dùng `sm:max-w-*`.
 */
function quet(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) quet(p, ra);
    else if ((p.endsWith('.tsx') || p.endsWith('.ts')) && !p.includes('.test.')) ra.push(p);
  }
  return ra;
}

/** Lấy mọi chuỗi className của DialogContent trong một file. */
function classDialogContent(noiDung: string): string[] {
  const ra: string[] = [];
  const re = /<DialogContent[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noiDung)) !== null) ra.push(m[1] ?? m[2] ?? m[3] ?? '');
  return ra;
}

describe('bề rộng modal phải đặt bằng biến thể sm:', () => {
  it('không file nào dùng max-w-* trần trên DialogContent', () => {
    const viPham: string[] = [];
    for (const f of ['components', 'app'].flatMap((d) => quet(d))) {
      const noiDung = readFileSync(f, 'utf8');
      if (!noiDung.includes('<DialogContent')) continue;
      for (const cls of classDialogContent(noiDung)) {
        // `max-w-` KHÔNG có tiền tố biến thể nào đứng trước (sm:/md:/lg:…).
        const tran = cls.split(/\s+/).filter((c) => /^max-w-/.test(c));
        if (tran.length > 0) viPham.push(`${f}: ${tran.join(' ')}`);
      }
    }
    expect(viPham).toEqual([]);
  });

  it('bộ tách class đọc đúng cả ba kiểu viết', () => {
    expect(classDialogContent('<DialogContent className="a max-w-5xl">')).toEqual(['a max-w-5xl']);
    expect(classDialogContent('<DialogContent className={`b sm:max-w-[900px]`}>')).toEqual(['b sm:max-w-[900px]']);
    expect(classDialogContent("<DialogContent className={'c'}>")).toEqual(['c']);
  });
});
