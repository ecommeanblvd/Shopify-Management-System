import { describe, expect, it } from 'vitest';
import {
  OLD_TO_NEW, QUYEN_MOI_VAI_TRO, QUYEN_THEO_VAI_NGOAI_HAT_GIONG, SYSTEM_ROLE_SEEDS,
} from './permission-map';
import { CATALOG, isValidKey, allPermissionKeys } from './permissions';

// Regression — Task 1 fix: orders.cogs (view_cogs/manage_cogs) must be wired
// end-to-end so pages/actions are not Forbidden for admin.
describe('orders.cogs RBAC wiring (Task 1 fix)', () => {
  it('allPermissionKeys() includes orders.cogs:view, orders.cogs:edit', () => {
    const keys = allPermissionKeys();
    expect(keys).toContain('orders.cogs:view');
    expect(keys).toContain('orders.cogs:edit');
  });

  it('OLD_TO_NEW[view_cogs] maps to orders.cogs:view', () => {
    expect(OLD_TO_NEW['view_cogs']).toBeDefined();
    expect(OLD_TO_NEW['view_cogs']).toContain('orders.cogs:view');
  });

  it('OLD_TO_NEW[manage_cogs] maps to all orders.cogs keys', () => {
    expect(OLD_TO_NEW['manage_cogs']).toBeDefined();
    expect(OLD_TO_NEW['manage_cogs']).toContain('orders.cogs:view');
    expect(OLD_TO_NEW['manage_cogs']).toContain('orders.cogs:edit');
  });

  it('admin seed includes orders.cogs:view, orders.cogs:edit', () => {
    const adminKeys = new Set(SYSTEM_ROLE_SEEDS.admin.keys);
    expect(adminKeys.has('orders.cogs:view')).toBe(true);
    expect(adminKeys.has('orders.cogs:edit')).toBe(true);
  });

  it('operator seed does NOT include orders.cogs keys (admin only)', () => {
    const opKeys = new Set(SYSTEM_ROLE_SEEDS.operator.keys);
    expect(opKeys.has('orders.cogs:view')).toBe(false);
    expect(opKeys.has('orders.cogs:edit')).toBe(false);
  });

  it('viewer seed does NOT include orders.cogs keys (admin only)', () => {
    const viewerKeys = new Set(SYSTEM_ROLE_SEEDS.viewer.keys);
    expect(viewerKeys.has('orders.cogs:view')).toBe(false);
    expect(viewerKeys.has('orders.cogs:edit')).toBe(false);
  });
});

// Regression — Finding 1: ship_ho must be wired end-to-end so pages/actions
// are not Forbidden for admin/operator.
describe('ship_ho RBAC wiring (regression — Finding 1)', () => {
  it('allPermissionKeys() includes ship_ho:view, ship_ho:create, ship_ho:edit', () => {
    const keys = allPermissionKeys();
    expect(keys).toContain('ship_ho:view');
    expect(keys).toContain('ship_ho:create');
    expect(keys).toContain('ship_ho:edit');
  });

  it('OLD_TO_NEW[view_ship_ho] maps to ship_ho:view', () => {
    expect(OLD_TO_NEW['view_ship_ho']).toBeDefined();
    expect(OLD_TO_NEW['view_ship_ho']).toContain('ship_ho:view');
  });

  it('OLD_TO_NEW[manage_ship_ho] maps to all ship_ho keys', () => {
    expect(OLD_TO_NEW['manage_ship_ho']).toBeDefined();
    expect(OLD_TO_NEW['manage_ship_ho']).toContain('ship_ho:view');
    expect(OLD_TO_NEW['manage_ship_ho']).toContain('ship_ho:create');
    expect(OLD_TO_NEW['manage_ship_ho']).toContain('ship_ho:edit');
  });

  it('admin seed includes ship_ho:view, ship_ho:create, ship_ho:edit', () => {
    const adminKeys = new Set(SYSTEM_ROLE_SEEDS.admin.keys);
    expect(adminKeys.has('ship_ho:view')).toBe(true);
    expect(adminKeys.has('ship_ho:create')).toBe(true);
    expect(adminKeys.has('ship_ho:edit')).toBe(true);
  });

  it('operator seed includes ship_ho:view, ship_ho:create, ship_ho:edit', () => {
    const opKeys = new Set(SYSTEM_ROLE_SEEDS.operator.keys);
    expect(opKeys.has('ship_ho:view')).toBe(true);
    expect(opKeys.has('ship_ho:create')).toBe(true);
    expect(opKeys.has('ship_ho:edit')).toBe(true);
  });
});

