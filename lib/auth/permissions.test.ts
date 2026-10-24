import { describe, expect, it } from 'vitest';
import { CATALOG, ACTIONS, allPermissionKeys, isValidKey, nhanHanhDongLac, canKemLac } from './permissions';

describe('permission catalog', () => {
  it('every scope key is unique', () => {
    const keys = CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every action used is in ACTIONS', () => {
    for (const s of CATALOG) for (const a of s.actions) expect(ACTIONS).toContain(a);
  });
  it('allPermissionKeys returns scope:action for each pair, unique', () => {
    const all = allPermissionKeys();
    expect(all).toContain('fulfillment.logistics:create');
    expect(all).toContain('carrier_rates:view');
    expect(new Set(all).size).toBe(all.length);
  });
  it('isValidKey accepts catalog keys and rejects others', () => {
    expect(isValidKey('carrier_rates.invoices:create')).toBe(true);
    expect(isValidKey('carrier_rates:teleport')).toBe(false);
    expect(isValidKey('nonsense')).toBe(false);
  });
});

/**
 * Nhãn hành động (`nhanHanhDong`) là thứ DUY NHẤT trên `/admin/roles` nói ra nghĩa thật của
 * một ô, nên nó là mã sản phẩm chứ không phải chú thích. `RoleMatrix` là `.tsx` mà `vitest`
 * không bắt (xem `vitest.config.ts`), nên phần ghim được bằng test nằm ở đây: nhãn có mặt,
 * khớp đúng action, và không có nhãn nào chết không hiện ra ô nào.
 */
describe('nhãn hành động trên lưới phân quyền', () => {
  function nhan(scopeKey: string) {
    const s = CATALOG.find((x) => x.key === scopeKey);
    expect(s, `thiếu phạm vi ${scopeKey}`).toBeDefined();
    return s!.nhanHanhDong ?? {};
  }

  /**
   * Chính cái ô CEO đi tìm 24/10/2026 mà không thấy. Ghim chữ "Tạo vận đơn" ở ĐẦU nhãn:
   * đó là cái người ta sẽ Ctrl+F trên màn phân quyền, nên nó không được lùi vào giữa câu
   * (hay bị viết lại thành "Nhập mã vận đơn") khi ai đó nới nhãn cho đủ phạm vi.
   */
  it('fulfillment.logistics mở đầu bằng đúng chữ "Tạo vận đơn"', () => {
    expect(nhan('fulfillment.logistics').create).toMatch(/^Tạo vận đơn/);
    expect(nhan('fulfillment.logistics').edit).toMatch(/^Chọn line ship/);
  });

  it('các ô create/edit mơ hồ khác đều đã có nhãn', () => {
    expect(nhan('fulfillment.operations').edit).toMatch(/kiện/i);
    expect(nhan('warehouse.qc').override).toMatch(/QC/);
    expect(nhan('fulfillment.pack_check').create).toMatch(/kiểm kiện/i);
    expect(nhan('orders').edit).toMatch(/giá vốn/i);
    // `create` của Settings Sync là QUẢN LÝ TEMPLATE, không phải "tạo" gì — đúng kiểu nhãn
    // mà thiếu thì người cấp quyền đoán sai.
    expect(nhan('settings_sync').create).toMatch(/template/i);
  });

  /**
   * Luật "nói ĐỦ phạm vi", ghim cho hai ô đẩy-lên-store-thật.
   *
   * `markets:apply` từng ghi "Đẩy market lên store" trong khi cùng ô đó còn mở việc đẩy
   * carrier rate / carrier service / shipping profile lên store THẬT — nhãn hẹp theo đúng
   * hướng nguy hiểm, mời người ta tự tin cấp nhầm. Ghim từng mẩu phạm vi chứ không ghim
   * nguyên văn: câu chữ được phép sửa cho gọn, phạm vi thì không được rụng.
   */
  it('nhãn của ô đẩy lên store thật phải kể đủ thứ nó đẩy', () => {
    const apMarket = nhan('markets').apply!;
    expect(apMarket).toMatch(/market/i);
    expect(apMarket).toMatch(/carrier rate/i);
    expect(apMarket).toMatch(/shipping profile/i);

    // `settings_sync:apply` gom cả `apply_settings` lẫn `reconcile_store`, và mở luôn
    // rollback một lượt đã áp — ba việc khác hẳn nhau, nhãn phải nói ra cả ba.
    const apSettings = nhan('settings_sync').apply!;
    expect(apSettings).toMatch(/reconcile/i);
    expect(apSettings).toMatch(/rollback/i);
  });

  /** Trường tuỳ chọn: đa số phạm vi chưa khai, và điều đó PHẢI hợp lệ. */
  it('phạm vi không khai nhãn vẫn hợp lệ', () => {
    const chuaKhai = CATALOG.filter((s) => s.nhanHanhDong === undefined);
    expect(chuaKhai.length).toBeGreaterThan(0);
  });

  it('không nhãn nào khai cho action mà phạm vi không có', () => {
    expect(nhanHanhDongLac()).toEqual([]);
  });

  /** Hàm bắt được lỗi thật, không phải luôn trả rỗng. */
  it('nhanHanhDongLac chỉ ra đúng nhãn chết', () => {
    expect(
      nhanHanhDongLac([{ key: 'x', label: 'X', actions: ['view'], nhanHanhDong: { delete: 'Xoá gì đó' } }]),
    ).toEqual(['x:delete']);
  });

  it('không nhãn nào rỗng hay chỉ có khoảng trắng', () => {
    for (const s of CATALOG) {
      for (const [a, n] of Object.entries(s.nhanHanhDong ?? {})) {
        expect(n.trim(), `${s.key}:${a}`).not.toBe('');
      }
    }
  });

  /* ĐÃ BỎ (24/10/2026) test "nhãn không trùng nhau giữa các phạm vi": hai phạm vi khác nhau
   * có thể trùng nghĩa thật (hai module cùng có "Xem lịch sử áp dụng"), nên nó sẽ đỏ OAN.
   * Một test đỏ oan rồi sẽ bị người sau tắt đi, và lúc đó mất luôn cả phần nó canh đúng —
   * thà không có còn hơn có một hàng rào mà ai cũng học cách trèo qua. */
});

