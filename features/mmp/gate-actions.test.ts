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
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Đường dẫn suy từ VỊ TRÍ TỆP TEST, không từ `process.cwd()`: hai test quét tệp dưới đây mà
 * phụ thuộc cwd thì chỉ đúng khi `vitest` chạy từ gốc repo — cấu hình hôm nay đúng vậy, nhưng
 * một lượt chạy từ thư mục con sẽ làm test XANH OAN (không thấy tệp nào, danh sách rỗng). */
const THU_MUC_MMP = fileURLToPath(new URL('.', import.meta.url));
const GOC_REPO = fileURLToPath(new URL('../..', import.meta.url));

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

const pushUnsentMock = vi.fn();
vi.mock('@/features/mmp/order-backfill-core', () => ({
  pushUnsentBrandOrders: (...a: unknown[]) => pushUnsentMock(...a),
}));

import { setBrandStatus } from './brand-actions';
import { backfillMmpOrders } from './order-backfill';

beforeEach(() => {
  updateSets.length = 0;
  updateCalls = 0;
  rowCount = 3;
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } });
  getRoleMock.mockReset().mockResolvedValue('operator');
  hasPermissionMock.mockReset().mockReturnValue(true);
  pushUnsentMock.mockReset().mockResolvedValue({ pushed: 0, skipped: 0, failed: 0, total: 0 });
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

/* ====================================================================================
 * Ba hàm dưới đây có vì lượt soát 24/10/2026 chạy 4 đột biến và CẢ 4 ĐỀU XANH. Bài kiểm
 * cấu trúc quét văn bản thô, nên mỗi chỗ nó đọc hơi khác mã thật là một đường tái mở lỗ:
 *
 *  1. `'use server'` đặt SAU khối chú thích vẫn là directive hợp lệ (đo bằng chính SWC của
 *     Next 16: có `registerServerReference`). Mà `order-backfill-core.ts` mở đầu bằng một
 *     khối chú thích dài — chỗ "tự nhiên" để người sau chèn directive chính là dưới nó.
 *     Biểu thức chỉ neo `^` rồi khoảng trắng thì mù hoàn toàn với ca đó.
 *  2. `export const x = async () => {}` cũng là server action, mà regex `export async
 *     function` không thấy.
 *  3. `import { f } from './core'; export { f };` trong tệp `'use server'` ĐƯỢC SWC nhận và
 *     thành action — trả lại đúng ba endpoint bản vá vừa bỏ. (`export { f } from './core'`
 *     và `export * from` thì đổ build, nên chỉ dạng import-rồi-export là đường thật.)
 *  4. `CO_CONG` chạy trên văn bản CÓ chú thích, nên một dòng `// ... requirePerm(...)` là đủ
 *     qua cổng — xoá sạch gác mà vẫn xanh.
 * ==================================================================================== */

/** Chỉ thị `'use server'` ĐẦU TỆP, cho phép chú thích đứng trước (đúng luật directive
 *  prologue). Dùng CHUNG cho mọi chỗ nhận diện tệp action, để hai nơi không lệch nhau. */
const CHI_THI_DAU_TEP = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use server\1\s*;?/;

/** Bỏ chú thích và chuỗi-trông-giống-chú-thích trước khi tìm cổng: cổng nằm trong chú thích
 *  KHÔNG phải cổng. */
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
}

/** Mọi tên export có thể thành server action: `export async function f`, `export const f =
 *  async`, và danh sách `export { a, b }` (không có `from` — dạng có `from` đổ build). */
function moiTenExport(s: string): string[] {
  const ra: string[] = [];
  for (const m of s.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) ra.push(m[1]!);
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\b|[^=]*=>)/gm)) ra.push(m[1]!);
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const t of m[1]!.split(',')) {
      const ten = t.trim().split(/\s+as\s+/).pop()?.trim();
      if (ten && !/^type\b/.test(t.trim())) ra.push(ten);
    }
  }
  return ra;
}

/**
 * Lớp HÀNH VI cho action duy nhất của `order-backfill.ts`. Có vì lượt soát 24/10/2026 chứng
 * minh ba bài quét-văn-bản ở dưới đều qua được bằng một dòng chú thích: xoá sạch
 * `requirePerm` rồi để lại `// ... requirePerm('manage_fulfillment') ...` là vẫn xanh. Bài
 * này không đọc văn bản nào — nó gọi hàm thật và đo xem lõi CÓ chạy hay không, nên một cái
 * gác giả không lừa được.
 *
 * `pushUnsentBrandOrders` bị mock thành spy: nó là cú đẩy ra MMP của ĐỐI TÁC, nên "không gọi
 * lần nào" chính là điều cần chứng minh, đúng khuôn `setBrandStatus` ở trên (NÉM *và* không
 * chạm cú ghi).
 */
describe('backfillMmpOrders — gác manage_fulfillment Ở TRONG HÀM', () => {
  it('thiếu manage_fulfillment → NÉM và KHÔNG đẩy đơn nào sang MMP', async () => {
    hasPermissionMock.mockImplementation((_r: string, perm: string) => perm !== 'manage_fulfillment');
    await expect(backfillMmpOrders({ limit: 5 })).rejects.toThrow('Forbidden');
    expect(pushUnsentMock).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập → NÉM và KHÔNG đẩy đơn nào', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(backfillMmpOrders()).rejects.toThrow('Unauthorized');
    expect(pushUnsentMock).not.toHaveBeenCalled();
  });

  /* Gác ĐÚNG khoá: đổi sang một quyền rộng hơn (vd `view_mmp_products`) sẽ qua mọi bài khác. */
  it('đủ quyền → gọi lõi đúng một lần, truyền nguyên opts', async () => {
    await backfillMmpOrders({ limit: 7 });
    expect(pushUnsentMock).toHaveBeenCalledTimes(1);
    expect(pushUnsentMock).toHaveBeenCalledWith({ limit: 7 });
    expect(hasPermissionMock).toHaveBeenCalledWith('operator', 'manage_fulfillment');
  });
});

