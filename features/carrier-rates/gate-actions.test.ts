/**
 * Cổng quyền của các server action GHI trong `features/carrier-rates/` (hạng 3 + hạng 4):
 * ma trận giá, phụ phí, bậc cân, zone, seed demand FedEx, link market-carrier và đẩy giá
 * lên `market_store_overrides`.
 *
 * Vì sao có tệp này: tới 25/10/2026 các hàm này KHÔNG có một dòng kiểm quyền nào, còn các
 * trang gọi chúng chỉ gác ở THÂN TRANG. Thân trang chỉ chạy lúc render; mỗi export của tệp
 * `'use server'` là một endpoint POST, nên một POST thẳng vào action không kích hoạt nó.
 * Các bảng này lại được route carrier-service đọc trực tiếp khi khách thanh toán
 * (`app/api/shopify/carrier-service/[storeId]/route.ts:63`) — sửa chúng là đổi GIÁ KHÁCH THẤY.
 *
 * Hai lớp canh, theo khuôn `features/mmp/gate-actions.test.ts`:
 *  1. **Hành vi** — thiếu quyền thì NÉM và **không chạm DB lần nào** (đếm MỌI lời gọi gốc
 *     `db.select/insert/update/delete/execute/transaction`, không chỉ cú ghi). Quan trọng hơn
 *     "có chuỗi requirePerm trong tệp": một dòng chú thích là qua được bài đó, còn bài này
 *     gọi hàm thật và đo xem lõi CÓ chạy hay không.
 *  2. **Danh sách export** — ghim CHÍNH XÁC hàm nào gác, hàm ĐỌC nào cố ý không gác. Thêm
 *     action ghi mới mà quên cổng thì đỏ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THU_MUC = fileURLToPath(new URL('.', import.meta.url));

/* ------------------------------------------------------------------------------------
 * Mock DB: `db.*` gốc đếm số lần chạm; mọi lời gọi nối sau (`.values`, `.set`, `.where`...)
 * được ghi lại để soi payload. Chuỗi gọi là thenable → `await` ra `h.rows`.
 * ---------------------------------------------------------------------------------- */
const h = vi.hoisted(() => {
  const state = {
    touches: 0,
    calls: [] as Array<{ op: string; args: unknown[] }>,
    rows: [] as unknown,
    /** Kết quả riêng cho từng lời gọi gốc theo thứ tự; hết thì dùng `rows`. */
    queue: [] as unknown[],
  };
  const chain = (result: unknown): unknown =>
    new Proxy(function noop() {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej);
        }
        return (...args: unknown[]) => {
          state.calls.push({ op: String(prop), args });
          return chain(result);
        };
      },
    });
  const root = (op: string) => (...args: unknown[]) => {
    state.touches++;
    state.calls.push({ op, args });
    return chain(state.queue.length > 0 ? state.queue.shift() : state.rows);
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
  // `schema.x.y` → chuỗi; đủ cho `eq(...)`, `asc(...)`, `sql\`...\`` của drizzle.
  schema: new Proxy({}, { get: () => new Proxy({}, { get: (_t, k) => String(k) }) }),
}));

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

const getSessionMock = vi.fn();
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } } }));

const getRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({ getRole: (...a: unknown[]) => getRoleMock(...a) }));

const hasPermissionMock = vi.fn();
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => hasPermissionMock(...a) }));

const loadSnapshotMock = vi.fn();
vi.mock('@/features/carrier-rates/engine/load', () => ({
  loadAccountSnapshot: (...a: unknown[]) => loadSnapshotMock(...a),
}));