/**
 * `canKem` nói ra điều kiện "ô này một mình KHÔNG mở ra việc gì" — sinh ra vì shim tương
 * thích kiểm `.every()` (`lib/auth/rbac.ts:131`), nên quyền cũ ánh xạ sang nhiều khoá chỉ
 * có tác dụng khi tích đủ chùm. Sai ở đây là chỉ người cấp quyền đi tích nhầm ô.
 */
describe('điều kiện tích kèm (canKem)', () => {
  function kem(scopeKey: string) {
    const s = CATALOG.find((x) => x.key === scopeKey);
    expect(s, `thiếu phạm vi ${scopeKey}`).toBeDefined();
    return s!.canKem ?? {};
  }

  /** Hai nửa của `manage_fulfillment` (`lib/auth/permission-map.ts:40`) phải trỏ về nhau. */
  it('hai nửa của manage_fulfillment khai kèm lẫn nhau', () => {
    expect(kem('fulfillment.operations').edit).toEqual(['fulfillment.brand_requests:edit']);
    expect(kem('fulfillment.brand_requests').edit).toEqual(['fulfillment.operations:edit']);
  });

  /** `check_packed` ánh xạ sang cả `:view` lẫn `:create` (`permission-map.ts:51`). */
  it('check-packed đòi kèm ô Xem của chính phạm vi đó', () => {
    expect(kem('fulfillment.pack_check').create).toEqual(['fulfillment.pack_check:view']);
  });

  it('mọi khoá canKem đều có thật trong danh mục', () => {
    expect(canKemLac()).toEqual([]);
  });

  /** Hàm bắt được lỗi thật, không phải luôn trả rỗng. */
  it('canKemLac chỉ ra khoá chết, action không có, và khoá tự trỏ về mình', () => {
    expect(
      canKemLac([{ key: 'x', label: 'X', actions: ['view'], canKem: { view: ['y:view'] } }]),
    ).toEqual(['x:view -> y:view']);
    expect(
      canKemLac([{ key: 'x', label: 'X', actions: ['view'], canKem: { edit: ['x:view'] } }]),
    ).toEqual(['x:edit -> (action không có)']);
    expect(
      canKemLac([{ key: 'x', label: 'X', actions: ['view'], canKem: { view: ['x:view'] } }]),
    ).toEqual(['x:view -> x:view']);
  });

  /** Ô có `canKem` thì BẮT BUỘC có nhãn: điều kiện mà không có nghĩa là câu nửa vời. */
  it('ô nào khai canKem thì cũng phải có nhãn hành động', () => {
    for (const s of CATALOG) {
      for (const a of Object.keys(s.canKem ?? {})) {
        expect(s.nhanHanhDong?.[a as keyof typeof s.nhanHanhDong], `${s.key}:${a}`).toBeTruthy();
      }
    }
  });
});
