/**
 * Cổng quyền của ba server action nạp CSV: `applySkuCosts` (`manage_sku_costs`),
 * `applyShippingInvoice` và `applyShippingInvoiceGlobal` (`manage_shipping_invoices`).
 *
 * Vì sao có tệp này: tới 25/10/2026 cả ba KHÔNG kiểm quyền. Các trang gọi chúng chỉ gác ở
 * THÂN TRANG (`orders/[storeId]/costs/page.tsx:22`, `.../shipping-invoices/page.tsx:23`) —
 * chỉ chạy lúc render, nên một POST thẳng vào action không kích hoạt. Riêng action nội tuyến
 * của trang costs và trang shipping-invoices theo store còn không kiểm gì ngoài "có phiên".
 * Hai bảng đích (`sku_costs`, `shipping_invoices`) là nguồn giá vốn / chi phí vận chuyển
 * thực của P&L, nên ghi đè chúng là bóp méo biên lợi nhuận.
 *
 * Lớp quan trọng nhất là HÀNH VI: thiếu quyền → NÉM và **không chạm DB lần nào** (đếm MỌI
 * lời gọi gốc `db.*`, kể cả `select`/`execute` đọc), theo khuôn
 * `features/mmp/gate-actions.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THU_MUC = fileURLToPath(new URL('.', import.meta.url));

const h = vi.hoisted(() => {
  const state = {
    touches: 0,
    calls: [] as Array<{ op: string; args: unknown[] }>,
    rows: [] as unknown,
  };
  const chain = (): unknown =>
    new Proxy(function noop() {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(state.rows).then(res, rej);
        }
        return (...args: unknown[]) => {
          state.calls.push({ op: String(prop), args });
          return chain();
        };
      },
    });
  const root = (op: string) => (...args: unknown[]) => {
    state.touches++;
    state.calls.push({ op, args });
    return chain();
  };
  return {
    state,
    db: {
      select: root('select'), insert: root('insert'), update: root('update'),
      delete: root('delete'), execute: root('execute'), transaction: root('transaction'),
    },
  };
});

vi.mock('@/db/client', () => ({
  db: h.db,
  schema: new Proxy({}, { get: () => new Proxy({}, { get: (_t, k) => String(k) }) }),
}));

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

const getSessionMock = vi.fn();
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } } }));

const getRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({ getRole: (...a: unknown[]) => getRoleMock(...a) }));

const hasPermissionMock = vi.fn();
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => hasPermissionMock(...a) }));

import { applySkuCosts } from './apply-sku-costs';
import { applyShippingInvoice, applyShippingInvoiceGlobal } from './apply-shipping-invoice';

const CSV_GIA_VON = 'sku,cost,currency,effective_from\nABC-1,12.5,USD,2026-10-01\n';
const CSV_BANG_KE = 'tracking_number,actual_cost,currency,date\nTRK1,99.5,USD,2026-10-01\n';

const CAC_HAM: Array<{ ten: string; khoa: string; goi: () => Promise<unknown> }> = [
  {
    ten: 'applySkuCosts', khoa: 'manage_sku_costs',
    goi: () => applySkuCosts({ storeId: 's1', csvText: CSV_GIA_VON, filename: 'a.csv' }),
  },
  {
    ten: 'applyShippingInvoice', khoa: 'manage_shipping_invoices',
    goi: () => applyShippingInvoice({
      storeId: 's1', carrierAccountId: 'acc', invoicePeriodStart: '2026-10-01',
      invoicePeriodEnd: '2026-10-07', csvText: CSV_BANG_KE, filename: 'b.csv',
    }),
  },
  {
    ten: 'applyShippingInvoiceGlobal', khoa: 'manage_shipping_invoices',
    goi: () => applyShippingInvoiceGlobal({
      carrierAccountId: 'acc', invoicePeriodStart: '2026-10-01',
      invoicePeriodEnd: '2026-10-07', csvText: CSV_BANG_KE, filename: 'b.csv',
    }),
  },
];

beforeEach(() => {
  h.state.touches = 0;
  h.state.calls.length = 0;
  // Dạng đủ cho cả ba: `db.execute` đọc `.rows`, `db.select` đọc `.length`.
  h.state.rows = Object.assign([], { rows: [{ count: '0', tracking: 'TRK1', store_id: 's1' }] });
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u-that' } });
  getRoleMock.mockReset().mockResolvedValue('operator');
  hasPermissionMock.mockReset().mockReturnValue(true);
});

describe.each(CAC_HAM)('$ten — gác Ở TRONG HÀM', ({ khoa, goi }) => {
  /**
   * Ca chính: CSV hợp lệ, phiên hợp lệ, nhưng vai không có quyền → phải NÉM trước mọi cú DB
   * (kể cả bước đọc đếm số dòng sẽ bị ghi đè) — một cổng đặt sau bước đó vẫn làm test đỏ.
   */
  it(`thiếu ${khoa} → NÉM Forbidden và KHÔNG chạm DB lần nào`, async () => {
    hasPermissionMock.mockImplementation((_r: string, perm: string) => perm !== khoa);
    await expect(goi()).rejects.toThrow('Forbidden');
    expect(h.state.touches).toBe(0);
    expect(h.state.calls).toEqual([]);
  });

  it('chưa đăng nhập → NÉM Unauthorized và KHÔNG chạm DB lần nào', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(goi()).rejects.toThrow('Unauthorized');
    expect(h.state.touches).toBe(0);
  });

  it(`đủ quyền → kiểm đúng ${khoa} rồi mới ghi`, async () => {
    await goi();
    expect(hasPermissionMock).toHaveBeenCalledWith('operator', khoa);
    expect(h.state.calls.some((c) => c.op === 'insert')).toBe(true);
  });
});