vi.mock('@/lib/logging/audit', () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { setCell, clearCell, importMatrix, loadMatrix } from './matrix-actions';
import {
  createSurcharge, updateSurcharge, deleteSurcharge, listSurcharges,
} from './surcharges-actions';
import {
  createWeightTier, deleteWeightTier, seedDefaultTiers, listWeightTiers,
} from './tiers-actions';
import {
  createZone, renameZone, patchZoneCountries, deleteZone, listZonesWithCountries,
} from './zones-actions';
import { seedFedexVietnamDemand } from './seed-fedex-vn-demand';
import { commitPushPlan, buildPushPlan } from './push/commit';
import {
  createLink, updateLink, deleteLink,
  listLinksForMarket, listMarketsForCarrier, listLinkableCarrierAccounts,
} from './links-actions';

beforeEach(() => {
  h.state.touches = 0;
  h.state.calls.length = 0;
  h.state.rows = [{ next: 0, id: 'new-id' }];
  h.state.queue.length = 0;
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } });
  getRoleMock.mockReset().mockResolvedValue('operator');
  hasPermissionMock.mockReset().mockReturnValue(true);
  loadSnapshotMock.mockReset().mockResolvedValue(null);
});

/** Gọi hàm như một POST thẳng: nhét thêm đối số (`userId` giả) mà chữ ký không còn nhận. */
const goiThang = (f: unknown, ...a: unknown[]) => (f as (...x: unknown[]) => Promise<unknown>)(...a);

/** Mọi payload đã gửi cho một phương thức nối (`values`, `set`...), theo thứ tự gọi. */
function payloads(op: string): Array<Record<string, unknown>> {
  return h.state.calls.filter((c) => c.op === op).map((c) => c.args[0] as Record<string, unknown>);
}

const MA_TRAN = {
  zoneLabels: ['Zone A'],
  rows: [{ upperKg: 1, rates: [{ zoneLabel: 'Zone A', cost: 100 }] }],
  warnings: [],
};

interface Ca {
  ten: string;
  khoa: string;
  goi: () => Promise<unknown>;
  /** Kết quả riêng cho từng cú DB theo thứ tự, khi hàm rẽ nhánh theo kết quả đọc. */
  ketQua?: unknown[];
}

/** Mỗi hàm GHI cần cổng + đúng khoá của TRANG đang gọi nó. */
const CAC_HAM_GHI: Ca[] = [
  // Hạng 3 — manage_carrier_rates (workspace/zones/weight-tiers/surcharges page)
  { ten: 'setCell', khoa: 'manage_carrier_rates', goi: () => setCell({ rateCardId: 'rc', zoneId: 'z', tierId: 't', costAmount: '10' }) },
  { ten: 'clearCell', khoa: 'manage_carrier_rates', goi: () => clearCell({ rateCardId: 'rc', zoneId: 'z', tierId: 't' }) },
  { ten: 'importMatrix', khoa: 'manage_carrier_rates', goi: () => importMatrix('acc', 'rc', MA_TRAN) },
  { ten: 'createSurcharge', khoa: 'manage_carrier_rates', goi: () => createSurcharge({ carrierAccountId: 'acc', kind: 'fuel_percent', value: '10' }) },
  { ten: 'updateSurcharge', khoa: 'manage_carrier_rates', goi: () => updateSurcharge({ id: 's1', value: '10' }) },
  { ten: 'deleteSurcharge', khoa: 'manage_carrier_rates', goi: () => deleteSurcharge('s1') },
  { ten: 'createWeightTier', khoa: 'manage_carrier_rates', goi: () => createWeightTier('acc', '2.5'), ketQua: [[], [{ next: 0 }], [{ id: 'moi' }]] },
  { ten: 'deleteWeightTier', khoa: 'manage_carrier_rates', goi: () => deleteWeightTier('t1') },
  { ten: 'seedDefaultTiers', khoa: 'manage_carrier_rates', goi: () => seedDefaultTiers('acc') },
  { ten: 'createZone', khoa: 'manage_carrier_rates', goi: () => createZone('acc', 'Zone B') },
  { ten: 'renameZone', khoa: 'manage_carrier_rates', goi: () => renameZone('z1', 'Zone C') },
  { ten: 'patchZoneCountries', khoa: 'manage_carrier_rates', goi: () => patchZoneCountries('z1', 'acc', { add: ['US'], remove: ['VN'] }) },
  { ten: 'deleteZone', khoa: 'manage_carrier_rates', goi: () => deleteZone('z1') },
  { ten: 'seedFedexVietnamDemand', khoa: 'manage_carrier_rates', goi: () => seedFedexVietnamDemand('acc') },
  // Hạng 4 — nhóm link dùng manage_carrier_rates (markets/[handle]/page.tsx:67,80,90)
  { ten: 'createLink', khoa: 'manage_carrier_rates', goi: () => createLink({ marketHandle: 'us', carrierAccountId: 'acc', serviceLabel: 'FedEx' }) },
  { ten: 'updateLink', khoa: 'manage_carrier_rates', goi: () => updateLink({ id: 'l1', enabled: false }) },
  { ten: 'deleteLink', khoa: 'manage_carrier_rates', goi: () => deleteLink('l1') },
];

