import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HAN_MAC_DINH_GIAY } from './run';

/**
 * Canh lời hứa "một việc hỏng KHÔNG chặn các việc sau".
 *
 * Lời hứa đó viết trong doc của sync-shopify-orders.ts nhưng chỉ ĐÚNG với việc
 * NÉM LỖI. Việc TREO không ném gì — nó nằm im và bỏ đói mọi việc phía sau. Đo
 * 29/09/2026: `refresh-owned-store` không ghi `finished_at` ở 41/294 lượt
 * (13,9%), mỗi lần như vậy SÁU việc sau nó không chạy, và không có lỗi nào.
 */
describe('hạn giờ cho tác vụ nền', () => {
  it('có hạn mặc định, và đủ rộng so với việc chậm nhất đo được (512 giây)', () => {
    expect(HAN_MAC_DINH_GIAY).toBeGreaterThan(512);
  });

  it('chayMotJob phải bọc fn trong Promise.race — không có thì treo lại bỏ đói việc sau', () => {
    const src = readFileSync(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/Promise\.race\(\[\s*fn\(\)/);
  });

  it('việc chậm bất thường phải nằm CUỐI danh sách sync-orders', () => {
    const src = readFileSync(new URL('../../scripts/cron/sync-shopify-orders.ts', import.meta.url), 'utf8');
    const keys = [...src.matchAll(/\{\s*key:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!);
    expect(keys.at(-1), 'refresh-owned-store (trung bình 42 phút) phải đứng cuối để chỉ tự hại nó')
      .toBe('refresh-owned-store');
  });

  it('hai việc mới thêm phải đứng TRƯỚC việc chậm đó', () => {
    const src = readFileSync(new URL('../../scripts/cron/sync-shopify-orders.ts', import.meta.url), 'utf8');
    const keys = [...src.matchAll(/\{\s*key:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!);
    const cham = keys.indexOf('refresh-owned-store');
    for (const k of ['gom-bang-ke-nhap', 'sync-dispute']) {
      expect(keys.indexOf(k), `${k} phải đứng trước refresh-owned-store`).toBeLessThan(cham);
    }
  });
});