describe('applySkuCosts — danh tính người tải lấy từ PHIÊN', () => {
  /** Trước đây `userId` là trường của `input`: kẻ gọi thẳng đổ tên người khác vào `uploaded_by`. */
  it('uploaded_by = người trong phiên, bỏ qua userId giả trong input', async () => {
    await applySkuCosts({ storeId: 's1', csvText: CSV_GIA_VON, filename: 'a.csv', userId: 'ke-gia-mao' } as never);
    const values = h.state.calls.filter((c) => c.op === 'values').map((c) => c.args[0] as Record<string, unknown>);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ uploadedBy: 'u-that' });
    expect(JSON.stringify(h.state.calls)).not.toContain('ke-gia-mao');
    // Nhánh ghi đè (onConflictDoUpdate) cũng phải mang người trong phiên.
    const conflict = h.state.calls.find((c) => c.op === 'onConflictDoUpdate')!.args[0] as { set: Record<string, unknown> };
    expect(conflict.set).toMatchObject({ uploadedBy: 'u-that' });
  });

  it('CSV lỗi thì trả lỗi, không ghi — nhưng vẫn phải qua cổng trước', async () => {
    hasPermissionMock.mockReturnValue(false);
    await expect(applySkuCosts({ storeId: 's1', csvText: 'sai,tieu,de\n', filename: 'x.csv' }))
      .rejects.toThrow('Forbidden');
  });
});

/* Quét văn bản đã BỎ chú thích: một dòng `// requirePerm(...)` không phải cổng. */
function thanHam(tep: string, ten: string): string {
  const s = readFileSync(join(THU_MUC, tep), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
  const i = s.indexOf(`export async function ${ten}`);
  expect(i, `${tep}: không thấy ${ten}`).toBeGreaterThanOrEqual(0);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? s.length : j);
}

describe('ghim văn bản: cổng nằm trong thân hàm, đúng khoá', () => {
  it('applySkuCosts gác manage_sku_costs, input không còn userId', () => {
    expect(thanHam('apply-sku-costs.ts', 'applySkuCosts')).toMatch(/requirePerm\('manage_sku_costs'\)/);
    const s = readFileSync(join(THU_MUC, 'apply-sku-costs.ts'), 'utf8');
    expect(s.match(/export interface ApplySkuCostsInput \{[\s\S]*?\n\}/)![0]).not.toMatch(/userId/);
  });

  it.each(['applyShippingInvoice', 'applyShippingInvoiceGlobal'])('%s gác manage_shipping_invoices', (ten) => {
    expect(thanHam('apply-shipping-invoice.ts', ten)).toMatch(/requirePerm\('manage_shipping_invoices'\)/);
  });
});
