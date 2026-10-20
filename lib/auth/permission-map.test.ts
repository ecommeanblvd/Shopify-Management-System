import { describe, expect, it } from 'vitest';
import { OLD_TO_NEW, QUYEN_MOI_VAI_TRO, SYSTEM_ROLE_SEEDS } from './permission-map';
import { isValidKey, allPermissionKeys } from './permissions';

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
    expect(l.has('fulfillment.logistics:delete')).toBe(true);
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
