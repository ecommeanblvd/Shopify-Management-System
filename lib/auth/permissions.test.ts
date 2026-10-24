import { describe, expect, it } from 'vitest';
import { CATALOG, ACTIONS, allPermissionKeys, isValidKey, nhanHanhDongLac } from './permissions';

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
   * Chính cái ô CEO đi tìm 24/10/2026 mà không thấy. Ghim nguyên văn "Tạo vận đơn": đổi
   * chữ này là đổi cái người ta sẽ Ctrl+F trên màn phân quyền.
   */
  it('fulfillment.logistics nói rõ Tạo vận đơn / Chọn line ship', () => {
    expect(nhan('fulfillment.logistics').create).toBe('Tạo vận đơn');
    expect(nhan('fulfillment.logistics').edit).toBe('Chọn line ship');
  });

  it('các ô create/edit mơ hồ khác đều đã có nhãn', () => {
    expect(nhan('fulfillment.operations').edit).toMatch(/đóng hàng/i);
    expect(nhan('warehouse.qc').override).toMatch(/QC/);
    expect(nhan('fulfillment.pack_check').create).toMatch(/kiểm kiện/i);
    expect(nhan('orders').edit).toMatch(/giá vốn/i);
    // `create` của Settings Sync là QUẢN LÝ TEMPLATE, không phải "tạo" gì — đúng kiểu nhãn
    // mà thiếu thì người cấp quyền đoán sai.
    expect(nhan('settings_sync').create).toMatch(/template/i);
    expect(nhan('markets').apply).toMatch(/store/i);
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

  /**
   * Nhãn trùng nhau giữa HAI phạm vi khác nhau là dấu hiệu đặt tên chung chung ("Sửa",
   * "Quản lý") — đúng cái bệnh mà trường này sinh ra để chữa.
   */
  it('nhãn không trùng nhau giữa các phạm vi', () => {
    const tatCa = CATALOG.flatMap((s) => Object.values(s.nhanHanhDong ?? {}));
    expect(new Set(tatCa).size).toBe(tatCa.length);
  });
});
