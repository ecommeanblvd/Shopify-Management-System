/**
 * Cổng quyền của hai tệp ĐẨY CẤU HÌNH LÊN STORE SHOPIFY THẬT: `features/markets/actions.ts`
 * và `features/settings-sync/actions.ts`.
 *
 * Vì sao có tệp này: tới 24/10/2026 cả 11 + 7 export của hai tệp đó KHÔNG có một dòng kiểm
 * quyền nào, mà mọi export của tệp `'use server'` là một endpoint POST. Gác ở `page.tsx`
 * không đủ — thân trang chỉ chạy lúc RENDER, một POST thẳng vào action không kích hoạt nó;
 * cổng duy nhất của dashboard cũng ở `app/(dashboard)/layout.tsx:10-11`, cũng là render. Nên
 * mọi phiên đăng nhập gọi được, kể cả 3 tài khoản vai `viewer`.
 *
 * Lớp kiểm ở đây là HÀNH VI, không phải quét văn bản: lượt soát 24/10/2026 đã chứng minh một
 * bài "có chuỗi requirePerm trong tệp" bị qua bằng MỘT DÒNG CHÚ THÍCH. Nên `@/db/client` bị
 * mock thành "chạm là ném": thiếu quyền thì phải ném `Forbidden` TRƯỚC khi chạm DB, và nếu ai
 * dời cổng xuống sau cú đọc đầu tiên thì lỗi sẽ là `CHAM-DB`, test đỏ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let chamDb = 0;
/* `function` chứ không phải `const`: `vi.mock` được kéo lên đầu tệp nên factory chạy TRƯỚC
 * khi một `const` kịp khởi tạo. Khai báo hàm thì được hoisted, còn `chamDb` chỉ bị đọc/ghi
 * lúc hàm được GỌI (trong test), nên không vướng. */
function chamLaNem(): never { chamDb++; throw new Error('CHAM-DB'); }

vi.mock('@/db/client', () => ({
  db: { select: chamLaNem, insert: chamLaNem, update: chamLaNem, delete: chamLaNem, transaction: chamLaNem },
  // Proxy dựng NGAY trong factory, cùng lý do hoisting. `eq(schema.x.y, v)` chỉ được tính
  // sau khi `db.<method>()` đã ném, nên hình dạng nông thế này là đủ.
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => 'cot' }) }),
}));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
const getSessionMock = vi.fn();
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } } }));
const getRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({ getRole: (...a: unknown[]) => getRoleMock(...a) }));
const hasPermissionMock = vi.fn();
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => hasPermissionMock(...a) }));

import * as markets from './actions';
import * as sync from '@/features/settings-sync/actions';

beforeEach(() => {
  chamDb = 0;
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } });
  getRoleMock.mockReset().mockResolvedValue('viewer');
  hasPermissionMock.mockReset().mockReturnValue(false);
});

/** Mỗi dòng: tên hiển thị · hàm gọi · khoá quyền BẮT BUỘC phải có. */
const CA: Array<[string, () => Promise<unknown>, string]> = [
  ['markets.seedDefaultMarkets', () => markets.seedDefaultMarkets(), 'manage_markets_template'],
  ['markets.saveTemplate', () => markets.saveTemplate({ handle: 'vn' } as never), 'manage_markets_template'],
  ['markets.deleteTemplate', () => markets.deleteTemplate('vn'), 'manage_markets_template'],
  ['markets.saveOverride', () => markets.saveOverride({ storeId: 's', marketHandle: 'vn' } as never), 'apply_markets'],
  ['markets.previewMarketsApply', () => markets.previewMarketsApply('s'), 'apply_markets'],
  ['markets.executeMarketsApply', () => markets.executeMarketsApply('s'), 'apply_markets'],
  ['markets.executeMarketsApplyAll', () => markets.executeMarketsApplyAll(), 'apply_markets'],
  ['sync.saveTemplate', () => sync.saveTemplate('shipping' as never, {}), 'manage_settings_template'],
  ['sync.setStoreReconciled', () => sync.setStoreReconciled('s', 'shipping' as never), 'reconcile_store'],
  ['sync.previewApply', () => sync.previewApply('s', 'shipping' as never, 1), 'apply_settings'],
  ['sync.executeApply', () => sync.executeApply(['s'], 'shipping' as never, 1), 'apply_settings'],
];

describe('nhóm ghi nặng: đẩy cấu hình lên store Shopify thật', () => {
  it.each(CA)('%s — thiếu quyền thì NÉM và KHÔNG chạm DB', async (_ten, goi) => {
    await expect(goi()).rejects.toThrow('Forbidden');
    expect(chamDb).toBe(0);
  });

  it.each(CA)('%s — chưa đăng nhập thì NÉM và KHÔNG chạm DB', async (_ten, goi) => {
    getSessionMock.mockResolvedValue(null);
    await expect(goi()).rejects.toThrow('Unauthorized');
    expect(chamDb).toBe(0);
  });

  /* Gác ĐÚNG khoá. Không có lớp này thì ai "sửa cho dễ dùng" thành một khoá rộng hơn
   * (`view_markets_history` — vai `viewer` CÓ) sẽ đi qua hai lớp trên. Cách kiểm: cho vai có
   * MỌI quyền TRỪ khoá cần, rồi đòi nó vẫn phải bị chặn. */
  it.each(CA)('%s — gác đúng khoá, không nhận khoá rộng hơn', async (_ten, goi, khoa) => {
    hasPermissionMock.mockImplementation((_r: string, p: string) => p !== khoa);
    await expect(goi()).rejects.toThrow('Forbidden');
    expect(chamDb).toBe(0);
  });
});