describe('OLD_TO_NEW', () => {
  it('every mapped key is a valid catalog key', () => {
    for (const keys of Object.values(OLD_TO_NEW)) for (const k of keys) expect(isValidKey(k)).toBe(true);
  });
  it('maps representative legacy perms', () => {
    expect(OLD_TO_NEW['view_orders']).toEqual(['orders:view']);
    expect(OLD_TO_NEW['manage_warehouse']).toContain('fulfillment.warehouse:edit');
  });
});

describe('SYSTEM_ROLE_SEEDS', () => {
  it('admin gets every permission key', () => {
    expect(new Set(SYSTEM_ROLE_SEEDS.admin.keys)).toEqual(new Set(allPermissionKeys()));
  });
  it('every seeded key is valid', () => {
    for (const r of Object.values(SYSTEM_ROLE_SEEDS)) for (const k of r.keys) expect(isValidKey(k)).toBe(true);
  });
  it('logistics has the expected scoped keys and NOT operations:edit/warehouse', () => {
    const l = new Set(SYSTEM_ROLE_SEEDS.logistics.keys);
    expect(l.has('fulfillment.operations:view')).toBe(true);
    expect(l.has('fulfillment.logistics:create')).toBe(true);
    expect(l.has('fulfillment.logistics:edit')).toBe(true);
    expect(l.has('carrier_rates:view')).toBe(true);
    expect(l.has('carrier_rates:create')).toBe(true);
    expect(l.has('carrier_rates.invoices:create')).toBe(true);
    expect(l.has('fulfillment.operations:edit')).toBe(false);
    expect(l.has('fulfillment.warehouse:edit')).toBe(false);
  });
  it('viewer is read-only (no create/edit/delete/apply/push)', () => {
    for (const k of SYSTEM_ROLE_SEEDS.viewer.keys) expect(k.endsWith(':view')).toBe(true);
  });
});

describe('quyền KOL', () => {
  it('view_kol chỉ mở quyền xem', () => {
    expect(OLD_TO_NEW.view_kol).toEqual(['kol:view']);
  });
  it('manage_kol mở đủ xem/tạo/sửa', () => {
    expect(OLD_TO_NEW.manage_kol).toEqual(['kol:view', 'kol:create', 'kol:edit']);
  });
  it('admin và operator có đủ quyền KOL, viewer thì KHÔNG', () => {
    const adminKeys = new Set(SYSTEM_ROLE_SEEDS.admin.keys);
    const opKeys = new Set(SYSTEM_ROLE_SEEDS.operator.keys);
    const viewerKeys = new Set(SYSTEM_ROLE_SEEDS.viewer.keys);
    expect(adminKeys.has('kol:view')).toBe(true);
    expect(adminKeys.has('kol:create')).toBe(true);
    expect(adminKeys.has('kol:edit')).toBe(true);
    expect(opKeys.has('kol:view')).toBe(true);
    expect(opKeys.has('kol:create')).toBe(true);
    expect(opKeys.has('kol:edit')).toBe(true);
    expect(viewerKeys.has('kol:view')).toBe(false);
    expect(viewerKeys.has('kol:create')).toBe(false);
    expect(viewerKeys.has('kol:edit')).toBe(false);
  });
});

