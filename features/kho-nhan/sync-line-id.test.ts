/**
 * Phân loại lỗi tại ĐÚNG điểm gọi trong `noiTrongKhoa`: lỗi nào được savepoint nuốt (bỏ qua một
 * món, lượt vẫn commit) và lỗi nào phải ném lại (sập cả lượt, `job_runs` ghi 'error').
 *
 * Vòng 1-3 không có test nào ở đây, nên việc đọc thẳng `e.code` (luôn `undefined` vì Drizzle bọc
 * lỗi trong `DrizzleQueryError` — lớp này chỉ đặt `.query`/`.params`/`.cause`) lọt qua 3 vòng
 * review: MỌI unique-violation bị ném lại, transaction ngoài cùng rollback, mất sạch các món đã
 * nối đúng trong lượt. Test dưới dùng `DrizzleQueryError` THẬT của drizzle-orm để shape lỗi đúng
 * như lúc chạy, không phải object tự bịa.
 */
import { describe, it, expect, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';

// `sync-line-id.ts` import `@/db/client` (tạo Pool) — mock để test thuần, không chạm Postgres.
vi.mock('@/db/client', () => ({
  db: { transaction: vi.fn() },
  schema: { larkMonDon: 'lark_mon_don', shopifyOrderLines: 'shopify_order_lines', shopifyOrders: 'shopify_orders' },
}));

import { laLoiTrungDongDon } from './sync-line-id';

/** Lỗi pg thô như driver node-postgres ném ra (trước khi Drizzle bọc lại). */
function loiPgTho(code: string): Error & { code: string } {
  return Object.assign(new Error(`duplicate key value violates unique constraint "lark_mon_don_line_uniq"`), { code });
}

describe('laLoiTrungDongDon', () => {
  it('lỗi pg thô mang code 23505 → bỏ qua được', () => {
    expect(laLoiTrungDongDon(loiPgTho('23505'))).toBe(true);
  });

  it('DrizzleQueryError bọc 23505 (chỉ có .cause.code, KHÔNG có .code) → vẫn bỏ qua được', () => {
    const boc = new DrizzleQueryError('update "lark_mon_don" set ...', [], loiPgTho('23505'));
    // Chính là cái bẫy đã làm hỏng vòng 3: đọc thẳng `.code` ra undefined.
    expect((boc as unknown as { code?: unknown }).code).toBeUndefined();
    expect(laLoiTrungDongDon(boc)).toBe(true);
  });

  it('DrizzleQueryError bọc lỗi KHÁC 23505 (vd 57014 statement_timeout) → lỗi hệ thống, phải ném lại', () => {
    const boc = new DrizzleQueryError('update "lark_mon_don" set ...', [], loiPgTho('57014'));
    expect(laLoiTrungDongDon(boc)).toBe(false);
  });

  it('lỗi không có mã nào (vd mất kết nối, lỗi JS) → lỗi hệ thống, phải ném lại', () => {
    expect(laLoiTrungDongDon(new Error('connection terminated unexpectedly'))).toBe(false);
  });

  it('null/undefined → lỗi hệ thống, phải ném lại (không ném TypeError)', () => {
    expect(laLoiTrungDongDon(null)).toBe(false);
    expect(laLoiTrungDongDon(undefined)).toBe(false);
  });
});
