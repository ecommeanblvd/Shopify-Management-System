/**
 * Cổng quyền của các server action trong `features/mmp/`.
 *
 * Vì sao có tệp này: tới 24/10/2026 `setBrandStatus` (`brand-actions.ts`) KHÔNG có một dòng
 * kiểm quyền nào. Trang `/f/mmp/[brandSlug]` gác `view_mmp_products` để vào và chỉ dùng
 * `manage_mmp_products` để **ẩn/hiện nút** — mà ẩn nút không chặn được ai gọi thẳng server
 * action (mỗi export của file `'use server'` là MỘT endpoint; chính repo này viết ra điều đó ở
 * `features/cx-ticket/nguoi.ts:4-6`). Hệ quả: bất kỳ ai đăng nhập được và có
 * `view_mmp_products` — gồm cả vai `viewer` — đều đổi được trạng thái brand, mà `archived` ép
 * TOÀN BỘ sản phẩm của brand sang `archived` và không hoàn tác.
 *
 * Hai lớp canh, cố ý khác loại:
 *  1. **Hành vi** — thiếu quyền thì NÉM và **không chạm DB**. Quan trọng hơn "có gọi
 *     requirePerm không": nó chứng minh cú ghi cascade không chạy. Mock theo đúng nếp
 *     `features/dong-hang/actions.test.ts` (mock `@/db/client` vì nó tạo Pool lúc import).
 *  2. **Cấu trúc** — quét cả module, liệt kê export nào còn chưa gác, và ghim danh sách đó
 *     CHÍNH XÁC. Thêm action mới mà quên cổng thì đỏ; vá được một cái thì cũng đỏ, buộc người
 *     sửa gỡ nó khỏi danh sách — nên món nợ không nằm lại im lặng được.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Mọi payload đã gửi cho `.update(...).set(...)`, theo đúng thứ tự gọi. */
const updateSets: Array<Record<string, unknown>> = [];
let updateCalls = 0;
let rowCount = 0;

vi.mock('@/db/client', () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updateCalls++;
        updateSets.push(v);
        return { where: () => Promise.resolve({ rowCount }) };
      },
    }),
  },
  schema: {
    mmpProducts: { brandSlug: 'brand_slug', curationStatus: 'curation_status', status: 'status' },
    mmpBrands: { slug: 'slug', status: 'status' },
  },
}));

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

const getSessionMock = vi.fn();
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } } }));

const getRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({ getRole: (...a: unknown[]) => getRoleMock(...a) }));

const hasPermissionMock = vi.fn();
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => hasPermissionMock(...a) }));

import { setBrandStatus } from './brand-actions';

beforeEach(() => {
  updateSets.length = 0;
  updateCalls = 0;
  rowCount = 3;
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } });
  getRoleMock.mockReset().mockResolvedValue('operator');
  hasPermissionMock.mockReset().mockReturnValue(true);
});

describe('setBrandStatus — gác manage_mmp_products Ở TRONG HÀM, không tin trang gác hộ', () => {
  /**
   * Ca chính. Vai `viewer` có `view_mmp_products` nên qua được cổng của TRANG; trước lượt vá
   * thì tới đây là ghi thẳng. Phải NÉM, và `updateCalls` phải bằng 0 — nếu cổng bị dời xuống
   * sau cú `update` đầu tiên thì test này vẫn đỏ, còn một test "có gọi requirePerm không" thì
   * không.
   */
  it('thiếu manage_mmp_products → NÉM và KHÔNG chạm DB lần nào', async () => {
    hasPermissionMock.mockImplementation((_role: string, perm: string) => perm !== 'manage_mmp_products');
    await expect(setBrandStatus('la-vierge', 'archived')).rejects.toThrow('Forbidden');
    expect(updateCalls).toBe(0);
    expect(updateSets).toEqual([]);
  });

  /** Chưa đăng nhập thì chặn trước cả bước tra vai — và vẫn không chạm DB. */
  it('chưa đăng nhập → NÉM và KHÔNG chạm DB lần nào', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(setBrandStatus('la-vierge', 'archived')).rejects.toThrow('Unauthorized');
    expect(updateCalls).toBe(0);
  });

  /**
   * Gác ĐÚNG khoá. Không có test này thì ai đó "sửa cho dễ dùng" thành `view_mmp_products` sẽ
   * đi qua mọi test khác — và đó đúng là mức quyền mà lỗ cũ đang để lọt.
   */
  it('kiểm đúng quyền manage_mmp_products, không phải view_mmp_products', async () => {
    await setBrandStatus('la-vierge', 'active');
    expect(hasPermissionMock).toHaveBeenCalledWith('operator', 'manage_mmp_products');
    expect(hasPermissionMock).not.toHaveBeenCalledWith('operator', 'view_mmp_products');
  });

  /**
   * Có quyền thì vẫn chạy đúng cascade đã ghi trong tài liệu hàm. Ghim ở đây để lượt vá quyền
   * không lặng lẽ đổi hành vi: `archived` ép MỌI sản phẩm của brand, `deactive` chỉ hạ dòng
   * `approved` về `draft`, `active` KHÔNG đụng sản phẩm nào.
   */
  it('có quyền: archived ép mọi sản phẩm của brand về archived', async () => {
    const r = await setBrandStatus('la-vierge', 'archived');
    expect(r.productsChanged).toBe(3);
    // Hai cú: cascade sản phẩm, rồi trạng thái brand.
    expect(updateSets).toEqual([
      { curationStatus: 'archived', status: 'archived' },
      { status: 'archived' },
    ]);
  });

  it('có quyền: deactive hạ sản phẩm approved về draft', async () => {
    await setBrandStatus('la-vierge', 'deactive');
    expect(updateSets).toEqual([
      { curationStatus: 'draft', status: 'draft' },
      { status: 'deactive' },
    ]);
  });

  it('có quyền: active KHÔNG đụng sản phẩm nào, chỉ bật lại brand', async () => {
    const r = await setBrandStatus('la-vierge', 'active');
    expect(r.productsChanged).toBe(0);
    expect(updateSets).toEqual([{ status: 'active' }]);
  });
});

