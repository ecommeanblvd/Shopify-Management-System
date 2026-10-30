import { describe, expect, it, beforeAll } from 'vitest';
import { primeRoleCache } from '@/lib/auth/access';
import { SYSTEM_ROLE_SEEDS } from '@/lib/auth/permission-map';
import { quyenCuaModule, moduleXemDuoc, xemDuocChu, xemDuocAnh, phamViDoc, quyenCoHieuLuc } from './pham-vi';
import { moduleTuDuongDan } from './phan-loai';

/**
 * Vai GIẢ chỉ dùng trong test, dựng để cô lập đúng một điều kiện mỗi vai. Vai thật trong
 * production có hàng chục quyền nên không chứng minh được "thiếu quyền này thì không thấy".
 */
const VAI_GIA: Record<string, string[]> = {
  // Xem được báo lỗi + ĐÚNG MỘT màn trong `NAV` (Ship hộ).
  chi_ship_ho: ['bao_loi:view', 'ship_ho:view'],
  // Xem được báo lỗi + một màn chỉ khai trong `SETTINGS_ITEMS` (Sửa cân sản phẩm).
  chi_can_san_pham: ['bao_loi:view', 'kpi.logistics:view'],
  // Có quyền màn nhưng KHÔNG có `bao_loi:view`.
  khong_quyen_bao_loi: ['ship_ho:view'],
  // Xem hết mọi bộ phận.
  xem_het: ['bao_loi:view', 'bao_loi.tat_ca:view'],
};

beforeAll(() => {
  primeRoleCache({
    ...Object.fromEntries(Object.entries(SYSTEM_ROLE_SEEDS).map(([k, v]) => [k, v.keys])),
    ...VAI_GIA,
  });
});

describe('quyenCuaModule', () => {
  it('dựng quyền từ cả NAV và SETTINGS_ITEMS', () => {
    // `can-san-pham` CHỈ có mục trong `SETTINGS_ITEMS`. Lấy mỗi `NAV` là bỏ sót nó.
    expect(quyenCuaModule().get('can-san-pham')).toContain('view_kpi_logistics');
  });

  it('module có hai mục NAV thì nhận cả hai quyền', () => {
    // `/f/ship-report` và `/f/ship-report?tab=kpi` cùng ra module `ship-report`.
    const q = quyenCuaModule().get('ship-report');
    expect(q).toContain('view_carrier_rates');
    expect(q).toContain('view_kpi_logistics');
  });

  it('quyền ánh xạ RỖNG không dựng được phạm vi', () => {
    // `OLD_TO_NEW.view = []` và `[].every(...) === true`, nên `hasPermission(bất kỳ vai, 'view')`
    // LUÔN đúng. Một mục `NAV` khai `requires: 'view'` sẽ biến module đó thành "ai cũng thấy" —
    // cùng hạng lỗi với `requires: null`, nên phải chặn cùng một chỗ.
    expect(quyenCoHieuLuc('view')).toBe(false);
    expect(quyenCoHieuLuc('view_ship_ho')).toBe(true);
    for (const [ma, ds] of quyenCuaModule()) {
      for (const q of ds) expect(quyenCoHieuLuc(q), `${ma} → ${q}`).toBe(true);
    }
  });

  it('requires null thì KHÔNG dựng quyền', () => {
    // `/settings` và `/` (Dashboard) mang `requires: null`, mà `canSeeNavItem` trả true cho
    // null — dựng quyền từ chúng là biến hai module này thành "ai cũng thấy".
    expect(quyenCuaModule().has('settings')).toBe(false);
    expect(quyenCuaModule().has('khac')).toBe(false);
  });
});