describe('carrier-rates: hàm GHI gác Ở TRONG HÀM, không tin trang gác hộ', () => {
  describe.each(CAC_HAM_GHI)('$ten', ({ khoa, goi, ketQua }) => {
    /**
     * Ca chính. Vai `viewer` qua được cổng `view_carrier_rates` của TRANG; trước lượt vá thì
     * tới đây là ghi thẳng. Phải NÉM, và `touches` phải bằng 0 — kể cả cú `select` đầu tiên,
     * nên cổng dời xuống sau bước đọc nào cũng làm test đỏ.
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

    /* Gác ĐÚNG khoá: đổi sang quyền rộng hơn (vd `view_carrier_rates`) sẽ qua mọi bài khác. */
    it(`đủ quyền → kiểm đúng ${khoa} (không phải view_*) rồi mới chạm DB`, async () => {
      if (ketQua) h.state.queue.push(...ketQua);
      await goi();
      expect(hasPermissionMock).toHaveBeenCalledWith('operator', khoa);
      expect(hasPermissionMock.mock.calls.every(([, p]) => !String(p).startsWith('view_'))).toBe(true);
      expect(h.state.touches).toBeGreaterThan(0);
    });
  });

  /**
   * `userId` thôi là tham số: kẻ gọi thẳng KHÔNG đổ tên người khác vào `updated_by` được nữa.
   * Cố tình nhét `userId` giả qua ép kiểu — đúng thứ một POST thẳng làm được.
   */
  describe('danh tính lấy từ PHIÊN, không từ lời khai của người gọi', () => {
    beforeEach(() => {
      getSessionMock.mockResolvedValue({ user: { id: 'u-that' } });
    });

    it('setCell: updated_by = người trong phiên, bỏ qua userId giả', async () => {
      await setCell({ rateCardId: 'rc', zoneId: 'z', tierId: 't', costAmount: '10', userId: 'ke-gia-mao' } as never);
      expect(payloads('values')[0]).toMatchObject({ updatedBy: 'u-that' });
      // `set` nằm TRONG đối số của onConflictDoUpdate (nhánh ghi đè ô đã có).
      expect(payloads('onConflictDoUpdate')[0]).toMatchObject({ set: { updatedBy: 'u-that' } });
      expect(JSON.stringify(h.state.calls)).not.toContain('ke-gia-mao');
    });

    it('importMatrix: updated_by = người trong phiên', async () => {
      await goiThang(importMatrix, 'acc', 'rc', MA_TRAN, 'ke-gia-mao');
      expect(JSON.stringify(h.state.calls)).not.toContain('ke-gia-mao');
      expect(payloads('values').some((v) => v.updatedBy === 'u-that')).toBe(true);
    });

    it('createSurcharge: updated_by = người trong phiên', async () => {
      await goiThang(createSurcharge, { carrierAccountId: 'acc', kind: 'fuel_percent', value: '10' }, 'ke-gia-mao');
      expect(payloads('values')[0]).toMatchObject({ updatedBy: 'u-that' });
      expect(JSON.stringify(h.state.calls)).not.toContain('ke-gia-mao');
    });

    it('updateSurcharge: updated_by = người trong phiên', async () => {
      await goiThang(updateSurcharge, { id: 's1', value: '10' }, 'ke-gia-mao');
      expect(payloads('set')[0]).toMatchObject({ updatedBy: 'u-that' });
    });

    it('seedFedexVietnamDemand: mọi dòng chèn mang updated_by = người trong phiên', async () => {
      h.state.rows = []; // chưa có dòng nào → chèn đủ bộ
      await goiThang(seedFedexVietnamDemand, 'acc', 'ke-gia-mao');
      const vals = payloads('values');
      expect(vals.length).toBeGreaterThan(0);
      expect(vals.every((v) => v.updatedBy === 'u-that')).toBe(true);
    });

    it('createLink / updateLink: updated_by = người trong phiên', async () => {
      await goiThang(createLink, { marketHandle: 'us', carrierAccountId: 'acc', serviceLabel: 'FedEx' }, 'ke-gia-mao');
      await goiThang(updateLink, { id: 'l1', enabled: true }, 'ke-gia-mao');
      expect(payloads('values')[0]).toMatchObject({ updatedBy: 'u-that' });
      expect(payloads('set')[0]).toMatchObject({ updatedBy: 'u-that' });
    });
  });
});