/**
 * Quét cấu trúc cả `features/mmp/`: file `'use server'` thì MỖI export là một endpoint công
 * khai, nên mỗi `export async function` phải có cổng quyền trong thân hàm.
 *
 * Phạm vi cố ý chỉ là `features/mmp/` — đo 24/10/2026 thì cả `features/` có 125 file
 * `'use server'` và ~176 export không thấy dấu hiệu gác; dựng một danh sách cỡ đó mà chưa
 * phân loại từng cái thì nó là tiếng ồn, không phải hàng rào. Mở rộng là việc riêng, cần
 * controller quyết phạm vi.
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

/** Dấu hiệu "có cổng": đủ cho module này — mọi cổng ở đây đi qua một trong hai hàm. */
const CO_CONG = /requirePerm\s*\(|hasPermission\s*\(/;

describe("features/mmp: mọi export của file 'use server' phải có cổng quyền", () => {
  it('danh sách export CHƯA gác đúng bằng danh sách đã biết và đã báo', () => {
    const chuaGac: string[] = [];
    for (const p of moiFileTs('features/mmp')) {
      const s = readFileSync(p, 'utf8');
      // Chỉ tính chỉ thị ở ĐẦU file, không tính chữ 'use server' trong chú thích.
      if (!/^\s*(['"])use server\1\s*;?/.test(s)) continue;
      const moc: Array<{ ten: string; tai: number }> = [];
      for (const m of s.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
        moc.push({ ten: m[1]!, tai: m.index! });
      }
      for (let i = 0; i < moc.length; i++) {
        const than = s.slice(moc[i]!.tai, i + 1 < moc.length ? moc[i + 1]!.tai : s.length);
        if (!CO_CONG.test(than)) chuaGac.push(`${p}:${moc[i]!.ten}`);
      }
    }
    /* Ba hàm này là LÕI KHÔNG-AUTH cố ý, gọi từ cron (`app/api/cron/retry-mmp-orders/route.ts`,
     * gác bằng `CRON_SECRET`) và từ `scripts/` — thêm `requirePerm` vào là CHẶN NHẦM cron, vì
     * cron không có phiên đăng nhập. Nhưng chúng đang nằm trong file `'use server'` nên vẫn là
     * endpoint gọi được: đường vá đúng là DỜI lõi sang một tệp KHÔNG có `'use server'` và chỉ
     * để lại `backfillMmpOrders` (đã gác) làm action. Việc đó ngoài phạm vi lượt 24/10/2026 —
     * đã báo controller, chờ quyết phạm vi. */
    expect(chuaGac).toEqual([
      'features/mmp/order-backfill.ts:pushUnsentBrandOrders',
      'features/mmp/order-backfill.ts:pushOwnedStoreOrders',
      'features/mmp/order-backfill.ts:forcePushAllBrandOrders',
    ]);
  });

  /** Hàm vừa vá phải nằm NGOÀI danh sách trên — ghim đích danh cho khỏi lọt lại. */
  it('setBrandStatus có cổng quyền trong thân hàm', () => {
    const s = readFileSync('features/mmp/brand-actions.ts', 'utf8');
    const than = s.slice(s.indexOf('export async function setBrandStatus'));
    expect(than).toMatch(/requirePerm\('manage_mmp_products'\)/);
  });
});