describe("features/mmp: mọi export của file 'use server' phải có cổng quyền", () => {
  it('danh sách export CHƯA gác đúng bằng danh sách đã biết và đã báo', () => {
    const chuaGac: string[] = [];
    for (const p of moiFileTs(THU_MUC_MMP)) {
      const goc = readFileSync(p, 'utf8');
      if (!CHI_THI_DAU_TEP.test(goc)) continue;
      const s = boChuThich(goc);
      // Re-export (`export { f }`) không có thân để soi cổng — nó LÀ một endpoint không gác.
      for (const m of s.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
        for (const t of m[1]!.split(',')) {
          const ten = t.trim().split(/\s+as\s+/).pop()?.trim();
          if (ten && !/^type\b/.test(t.trim())) chuaGac.push(`${relative(GOC_REPO, p)}:${ten} (re-export)`);
        }
      }
      const moc: Array<{ ten: string; tai: number }> = [];
      for (const m of s.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) moc.push({ ten: m[1]!, tai: m.index! });
      for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\b|[^=]*=>)/gm)) moc.push({ ten: m[1]!, tai: m.index! });
      moc.sort((a, b) => a.tai - b.tai);
      for (let i = 0; i < moc.length; i++) {
        const than = s.slice(moc[i]!.tai, i + 1 < moc.length ? moc[i + 1]!.tai : s.length);
        // Báo theo đường dẫn tương đối GỐC REPO để danh sách ghim không mang đường dẫn máy.
        if (!CO_CONG.test(than)) chuaGac.push(`${relative(GOC_REPO, p)}:${moc[i]!.ten}`);
      }
    }
    /* Danh sách này phải RỖNG. Ba lõi đẩy đơn (`pushUnsentBrandOrders`, `pushOwnedStoreOrders`,
     * `forcePushAllBrandOrders`) từng nằm trong `order-backfill.ts` mà không có cổng nào — và
     * cổng quyền KHÔNG phải đường vá cho chúng, vì cron gọi chúng mà không có phiên đăng nhập.
     * Vá bằng cách DỜI cả ba sang `order-backfill-core.ts`, một tệp không có `'use server'`
     * (24/10/2026). Ba bài kiểm ngay dưới ghim bản vá: hai bài CẤU TRÚC (quét văn bản) và
     * một bài HÀNH VI. Bài hành vi là bài không phụ thuộc regex nào — xem chú thích của nó. */
    expect(chuaGac).toEqual([]);
  });

  /** NỬA MỘT của bản vá: tệp lõi không được mang `'use server'`. Thêm chỉ thị đó vào là ba hàm
   *  đẩy đơn thành endpoint công khai trở lại, và không bài nào khác bắt được —
   *  `forcePushAllBrandOrders()` không mốc ngày là đẩy sạch 13.006 đơn từ 2020 sang MMP của
   *  ĐỐI TÁC (đếm thật 24/10/2026). Ghim bằng CHÍNH biểu thức mà bài trên dùng để nhận ra tệp action. */
  it("order-backfill-core.ts KHÔNG mang 'use server'", () => {
    const s = readFileSync(join(THU_MUC_MMP, 'order-backfill-core.ts'), 'utf8');
    // Hằng CHUNG, nhận cả directive đặt sau chú thích — đột biến #1 của lượt soát.
    expect(CHI_THI_DAU_TEP.test(s)).toBe(false);
    // Và ba lõi vẫn phải Ở ĐÂY: dời về lại tệp action thì bài trên bắt, dời sang một tệp thứ
    // ba (có `'use server'`) thì bài này bắt.
    for (const ten of ['pushUnsentBrandOrders', 'pushOwnedStoreOrders', 'forcePushAllBrandOrders']) {
      expect(s).toContain(`export async function ${ten}`);
    }
  });

  /** NỬA HAI: tệp action chỉ được có ĐÚNG MỘT export, và nó phải gác quyền trong thân hàm.
   *  Mỗi export thêm vào tệp đó là một endpoint công khai thêm. */
  it('order-backfill.ts chỉ có đúng một export, và nó gác quyền', () => {
    const s = boChuThich(readFileSync(join(THU_MUC_MMP, 'order-backfill.ts'), 'utf8'));
    // Mọi DẠNG export, không chỉ `export async function` — đột biến #2 và #3.
    expect(moiTenExport(s)).toEqual(['backfillMmpOrders']);
    // Tìm cổng trên văn bản ĐÃ BỎ chú thích — đột biến #4.
    expect(s.slice(s.indexOf('export async function backfillMmpOrders')))
      .toMatch(/requirePerm\('manage_fulfillment'\)/);
  });

  /** Hàm vừa vá phải nằm NGOÀI danh sách trên — ghim đích danh cho khỏi lọt lại. */
  it('setBrandStatus có cổng quyền trong thân hàm', () => {
    const s = readFileSync(join(THU_MUC_MMP, 'brand-actions.ts'), 'utf8');
    const than = s.slice(s.indexOf('export async function setBrandStatus'));
    expect(than).toMatch(/requirePerm\('manage_mmp_products'\)/);
  });
});
