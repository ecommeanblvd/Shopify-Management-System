import { describe, expect, it } from 'vitest';
import { CATALOG, ACTIONS, allPermissionKeys, isValidKey, nhanHanhDongLac, canKemLac } from './permissions';
import { OLD_TO_NEW } from './permission-map';

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
    // `/đóng\/mở kiện/` chứ KHÔNG phải `/kiện/i`: chữ "điều kiện" cũng khớp `/kiện/i`, nên
    // mẩu phạm vi thật có thể rụng mà test vẫn xanh.
    expect(nhan('fulfillment.operations').edit).toMatch(/đóng\/mở kiện/i);
    expect(nhan('warehouse.qc').override).toMatch(/QC/);
    expect(nhan('fulfillment.pack_check').create).toMatch(/kiểm kiện/i);
    expect(nhan('fulfillment.brand_requests').edit).toMatch(/yêu cầu brand/i);
    // `create` của Settings Sync là QUẢN LÝ TEMPLATE, không phải "tạo" gì — đúng kiểu nhãn
    // mà thiếu thì người cấp quyền đoán sai.
    expect(nhan('settings_sync').create).toMatch(/template/i);
  });

  /**
   * `orders:edit` (quyền cũ `manage_sku_costs`) gác CẢ việc mở chi tiết đơn
   * (`components/shopify-orders/OrdersTable.tsx:142`). Rủi ro đi NGƯỢC chiều
   * `markets:apply`: nhãn hẹp ở đây làm admin BỎ TÍCH vì tưởng chỉ gỡ quyền nhập giá vốn,
   * rồi chặn luôn việc mở chi tiết đơn của cả vai đó. Ghim cả ba mẩu.
   */
  it('orders:edit nói ra cả việc mở chi tiết đơn', () => {
    const n = nhan('orders').edit!;
    expect(n).toMatch(/chi tiết đơn/i);
    expect(n).toMatch(/giá vốn/i);
    expect(n).toMatch(/trọng lượng/i);
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
    // SÁU đường của `apply_markets`, ghim từng cái: rút một mẩu khỏi nhãn thì test phải đỏ,
    // nếu không thì phần nới nhãn hôm nay không được canh gì cả.
    const apMarket = nhan('markets').apply!;
    expect(apMarket).toMatch(/market/i);
    expect(apMarket).toMatch(/carrier rate/i);
    expect(apMarket).toMatch(/carrier service/i);
    expect(apMarket).toMatch(/shipping profile/i);
    expect(apMarket).toMatch(/manual shipping rates/i);
    expect(apMarket).toMatch(/shipping hệ thống/i);

    // `settings_sync:apply` gom cả `apply_settings` lẫn `reconcile_store`, và mở luôn
    // rollback một lượt đã áp — ba việc khác hẳn nhau, nhãn phải nói ra cả ba.
    const apSettings = nhan('settings_sync').apply!;
    expect(apSettings).toMatch(/reconcile/i);
    expect(apSettings).toMatch(/override/i);
    expect(apSettings).toMatch(/rollback/i);
    // `run_feature` mở CẢ Settings Viewer, không riêng Settings Sync.
    expect(nhan('settings_sync').edit).toMatch(/settings viewer/i);
  });

  /**
   * `fulfillment.operations:edit` rộng hơn "đóng hàng" nhiều — nó gác cả SLA
   * (`features/lifecycle/sla-actions.ts:15`) và đẩy đơn sang MMP
   * (`features/mmp/order-push-query.ts:27`). Hai mẩu này vừa được thêm vào nhãn, nên phải
   * có test ghim, không thì rút ra lúc nào cũng được mà suite vẫn xanh.
   */
  it('fulfillment.operations:edit kể cả SLA và đẩy đơn sang MMP', () => {
    const n = nhan('fulfillment.operations').edit!;
    expect(n).toMatch(/SLA/);
    expect(n).toMatch(/MMP/);
    expect(n).toMatch(/danh mục box/i);
  });

  /** `markets:view`/`fulfillment.logistics:edit` cũng vừa nới — ghim mẩu đã thêm. */
  it('các nhãn vừa nới giữ nguyên mẩu phạm vi đã thêm', () => {
    expect(nhan('markets').view).toMatch(/manual shipping rates/i);
    expect(nhan('markets').edit).toMatch(/tạo/i);
    expect(nhan('fulfillment.logistics').edit).toMatch(/verify địa chỉ/i);
    expect(nhan('fulfillment.logistics').create).toMatch(/đóng hàng/i);
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

/* ──────────────────────────────────────────────────────────────────────────────
 * 15 chùm quyền cũ nhiều-khoá, gắn nhãn ngày 24/10/2026 (CEO: "làm nốt các chùm
 * còn lại"). Mỗi `it` dưới đây ghim TỪNG MẨU PHẠM VI, không ghim nguyên văn: câu
 * chữ được phép sửa cho gọn, phạm vi thì không được rụng. Mẩu chọn phải ĐẶC TRƯNG —
 * `/kiện/i` từng khớp cả chữ "điều kiện" nên canh hờ.
 * ────────────────────────────────────────────────────────────────────────────── */

function nhanCua(scopeKey: string): Partial<Record<string, string>> {
  const s = CATALOG.find((x) => x.key === scopeKey);
  expect(s, `thiếu phạm vi ${scopeKey}`).toBeDefined();
  return (s!.nhanHanhDong ?? {}) as Partial<Record<string, string>>;
}
function kemCua(scopeKey: string): Partial<Record<string, readonly string[]>> {
  const s = CATALOG.find((x) => x.key === scopeKey);
  expect(s, `thiếu phạm vi ${scopeKey}`).toBeDefined();
  return (s!.canKem ?? {}) as Partial<Record<string, readonly string[]>>;
}
/** Mọi mẩu phải nằm trong nhãn của MỌI action kể ra — dùng cho chùm "một quyền cũ". */
function ghimMau(scopeKey: string, actions: string[], mau: RegExp[]): void {
  const n = nhanCua(scopeKey);
  for (const a of actions) {
    const chu = n[a];
    expect(chu, `${scopeKey}:${a} chưa có nhãn`).toBeTruthy();
    for (const m of mau) expect(chu!, `${scopeKey}:${a} rụng mẩu ${m}`).toMatch(m);
  }
}

describe('nhãn 15 chùm quyền cũ nhiều-khoá', () => {
  /**
   * Hàng rào cấu trúc: khoá nào thuộc một quyền cũ ánh xạ sang NHIỀU khoá thì ô đó một mình
   * không mở ra việc gì rõ ràng, nên BẮT BUỘC có nhãn. Lấy danh sách từ `OLD_TO_NEW` chứ
   * không chép tay: thêm chùm mới mà quên nhãn thì test này đỏ, không cần ai nhớ.
   *
   * Danh sách ngoại lệ phải RỖNG DẦN và được ghim CHÍNH XÁC — ai gắn nhãn cho ô còn thiếu
   * sẽ thấy test đỏ và gỡ nó khỏi đây, thay vì ngoại lệ nằm lại mãi không ai biết.
   */
  it('mọi khoá thuộc chùm nhiều-khoá đều có nhãn (trừ ô còn nợ, ghim đích danh)', () => {
    const coNhan = new Set(
      CATALOG.flatMap((s) => Object.keys(s.nhanHanhDong ?? {}).map((a) => `${s.key}:${a}`)),
    );
    const trongChum = [...new Set(Object.values(OLD_TO_NEW).filter((v) => v.length > 1).flat())];
    expect(trongChum.filter((k) => !coNhan.has(k)))
      // `check_packed` là chùm làm ở lượt trước; ô `:view` của nó chưa có nhãn.
      .toEqual(['fulfillment.pack_check:view']);
  });

  /**
   * Chùm "một quyền cũ, nhiều ô" thì MỌI ô phải mang CÙNG một nhãn: shim kiểm `.every()`
   * nên không có ô nào mang nghĩa riêng. Nhãn khác nhau theo cột ở mấy hàng này là nói dối —
   * nó mời người ta tưởng có "chỉ xem" hoặc "chỉ xoá", trong khi tích lẻ không mở ra gì.
   */
  it.each([
    ['stores', ['view', 'create', 'edit', 'delete']],
    ['fulfillment.warehouse', ['view', 'create', 'edit', 'delete']],
    ['mmp_products', ['create', 'edit', 'delete', 'push']],
    ['carrier_rates', ['create', 'edit', 'delete']],
    ['carrier_rates.invoices', ['view', 'create', 'edit']],
    ['warehouse.qc', ['view', 'create', 'edit']],
  ] as Array<[string, string[]]>)('%s: mọi ô của chùm mang cùng một nhãn', (scope, actions) => {
    const n = nhanCua(scope);
    const khac = new Set(actions.map((a) => n[a]));
    expect([...khac].filter(Boolean)).toHaveLength(1);
  });

  /* 1. manage_stores — rủi ro: hai mẩu nằm NGOÀI chữ "Stores" (tỷ giá/phí đóng gói nằm ở màn
   *    Đơn hàng, backfill/webhook nằm ở màn Sync health). Nhãn hẹp làm người ta tích vì tưởng
   *    chỉ đụng module Stores. */
  it('stores: nói cả OAuth, tỷ giá & phí đóng gói, backfill, webhook', () => {
    ghimMau('stores', ['view', 'create', 'edit', 'delete'], [
      /OAuth/, /tỷ giá/i, /phí đóng gói/i, /backfill/i, /webhook/i,
    ]);
  });

  /* 2. manage_users — chùm DUY NHẤT có nhãn riêng từng ô, vì bốn khoá này còn được kiểm RIÊNG
   *    bằng `can()` (`app/(dashboard)/admin/roles/page.tsx:15,29-31`). */
  it('users_roles: mỗi ô nói việc riêng, và cả bốn nói ra phần chùm manage_users', () => {
    const n = nhanCua('users_roles');
    expect(n.view).toMatch(/Roles & Permissions/);
    expect(n.create).toMatch(/^Tạo role mới/);
    expect(n.edit).toMatch(/chống tự khoá/);
    expect(n.delete).toMatch(/Xoá role/);
    // Phần chùm: đủ cả 4 ô thì còn mở ba màn Admin mà không cột nào ở đây gợi ra.
    for (const a of ['view', 'create', 'edit', 'delete']) {
      expect(n[a], `users_roles:${a}`).toMatch(/đủ cả 4 ô/);
      expect(n[a], `users_roles:${a}`).toMatch(/Feature flags/);
      expect(n[a], `users_roles:${a}`).toMatch(/Báo lỗi/);
    }
  });

  /* 3. manage_warehouse */
  it('fulfillment.warehouse: nói cả điều chỉnh tồn, chuyển kho, biên bản Sổ nhập', () => {
    ghimMau('fulfillment.warehouse', ['view', 'create', 'edit', 'delete'], [
      /SKU & vị trí/, /điều chỉnh tồn/i, /chuyển kho/i, /biên bản/i,
    ]);
  });

  /* 4. manage_mmp_products — nhãn ở đây phải nói NGƯỢC lại tên cột: `push` KHÔNG đẩy gì lên
   *    Shopify và chùm KHÔNG tạo/sửa/xoá sản phẩm. Ghim cả hai phủ định: rụng cái nào là nhãn
   *    quay về hứa thừa đúng như tên cột.
   *
   *    Mẩu `/archived/` ghim phần LAN TOẢ, không phải chữ cho đẹp: việc chùm này gác thì nhỏ
   *    nhưng `archived` ép TOÀN BỘ sản phẩm của brand sang `archived` và không hoàn tác
   *    (`features/mmp/brand-actions.ts`) — người cấp quyền phải đọc thấy điều đó.
   *
   *    ĐÃ BỎ mẩu `/chưa kiểm quyền/` ngày 24/10/2026: `setBrandStatus` nay gọi
   *    `requirePerm('manage_mmp_products')` ở ngay đầu hàm nên câu đó thành SAI. Hàng rào cho
   *    phần vá nằm ở `features/mmp/gate-actions.test.ts` — đúng chỗ của nó, không phải ghim
   *    một lỗ quyền vào trong chuỗi nhãn. */
  it('mmp_products: nói đúng là đổi trạng thái brand, và phủ định phần tên cột hứa thừa', () => {
    ghimMau('mmp_products', ['create', 'edit', 'delete', 'push'], [
      /trạng thái brand/i, /archived/, /KHÔNG tạo\/sửa\/xoá sản phẩm/, /KHÔNG đẩy lên Shopify/,
    ]);
  });

  /* 5. manage_carrier_rates — rộng hơn "sửa bảng giá" theo đúng hướng nguy hiểm: nối carrier
   *    vào MARKET (module khác), ghi THANH TOÁN, và CHIA SẺ TỆP RA NGOÀI công ty. */
  it('carrier_rates: nói cả nối carrier vào market, thanh toán, chia sẻ tệp ra ngoài', () => {
    ghimMau('carrier_rates', ['create', 'edit', 'delete'], [
      /zone/i, /bậc cân/i, /phụ phí/i, /nối carrier vào market/i, /thanh toán hoá đơn/i, /RA NGOÀI/,
    ]);
  });

  /* 6. manage_shipping_invoices — gác luôn HAI bài KPI của logistics; gỡ tích vì tưởng chỉ gỡ
   *    quyền nhập hoá đơn là chặn luôn việc nộp bài của cả vai. */
  it('carrier_rates.invoices: nói cả credit note, DHL, lý do giao chậm, KPI 1.1 & 1.2', () => {
    ghimMau('carrier_rates.invoices', ['view', 'create', 'edit'], [
      /credit note/i, /DHL/, /lý do giao chậm/i, /KPI 1\.1/, /1\.2/,
    ]);
  });

  /* 7. manage_receiving — `:view` (quyền cũ `view_receiving`) là cửa vào SÁU tab, không chỉ
   *    hàng "Nhập hàng"; `:create`/`:edit` là phần ghi. */
  it('warehouse.receiving: view kể đủ các màn, create/edit kể đủ việc ghi', () => {
    ghimMau('warehouse.receiving', ['view'], [/Nhận & kiểm hàng/, /Sổ nhập/, /Chờ KCS/]);
    ghimMau('warehouse.receiving', ['create', 'edit'], [
      /in tem/i, /ngoài kế hoạch/i, /Quét nhập nhanh/i,
    ]);
  });

  /* 8. manage_qc — `/đóng kiện/` chứ KHÔNG `/kiện/i` (chữ "điều kiện" cũng khớp). */
  it('warehouse.qc: nói cả dòng lỗi, cân chiếc, đóng kiện, Lark WH, biên bản trả brand', () => {
    ghimMau('warehouse.qc', ['view', 'create', 'edit'], [
      /dòng lỗi/i, /cân chiếc/i, /đóng kiện/, /Lark WH/, /biên bản trả brand/i,
    ]);
    // `override` là quyền cũ RIÊNG (`sua_ket_qua_qc`) nên giữ nhãn riêng, không bị gộp.
    expect(nhanCua('warehouse.qc').override).toMatch(/đã chốt/);
  });

  /* 9. manage_ship_ho — `:view` còn mở mặt dữ liệu Ship hộ trong NHẬT KÝ (module khác);
   *    `:create`/`:edit` còn gác VÙNG GEO và GHI SỰ CỐ trên màn Báo cáo ship. */
  it('ship_ho: view nói cả nhật ký, create/edit nói cả vùng geo và ghi sự cố', () => {
    ghimMau('ship_ho', ['view'], [/nhật ký/i]);
    ghimMau('ship_ho', ['create', 'edit'], [
      /nhập Excel/i, /vùng geo/i, /ghi sự cố/i, /đối soát/i, /tracking/i,
    ]);
  });

  /* 10. manage_kol */
  it('kol: view kể các màn, create/edit kể cả nhận trả về và sửa giá vốn', () => {
    ghimMau('kol', ['view'], [/đang mượn/i]);
    ghimMau('kol', ['create', 'edit'], [/nhận trả về/i, /giá vốn/i, /người nhận/i]);
  });

  /* 11. manage_cx_ticket — nghĩa thật là GHI HỘ mọi bộ phận (CEO 27/09/2026), và `:view` là
   *     cửa vào CẢ module CX chứ không riêng tab Việc cần làm. */
  it('cx.ticket: view nói cả module CX, create/edit nói ghi hộ mọi bộ phận', () => {
    ghimMau('cx.ticket', ['view'], [/CẢ module CX/]);
    ghimMau('cx.ticket', ['create', 'edit'], [/MỌI bộ phận/, /dòng đơn/i, /trạng thái ticket/i]);
  });

  /* 12-14. ba chùm CX còn lại: `:view` đứng một mình CÓ tác dụng nên nhãn nói đúng tab đó. */
  it('cx.dispute: create/edit nói cả đồng bộ hằng ngày và sửa phần CX', () => {
    ghimMau('cx.dispute', ['view'], [/tab Tranh chấp/]);
    ghimMau('cx.dispute', ['create', 'edit'], [/đồng bộ/i, /phần CX/]);
  });
  it('cx.incident: create/edit nói cả chi phí thiệt hại và đổi bộ phận chịu', () => {
    ghimMau('cx.incident', ['view'], [/tab Sự cố/]);
    ghimMau('cx.incident', ['create', 'edit'], [/chi phí thiệt hại/i, /bộ phận chịu/i]);
  });
  it('cx.review: create/edit nói cả đổi trạng thái và sửa phần CX', () => {
    ghimMau('cx.review', ['view'], [/tab Đánh giá/]);
    ghimMau('cx.review', ['create', 'edit'], [/đổi trạng thái/i, /phần CX/]);
  });

  /* 15. manage_cogs — `:view` (quyền cũ `view_cogs`) còn mở mặt giá vốn mức đơn trong NHẬT KÝ
   *     (`features/nhat-ky/che-gia-tri.ts:125-139`): bỏ tích là che cả một cột ở module khác. */
  it('orders.cogs: view nói cả nhật ký, edit kể đủ việc ghi giá vốn', () => {
    ghimMau('orders.cogs', ['view'], [/Lãi gộp/, /nhật ký/i]);
    ghimMau('orders.cogs', ['edit'], [/tỉ giá/i, /ước giá vốn/i, /phân bổ PO/i]);
  });
});

/**
 * `canKem` của 15 chùm. Sai ở đây dựng ra một cảnh báo SAI trên màn phân quyền, nên ghim
 * CHÍNH XÁC từng mảng — thêm/bớt một khoá là test đỏ.
 */
describe('canKem của 15 chùm', () => {
  it.each([
    ['stores', 'view', ['stores:create', 'stores:edit', 'stores:delete']],
    ['stores', 'delete', ['stores:view', 'stores:create', 'stores:edit']],
    ['fulfillment.warehouse', 'view', ['fulfillment.warehouse:create', 'fulfillment.warehouse:edit', 'fulfillment.warehouse:delete']],
    ['fulfillment.warehouse', 'delete', ['fulfillment.warehouse:view', 'fulfillment.warehouse:create', 'fulfillment.warehouse:edit']],
    ['mmp_products', 'push', ['mmp_products:create', 'mmp_products:edit', 'mmp_products:delete']],
    ['mmp_products', 'create', ['mmp_products:edit', 'mmp_products:delete', 'mmp_products:push']],
    ['carrier_rates', 'create', ['carrier_rates:edit', 'carrier_rates:delete']],
    ['carrier_rates', 'delete', ['carrier_rates:create', 'carrier_rates:edit']],
    ['carrier_rates.invoices', 'view', ['carrier_rates.invoices:create', 'carrier_rates.invoices:edit']],
    ['carrier_rates.invoices', 'edit', ['carrier_rates.invoices:view', 'carrier_rates.invoices:create']],
    ['warehouse.receiving', 'create', ['warehouse.receiving:view', 'warehouse.receiving:edit']],
    ['warehouse.receiving', 'edit', ['warehouse.receiving:view', 'warehouse.receiving:create']],
    ['warehouse.qc', 'view', ['warehouse.qc:create', 'warehouse.qc:edit']],
    ['warehouse.qc', 'create', ['warehouse.qc:view', 'warehouse.qc:edit']],
    ['ship_ho', 'create', ['ship_ho:view', 'ship_ho:edit']],
    ['kol', 'edit', ['kol:view', 'kol:create']],
    ['cx.ticket', 'create', ['cx.ticket:view', 'cx.ticket:edit']],
    ['cx.dispute', 'edit', ['cx.dispute:view', 'cx.dispute:create']],
    ['cx.incident', 'create', ['cx.incident:view', 'cx.incident:edit']],
    ['cx.review', 'edit', ['cx.review:view', 'cx.review:create']],
    ['orders.cogs', 'edit', ['orders.cogs:view']],
  ] as Array<[string, string, string[]]>)('%s:%s cần kèm đúng chùm của nó', (scope, action, mong) => {
    expect(kemCua(scope)[action]).toEqual(mong);
  });

  /**
   * ⚠ Nửa còn lại của sự thật, và là chỗ dễ sai nhất: mấy ô này tích MỘT MÌNH VẪN CÓ TÁC
   * DỤNG, nên khai `canKem` cho chúng là nói dối theo chiều ngược lại — dồn người cấp quyền
   * đi tích thêm hai ô GHI chỉ để có quyền XEM. Chúng đứng riêng được vì mỗi ô có một quyền
   * cũ một-khoá riêng ĐANG ĐƯỢC KIỂM trong app (`view_receiving`, `view_ship_ho`, `view_kol`,
   * `view_cogs`, `view_cx_*`), hoặc được kiểm trực tiếp bằng `can()` (bốn ô `users_roles`).
   */
  it.each([
    'warehouse.receiving:view',
    'ship_ho:view',
    'kol:view',
    'orders.cogs:view',
    'cx.ticket:view',
    'cx.dispute:view',
    'cx.incident:view',
    'cx.review:view',
    'users_roles:view',
    'users_roles:create',
    'users_roles:edit',
    'users_roles:delete',
  ])('%s KHÔNG được khai canKem — tích một mình vẫn có tác dụng', (khoa) => {
    const [scope, action] = khoa.split(':');
    expect(kemCua(scope)[action]).toBeUndefined();
  });

  /**
   * Ngược lại: `warehouse.qc:view` PHẢI có `canKem` dù quyền cũ `view_qc` ánh xạ riêng nó
   * (`lib/auth/permission-map.ts:44`) — vì `view_qc` KHÔNG ĐƯỢC KIỂM Ở ĐÂU trong app (soát
   * toàn repo 24/10/2026; màn QC gác bằng `view_receiving`). Test này canh đúng chỗ dễ bị
   * "sửa lại cho giống mấy ô view khác": làm vậy là bỏ một cảnh báo ĐÚNG.
   */
  it('warehouse.qc:view vẫn phải cần kèm, vì view_qc không gác gì', () => {
    expect(kemCua('warehouse.qc').view).toBeDefined();
    expect(Object.values(OLD_TO_NEW).filter((v) => v.length === 1 && v[0] === 'warehouse.qc:view'))
      .toHaveLength(1); // vẫn còn trong bản đồ — nên sự thật "không gác gì" phải nằm ở test
  });
});