describe('commitPushPlan — đòi CẢ HAI manage_carrier_rates và apply_markets', () => {
  /** Nó đè `market_store_overrides.shipping` — nguồn của các đường đẩy lên store thật. */
  it.each(['manage_carrier_rates', 'apply_markets'])(
    'thiếu %s → NÉM và KHÔNG tính kế hoạch, KHÔNG chạm DB',
    async (thieu) => {
      hasPermissionMock.mockImplementation((_r: string, perm: string) => perm !== thieu);
      await expect(commitPushPlan('acc')).rejects.toThrow('Forbidden');
      expect(h.state.touches).toBe(0);
      // buildPushPlan là cú đọc đầu tiên: nó không được chạy khi chưa qua cổng.
      expect(loadSnapshotMock).not.toHaveBeenCalled();
    },
  );

  it('chưa đăng nhập → NÉM Unauthorized và không tính kế hoạch', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(commitPushPlan('acc')).rejects.toThrow('Unauthorized');
    expect(loadSnapshotMock).not.toHaveBeenCalled();
    expect(h.state.touches).toBe(0);
  });

  it('đủ quyền → kiểm đủ hai khoá rồi mới tính kế hoạch', async () => {
    const r = await commitPushPlan('acc'); // snapshot null → "account not found" → không ghi gì
    expect(hasPermissionMock).toHaveBeenCalledWith('operator', 'manage_carrier_rates');
    expect(hasPermissionMock).toHaveBeenCalledWith('operator', 'apply_markets');
    expect(loadSnapshotMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ marketsWritten: 0, storesAffected: 0, ratesEmitted: 0 });
  });
});