describe('xemDuocChu', () => {
  it('settings và khac không thành ai-cũng-thấy', () => {
    for (const m of ['settings', 'khac']) {
      expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: m, laNguoiBao: false }), m).toBe(false);
    }
  });

  it('tat_ca thấy mọi module kể cả khac và module lạ', () => {
    for (const m of ['khac', 'settings', 'ship-ho', 'module-da-bi-bo']) {
      expect(xemDuocChu({ roleKey: 'xem_het', module: m, laNguoiBao: false }), m).toBe(true);
    }
    expect(moduleXemDuoc('xem_het').tatCa).toBe(true);
  });

  it('chỉ view_bao_loi + quyền một màn thì KHÔNG thấy màn khác', () => {
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'ship-ho', laNguoiBao: false })).toBe(true);
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'orders', laNguoiBao: false })).toBe(false);
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'cx', laNguoiBao: false })).toBe(false);
  });

  it('module cần nhiều quyền thì CÓ MỘT là đủ (OR, không phải AND)', () => {
    // `ship-report` nhận cả `view_carrier_rates` và `view_kpi_logistics`. Vai này chỉ có quyền
    // thứ hai. Gộp bằng AND thì nó mất quyền đọc lỗi của màn nó mở được — và một lượt đột biến
    // đổi `some` thành `every` ĐÃ sống sót vì không ca nào phủ chỗ này (đo 30/10/2026).
    expect(quyenCuaModule().get('ship-report')!.length).toBeGreaterThan(1);
    expect(xemDuocChu({ roleKey: 'chi_can_san_pham', module: 'ship-report', laNguoiBao: false })).toBe(true);
    expect(moduleXemDuoc('chi_can_san_pham').module.has('ship-report')).toBe(true);
  });

  it('quyền rút từ SETTINGS_ITEMS cũng có tác dụng', () => {
    expect(xemDuocChu({ roleKey: 'chi_can_san_pham', module: 'can-san-pham', laNguoiBao: false })).toBe(true);
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'can-san-pham', laNguoiBao: false })).toBe(false);
  });

  it('module không có trong map thì chỉ tat_ca thấy', () => {
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'module-da-bi-bo', laNguoiBao: false })).toBe(false);
    expect(xemDuocChu({ roleKey: 'operator', module: 'module-da-bi-bo', laNguoiBao: false })).toBe(false);
  });

  it('người báo luôn thấy lỗi của mình, kể cả module ngoài phạm vi', () => {
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'admin', laNguoiBao: true })).toBe(true);
    expect(xemDuocChu({ roleKey: 'khong_quyen_bao_loi', module: 'khac', laNguoiBao: true })).toBe(true);
  });

  it('không có view_bao_loi thì không thấy gì và KHÔNG ném', () => {
    expect(() => xemDuocChu({ roleKey: 'khong_quyen_bao_loi', module: 'ship-ho', laNguoiBao: false })).not.toThrow();
    expect(xemDuocChu({ roleKey: 'khong_quyen_bao_loi', module: 'ship-ho', laNguoiBao: false })).toBe(false);
    expect(() => xemDuocChu({ roleKey: 'vai-khong-ton-tai', module: 'ship-ho', laNguoiBao: false })).not.toThrow();
  });
});

describe('xemDuocAnh', () => {
  it('tat_ca xem được', () => {
    expect(xemDuocAnh({ roleKey: 'xem_het', laNguoiBao: false })).toBe(true);
  });

  it('người báo xem được dù không có quyền module nào', () => {
    expect(xemDuocAnh({ roleKey: 'khong_quyen_bao_loi', laNguoiBao: true })).toBe(true);
  });

  it('cùng module mà không phải người báo và không tat_ca thì KHÔNG xem được ảnh', () => {
    // Ca chặn của lối (b) — thiết kế §11: chữ hiện theo quyền module, ẢNH thì không.
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: 'ship-ho', laNguoiBao: false })).toBe(true);
    expect(xemDuocAnh({ roleKey: 'chi_ship_ho', laNguoiBao: false })).toBe(false);
  });
});

describe('phamViDoc — mô tả phạm vi để dựng điều kiện SQL', () => {
  it('tat_ca thì không lọc gì', () => {
    expect(phamViDoc('xem_het')).toEqual({ kieu: 'tat_ca' });
  });

  it('vai thường thì lọc theo danh sách module xem được', () => {
    const pv = phamViDoc('chi_ship_ho');
    expect(pv.kieu).toBe('loc');
    if (pv.kieu !== 'loc') throw new Error('sai nhánh');
    expect(pv.module).toContain('ship-ho');
    expect(pv.module).not.toContain('orders');
    expect(pv.module).not.toContain('khac');
  });

  it('không có view_bao_loi thì danh sách module RỖNG — nhưng vẫn là loc, không phải chặn hết', () => {
    // Điều kiện SQL luôn còn nhánh `reporter_id = tôi`, nên người báo vẫn đọc được lỗi của
    // mình kể cả khi vai chưa được seed quyền. Trả `tat_ca` ở đây thì ngược lại: mở hết.
    expect(phamViDoc('khong_quyen_bao_loi')).toEqual({ kieu: 'loc', module: [] });
  });

  it('danh sách module sắp ổn định để câu SQL không đổi giữa hai lượt chạy', () => {
    const a = phamViDoc('operator');
    const b = phamViDoc('operator');
    if (a.kieu !== 'loc' || b.kieu !== 'loc') throw new Error('sai nhánh');
    expect(a.module).toEqual(b.module);
    expect(a.module).toEqual([...a.module].sort());
  });
});

describe('tab Lịch sử mở trên trang không thuộc module nào', () => {
  it('module của trang Dashboard là khac, nên nhân sự chỉ thấy báo lỗi của chính mình ở đó', () => {
    // Panel Báo lỗi nằm ở Topbar nên mở được ở MỌI trang, gồm `/`. Nếu tab Lịch sử hiện một
    // bảng trống ở đó thì người dùng kết luận "hệ thống mất báo lỗi của tôi".
    const ma = moduleTuDuongDan('/').ma;
    expect(ma).toBe('khac');
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: ma, laNguoiBao: false })).toBe(false);
    expect(xemDuocChu({ roleKey: 'chi_ship_ho', module: ma, laNguoiBao: true })).toBe(true);
    // Và phạm vi của vai đó KHÔNG chứa `khac` — nên nơi gọi biết phải hiện câu giải thích.
    expect(moduleXemDuoc('chi_ship_ho').module.has('khac')).toBe(false);
  });
});
