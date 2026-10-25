/**
 * Cổng quyền của sổ hoá đơn carrier, tài khoản carrier, và luồng nhập FBO.
 *
 * Vì sao có tệp này: tới 24/10/2026 `ap/bills-actions.ts` (8 export), `ap/fbo-import-actions.ts`
 * (4) và `carrier-rates/actions.ts` (6) đều mang `'use server'` mà KHÔNG có một dòng kiểm
 * quyền nào — tức 18 endpoint POST công khai lên sổ sách đo được 242 hoá đơn /
 * 14.719.454.621 đ. Cửa vào trang chỉ đòi `view_carrier_rates` (`bills/page.tsx:41`,
 * `[id]/page.tsx:47`), mà vai `viewer` CÓ.
 *
 * Lớp kiểm là HÀNH VI: `@/db/client` mock thành "chạm là ném", nên cổng phải chặn TRƯỚC khi
 * chạm DB. Bài quét văn bản không đủ — lượt soát 24/10/2026 chứng minh một dòng chú thích là
 * qua được.
 *
 * RANH GIỚI HAI QUYỀN, phần dễ vá hỏng nhất: luồng NHẬP hoá đơn cố ý nhận
 * `manage_shipping_invoices` HOẶC `manage_carrier_rates` — vai `logistics` chỉ có khoá đầu
 * (`bills/page.tsx:47-50` và chú thích tại chỗ). Còn thanh toán và xoá thì PHẢI
 * `manage_carrier_rates`. Siết luồng nhập về một khoá là chặn nhầm logistics, nên có hẳn một
 * lớp test đòi logistics vẫn qua được.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let chamDb = 0;
function chamLaNem(): never { chamDb++; throw new Error('CHAM-DB'); }

vi.mock('@/db/client', () => ({
  db: { select: chamLaNem, insert: chamLaNem, update: chamLaNem, delete: chamLaNem, transaction: chamLaNem },
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => 'cot' }) }),
}));
/* S3 cũng phải "chạm là ném": `createBill` tải tệp lên TRƯỚC khi ghi DB, nên nếu cổng hụt mà
 * chỉ mock DB thì cú ghi ra ngoài vẫn chạy thật mà test không thấy. */
vi.mock('@/lib/storage/s3', () => ({ putObject: () => { chamDb++; throw new Error('CHAM-S3'); } }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
const getSessionMock = vi.fn();
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } } }));
const getRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({ getRole: (...a: unknown[]) => getRoleMock(...a) }));
const hasPermissionMock = vi.fn();
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => hasPermissionMock(...a) }));

import * as bills from './bills-actions';
import * as fbo from './fbo-import-actions';
import * as accounts from '@/features/carrier-rates/actions';

beforeEach(() => {
  chamDb = 0;
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } });
  getRoleMock.mockReset().mockResolvedValue('viewer');
  hasPermissionMock.mockReset().mockReturnValue(false);
});

const BILL = {
  carrierAccountId: 'a', billNumber: 'B1', periodStart: '2026-10-01', periodEnd: '2026-10-31',
  issueDate: '2026-10-31', amount: 1000, currency: 'VND', userId: 'u1',
} as never;

/** Mọi hàm GHI, kèm nhóm quyền của nó. 'mcr' = chỉ `manage_carrier_rates`; 'hoa-don' = một
 *  trong hai khoá. */
const CA: Array<[string, () => Promise<unknown>, 'mcr' | 'hoa-don']> = [
  ['bills.createBill', () => bills.createBill(BILL), 'hoa-don'],
  ['bills.addPayment', () => bills.addPayment({ billId: 'b', amount: 1 } as never), 'mcr'],
  ['bills.deleteBill', () => bills.deleteBill('b'), 'mcr'],
  ['bills.deletePayment', () => bills.deletePayment('p'), 'mcr'],
  ['accounts.createAccount', () => accounts.createAccount({ carrierId: 'c', name: 'X' } as never), 'mcr'],
  ['accounts.updateAccount', () => accounts.updateAccount({ id: 'a', enabled: false } as never), 'mcr'],
  ['accounts.deleteAccount', () => accounts.deleteAccount('a'), 'mcr'],
  ['fbo.previewFboBill', () => fbo.previewFboBill(new Uint8Array([1, 2])), 'hoa-don'],
  ['fbo.previewFboRows', () => fbo.previewFboRows([]), 'hoa-don'],
  ['fbo.applyFboBill', () => fbo.applyFboBill({ carrierAccountId: 'a', currency: 'VND', userId: 'u1', bytes: new Uint8Array([1]), filename: 'f', contentType: 'text/csv' } as never), 'hoa-don'],
];

