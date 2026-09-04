import { describe, it, expect } from 'vitest';
import { JOB_KEYS } from './registry';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Canh: mọi script cron phải đi qua chayCron VÀ khai đúng khoá có trong sổ đăng
 * ký. Script không ghi nhật ký = tác vụ vô hình, đúng cái lỗ hổng đã khiến 5
 * tác vụ chết 13–70 ngày mà không ai biết (rà soát 04/09).
 */
const DIR = join(process.cwd(), 'scripts/cron');

/** Chạy TAY khi cần, không có lịch → không cần nhật ký định kỳ. */
const MIEN_TRU = new Set(['backfill-shopify-orders.ts']);

describe('script cron', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !MIEN_TRU.has(f));

  it('có script để kiểm', () => expect(files.length).toBeGreaterThan(10));

  for (const f of files) {
    it(`${f} gọi chayCron với khoá nằm trong sổ đăng ký`, () => {
      const src = readFileSync(join(DIR, f), 'utf8');
      const m = src.match(/chayCron\(\s*'([^']+)'/);
      expect(m, `${f} chưa dùng chayCron`).not.toBeNull();
      expect(JOB_KEYS, `${f} dùng khoá lạ: ${m?.[1]}`).toContain(m![1]);
    });
  }
});