describe('hàm ĐỌC cố ý KHÔNG gác — vai chỉ-xem phải đọc được', () => {
  /* Chặn nhầm ở đây là sập trang xem của vai viewer, và `buildPushPlan` còn được gọi nội
   * bộ bởi chính `commitPushPlan`. Cho `hasPermission` trả false hết: đọc vẫn phải chạy. */
  const CAC_HAM_DOC: Array<[string, () => Promise<unknown>]> = [
    ['loadMatrix', () => loadMatrix('acc', 'rc')],
    ['listSurcharges', () => listSurcharges('acc')],
    ['listWeightTiers', () => listWeightTiers('acc')],
    ['listZonesWithCountries', () => listZonesWithCountries('acc')],
    ['listLinksForMarket', () => listLinksForMarket('us')],
    ['listMarketsForCarrier', () => listMarketsForCarrier('acc')],
    ['listLinkableCarrierAccounts', () => listLinkableCarrierAccounts()],
    ['buildPushPlan', () => buildPushPlan('acc')],
  ];

  it.each(CAC_HAM_DOC)('%s chạy được khi không có quyền nào và không có phiên', async (_ten, goi) => {
    getSessionMock.mockResolvedValue(null);
    hasPermissionMock.mockReturnValue(false);
    await expect(goi()).resolves.not.toThrow();
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});

/* ====================================================================================
 * Lớp danh sách export: ghim hàm nào gác, hàm nào cố ý không. Quét văn bản đã BỎ chú thích
 * (một dòng `// requirePerm(...)` không phải cổng — bài học của lượt soát 24/10/2026).
 * ==================================================================================== */
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
}

/** Tên mọi export có thể thành server action, kèm thân (đến export kế tiếp). */
function cacExport(tep: string): Array<{ ten: string; than: string }> {
  const s = boChuThich(readFileSync(join(THU_MUC, tep), 'utf8'));
  const moc: Array<{ ten: string; tai: number }> = [];
  for (const m of s.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) moc.push({ ten: m[1]!, tai: m.index! });
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\b|[^=]*=>)/gm)) moc.push({ ten: m[1]!, tai: m.index! });
  moc.sort((a, b) => a.tai - b.tai);
  return moc.map((x, i) => ({ ten: x.ten, than: s.slice(x.tai, i + 1 < moc.length ? moc[i + 1]!.tai : s.length) }));
}

describe('danh sách export của các tệp carrier-rates đã vá', () => {
  const TEP: Record<string, { gac: string[]; doc: string[] }> = {
    'matrix-actions.ts': { gac: ['setCell', 'clearCell', 'importMatrix'], doc: ['loadMatrix'] },
    'surcharges-actions.ts': { gac: ['createSurcharge', 'updateSurcharge', 'deleteSurcharge'], doc: ['listSurcharges'] },
    'tiers-actions.ts': { gac: ['createWeightTier', 'deleteWeightTier', 'seedDefaultTiers'], doc: ['listWeightTiers'] },
    'zones-actions.ts': { gac: ['createZone', 'renameZone', 'patchZoneCountries', 'deleteZone'], doc: ['listZonesWithCountries'] },
    'seed-fedex-vn-demand.ts': { gac: ['seedFedexVietnamDemand'], doc: [] },
    'links-actions.ts': { gac: ['createLink', 'updateLink', 'deleteLink'], doc: ['listLinksForMarket', 'listMarketsForCarrier', 'listLinkableCarrierAccounts'] },
    'push/commit.ts': { gac: ['commitPushPlan'], doc: ['buildPushPlan'] },
  };

  it.each(Object.entries(TEP))('%s: export gác = đúng danh sách, export không gác = đúng các hàm đọc', (tep, { gac, doc }) => {
    const ex = cacExport(tep);
    const coCong = ex.filter((e) => /requirePerm\s*\(/.test(e.than)).map((e) => e.ten).sort();
    const khongCong = ex.filter((e) => !/requirePerm\s*\(/.test(e.than)).map((e) => e.ten).sort();
    expect(coCong).toEqual([...gac].sort());
    expect(khongCong).toEqual([...doc].sort());
  });

  it('commitPushPlan đòi đủ hai khoá trong thân hàm', () => {
    const than = cacExport('push/commit.ts').find((e) => e.ten === 'commitPushPlan')!.than;
    expect(than).toMatch(/requirePerm\('manage_carrier_rates'\)/);
    expect(than).toMatch(/requirePerm\('apply_markets'\)/);
  });

  it('không còn tham số userId ở bất kỳ hàm đã vá nào', () => {
    for (const tep of Object.keys(TEP)) {
      const s = boChuThich(readFileSync(join(THU_MUC, tep), 'utf8'));
      // Chữ ký hàm export: không được nhận `userId` làm tham số.
      for (const m of s.matchAll(/^export\s+async\s+function\s+\w+\s*\(([\s\S]*?)\)\s*:\s*Promise/gm)) {
        expect(m[1], `${tep}: ${m[0].slice(0, 60)}`).not.toMatch(/\buserId\b/);
      }
    }
  });
});