describe('nhóm ghi nặng: sổ hoá đơn, tài khoản carrier, nhập FBO', () => {
  it.each(CA)('%s — thiếu quyền thì NÉM và KHÔNG chạm DB/S3', async (_t, goi) => {
    await expect(goi()).rejects.toThrow('Forbidden');
    expect(chamDb).toBe(0);
  });

  it.each(CA)('%s — chưa đăng nhập thì NÉM và KHÔNG chạm DB/S3', async (_t, goi) => {
    getSessionMock.mockResolvedValue(null);
    await expect(goi()).rejects.toThrow('Unauthorized');
    expect(chamDb).toBe(0);
  });

  /* `view_carrier_rates` là khoá mở CỬA VÀO TRANG và vai `viewer` CÓ. Nên nó phải KHÔNG đủ
   * để ghi — đây chính là mức quyền mà lỗ cũ để lọt. */
  it.each(CA)('%s — chỉ có view_carrier_rates thì vẫn bị chặn', async (_t, goi) => {
    hasPermissionMock.mockImplementation((_r: string, p: string) => p === 'view_carrier_rates');
    await expect(goi()).rejects.toThrow('Forbidden');
    expect(chamDb).toBe(0);
  });
});

describe('ranh giới hai quyền của luồng hoá đơn', () => {
  const chiHoaDon = () => hasPermissionMock.mockImplementation(
    (_r: string, p: string) => p === 'manage_shipping_invoices');

  /** Vai `logistics` (chỉ có quyền hoá đơn) PHẢI qua được cổng của luồng nhập. Cách đo không
   *  cần DB: truyền số tiền 0 để hàm ném lỗi NGHIỆP VỤ — ném được lỗi đó tức là đã đi qua
   *  cổng. Nếu ai siết `createBill` về một khoá, lỗi sẽ thành `Forbidden` và test đỏ. */
  it('createBill: chỉ manage_shipping_invoices vẫn qua cổng (logistics không bị chặn)', async () => {
    chiHoaDon();
    await expect(bills.createBill({ ...(BILL as object), amount: 0 } as never))
      .rejects.toThrow('Số tiền hoá đơn phải > 0.');
    expect(chamDb).toBe(0);
  });

  it.each([
    ['previewFboRows', () => fbo.previewFboRows([])],
  ])('%s: chỉ manage_shipping_invoices vẫn qua cổng', async (_t, goi) => {
    chiHoaDon();
    await goi().catch((e: Error) => {
      expect(e.message).not.toMatch(/Forbidden|Unauthorized/);
    });
  });

  /** Mặt kia của ranh giới: thanh toán và xoá KHÔNG được nhận quyền hoá đơn. Không có lớp này
   *  thì ai "gộp cho gọn" hai nhóm lại sẽ mở quyền xoá hoá đơn cho vai logistics. */
  it.each([
    ['addPayment', () => bills.addPayment({ billId: 'b', amount: 1 } as never)],
    ['deleteBill', () => bills.deleteBill('b')],
    ['deletePayment', () => bills.deletePayment('p')],
  ])('%s: quyền hoá đơn là KHÔNG đủ', async (_t, goi) => {
    chiHoaDon();
    await expect(goi()).rejects.toThrow('Forbidden');
    expect(chamDb).toBe(0);
  });
});

describe("ba tệp này phải thôi mang 'use server'", () => {
  /* NỬA CẤU TRÚC của bản vá. Biểu thức cho phép chú thích đứng trước directive — đúng luật
   * directive prologue, và đúng cái bẫy mà lượt soát 24/10/2026 bắt được ở `features/mmp`:
   * một biểu thức chỉ neo đầu tệp sẽ mù với `'use server'` đặt dưới khối chú thích, mà cả ba
   * tệp dưới đây giờ đều MỞ ĐẦU bằng một khối chú thích dài. */
  const CHI_THI = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use server\1\s*;?/;
  it.each([
    'features/carrier-rates/ap/bills-actions.ts',
    'features/carrier-rates/ap/fbo-import-actions.ts',
    'features/carrier-rates/actions.ts',
  ])('%s', async (duong) => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const goc = fileURLToPath(new URL('../../..', import.meta.url));
    expect(CHI_THI.test(readFileSync(goc + duong, 'utf8'))).toBe(false);
  });
});