describe('chọn line ship (màn Đóng hàng)', () => {
  it('map sang quyền sửa của đội logistics, KHÔNG đòi quyền brand requests', () => {
    expect(OLD_TO_NEW['chon_line_ship']).toEqual(['fulfillment.logistics:edit']);
  });

  it('vai trò logistics có đủ quyền chọn line, nhưng không có manage_fulfillment', () => {
    const logistics = new Set(SYSTEM_ROLE_SEEDS['logistics'].keys);
    expect(OLD_TO_NEW['chon_line_ship'].every((k) => logistics.has(k))).toBe(true);
    expect(OLD_TO_NEW['manage_fulfillment'].every((k) => logistics.has(k))).toBe(false);
  });
});

// Nhật ký thay đổi (spec §7, Ruling 2 của kế hoạch 20/10/2026): CEO chốt MỌI nhân sự
// xem được nhật ký, nhưng vẫn qua một quyền riêng để sau này siết được một vai trò.
describe('quyền xem nhật ký thay đổi', () => {
  it('view_nhat_ky map sang nhat_ky:view', () => {
    expect(OLD_TO_NEW['view_nhat_ky']).toEqual(['nhat_ky:view']);
  });

  it('mọi vai trò hạt giống đều xem được nhật ký', () => {
    for (const [key, seed] of Object.entries(SYSTEM_ROLE_SEEDS)) {
      expect(new Set(seed.keys).has('nhat_ky:view'), `vai trò ${key}`).toBe(true);
    }
  });

  // Vai trò CẤP TAY trong Settings (production đang có `OC`) không có hạt giống nào, nên
  // chỉ thêm vào SYSTEM_ROLE_SEEDS là KHÔNG tới được chúng. Nền chung này là đường cấp.
  it('nhat_ky:view nằm trong nền chung cấp cho mọi vai trò, kể cả vai cấp tay', () => {
    expect(QUYEN_MOI_VAI_TRO).toContain('nhat_ky:view');
  });

  it('mọi khoá của nền chung đều hợp lệ', () => {
    for (const k of QUYEN_MOI_VAI_TRO) expect(isValidKey(k)).toBe(true);
  });
});

