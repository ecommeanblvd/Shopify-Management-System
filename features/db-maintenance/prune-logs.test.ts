import { describe, expect, it } from 'vitest';
import { PRUNE_RULES, buildPruneSql, cutoffFor } from './prune-logs';

const MOC = new Date('2026-08-24T10:00:00Z');

describe('cutoffFor', () => {
  it('lùi đúng số ngày cần giữ', () => {
    expect(cutoffFor({ ...PRUNE_RULES[0], keepDays: 30 }, MOC).toISOString())
      .toBe('2026-07-25T10:00:00.000Z');
  });

  it('keepDays = 1 chỉ lùi 1 ngày', () => {
    expect(cutoffFor({ ...PRUNE_RULES[0], keepDays: 1 }, MOC).toISOString())
      .toBe('2026-08-23T10:00:00.000Z');
  });
});

describe('buildPruneSql', () => {
  it('xoá dòng cũ với luật kiểu delete', () => {
    const rule = PRUNE_RULES.find((r) => r.mode === 'delete')!;
    const sql = buildPruneSql(rule);
    expect(sql).toBe(`DELETE FROM "${rule.table}" WHERE "${rule.timeColumn}" < $1`);
  });

  it('chỉ rỗng hoá cột với luật kiểu null-column, KHÔNG xoá dòng', () => {
    const rule = PRUNE_RULES.find((r) => r.mode === 'null-column')!;
    const sql = buildPruneSql(rule);
    expect(sql).toBe(
      `UPDATE "${rule.table}" SET "${rule.column}" = NULL WHERE "${rule.column}" IS NOT NULL AND "${rule.timeColumn}" < $1`,
    );
    expect(sql).not.toMatch(/DELETE/);
  });
});

describe('PRUNE_RULES', () => {
  it('không có key trùng', () => {
    expect(new Set(PRUNE_RULES.map((r) => r.key)).size).toBe(PRUNE_RULES.length);
  });

  it('mọi luật giữ ít nhất 7 ngày — webhook Shopify còn thử lại trong ~48h', () => {
    for (const r of PRUNE_RULES) expect(r.keepDays).toBeGreaterThanOrEqual(7);
  });

  it('luật null-column bắt buộc khai báo cột', () => {
    for (const r of PRUNE_RULES) {
      if (r.mode === 'null-column') expect(r.column).toBeTruthy();
    }
  });

  it('tên bảng/cột chỉ gồm ký tự an toàn (ghép thẳng vào SQL)', () => {
    for (const r of PRUNE_RULES) {
      expect(r.table).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(r.timeColumn).toMatch(/^[a-z_][a-z0-9_]*$/);
      if (r.column) expect(r.column).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});