// Tạo vận đơn (CEO 21/10/2026: "hình như chưa quyền Tạo vận đơn thì phải"). Trước đó việc
// nhập mã vận đơn đi ké `manage_fulfillment`, nên không có cách nào cho ai nhập mã mà không
// cho họ đóng/mở kiện và sửa danh mục box — và đội `logistics`, chính người làm việc đó, lại
// không nhập được. Tách thành quyền riêng `tao_van_don`.
describe('quyền tạo vận đơn', () => {
  it('tao_van_don map sang fulfillment.logistics:create — ô ĐÃ CÓ trong danh mục, không đẻ khoá mới', () => {
    expect(OLD_TO_NEW['tao_van_don']).toEqual(['fulfillment.logistics:create']);
    expect(isValidKey('fulfillment.logistics:create')).toBe(true);
  });

  it('KHÔNG còn dùng chung khoá với manage_fulfillment (đóng kiện) — đó là cả lý do tách', () => {
    for (const k of OLD_TO_NEW['tao_van_don']) {
      expect(OLD_TO_NEW['manage_fulfillment']).not.toContain(k);
    }
    // Và ngược lại: tách rồi thì đóng kiện KHÔNG được tự kéo theo quyền nhập mã.
    for (const k of OLD_TO_NEW['manage_fulfillment']) {
      expect(OLD_TO_NEW['tao_van_don']).not.toContain(k);
    }
  });

  it('cũng không dùng chung khoá với chon_line_ship — chọn line và nhập mã là hai việc', () => {
    expect(OLD_TO_NEW['chon_line_ship']).not.toEqual(OLD_TO_NEW['tao_van_don']);
  });

  it('admin · operator · logistics đều tạo vận đơn được; viewer thì KHÔNG', () => {
    const co = (vai: string) => {
      const keys = new Set(SYSTEM_ROLE_SEEDS[vai].keys);
      return OLD_TO_NEW['tao_van_don'].every((k) => keys.has(k));
    };
    expect(co('admin')).toBe(true);
    expect(co('operator')).toBe(true);
    // Đây là LỖI được sửa 21/10/2026: vai này có khoá trong hạt giống nhưng cổng cũ lại hỏi
    // `manage_fulfillment` mà họ không có, nên 2 người làm việc hằng ngày trên màn Đóng hàng
    // không nhập được mã.
    expect(co('logistics')).toBe(true);
    expect(co('viewer')).toBe(false);
  });

  it('vai logistics tạo vận đơn được NHƯNG vẫn KHÔNG đóng kiện được — đúng chủ ý', () => {
    const keys = new Set(SYSTEM_ROLE_SEEDS['logistics'].keys);
    expect(OLD_TO_NEW['tao_van_don'].every((k) => keys.has(k))).toBe(true);
    expect(OLD_TO_NEW['manage_fulfillment'].every((k) => keys.has(k))).toBe(false);
  });

  it('viewer vẫn chỉ-đọc: không khoá nào của tao_van_don lọt vào', () => {
    const keys = new Set(SYSTEM_ROLE_SEEDS.viewer.keys);
    for (const k of OLD_TO_NEW['tao_van_don']) expect(keys.has(k)).toBe(false);
  });

  // Vai `OC` cấp TAY trên production, không có hạt giống — `SYSTEM_ROLE_SEEDS` không tới
  // được nó, mà `QUYEN_MOI_VAI_TRO` thì cấp cho MỌI vai (gồm `viewer`) nên cũng không dùng
  // được. Đường cấp đúng là map theo tên vai.
  it('vai OC (cấp tay) được cấp qua QUYEN_THEO_VAI_NGOAI_HAT_GIONG', () => {
    expect(QUYEN_THEO_VAI_NGOAI_HAT_GIONG['OC']).toEqual(OLD_TO_NEW['tao_van_don']);
  });

  it('quyền này KHÔNG nằm trong nền chung cấp-cho-mọi-vai (viewer sẽ dính)', () => {
    for (const k of OLD_TO_NEW['tao_van_don']) expect(QUYEN_MOI_VAI_TRO).not.toContain(k);
  });

  it('mọi khoá khai theo tên vai đều hợp lệ, và không vai nào trong đó là viewer', () => {
    for (const [vai, keys] of Object.entries(QUYEN_THEO_VAI_NGOAI_HAT_GIONG)) {
      expect(vai).not.toBe('viewer');
      for (const k of keys) expect(isValidKey(k)).toBe(true);
    }
  });
});

// Hai ô CHẾT bỏ khỏi danh mục 21/10/2026: `fulfillment.logistics:view` và `:delete` tích
// được trên màn Roles & Permissions mà KHÔNG chỗ nào trong hệ thống kiểm chúng.
describe('scope fulfillment.logistics — chỉ còn hai hành động có thật', () => {
  it('danh mục chỉ còn create (nhập mã vận đơn) và edit (chọn line ship)', () => {
    const scope = CATALOG.find((s) => s.key === 'fulfillment.logistics');
    expect(scope).toBeDefined();
    expect(scope!.actions).toEqual(['create', 'edit']);
  });

  it('hai khoá chết KHÔNG còn hợp lệ — màn phân quyền không dựng được ô cho chúng nữa', () => {
    expect(isValidKey('fulfillment.logistics:view')).toBe(false);
    expect(isValidKey('fulfillment.logistics:delete')).toBe(false);
  });

  it('nhưng hai khoá CÓ THẬT vẫn hợp lệ — đừng xoá nhầm `:create`', () => {
    expect(isValidKey('fulfillment.logistics:create')).toBe(true);
    expect(isValidKey('fulfillment.logistics:edit')).toBe(true);
  });

  it('không hạt giống nào còn cấp hai khoá chết', () => {
    for (const [vai, seed] of Object.entries(SYSTEM_ROLE_SEEDS)) {
      expect(seed.keys, `vai ${vai}`).not.toContain('fulfillment.logistics:view');
      expect(seed.keys, `vai ${vai}`).not.toContain('fulfillment.logistics:delete');
    }
  });
});
