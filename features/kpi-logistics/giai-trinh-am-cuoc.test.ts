import { describe, it, expect } from 'vitest';
import {
  goiYLyDo, dauHieu, quyTrachNhiem, daPhanDinh, danhGiaKien, layLyDoAmCuoc, tongBilledKg, LY_DO_AM_CUOC,
  canChonSanPham, thieuSanPham, kiemSanPhamSai, hienCanGram, suyMonSaiCan, type TinHieu,
} from './giai-trinh-am-cuoc';

const t = (kien: TinHieu['kien'], extra: Partial<TinHieu> = {}): TinHieu =>
  ({ soKien: kien.length, kien, phiVungSauXaVnd: 0, phiSuaDiaChiVnd: 0, canWebKg: null, ...extra });
const k = (thucKg: number, d: number, r: number, c: number, billedKg: number) =>
  ({ thucKg, daiCm: d, rongCm: r, caoCm: c, billedKg });

// Số lấy từ đơn thật T8/2026 trong bảng giải trình của Đức.
describe('goiYLyDo — đúng với ca thật T8', () => {
  it('#MBLVD29923: web khai 3kg, thùng 45×29×28 quy đổi 7,3kg, hãng tính 7,3kg → cân web thấp', () => {
    expect(goiYLyDo(t([k(1.6, 45, 29, 28, 7.3)], { canWebKg: 3 }))).toBe('can_quy_doi_web');
    expect(dauHieu(t([k(1.6, 45, 29, 28, 7.3)], { canWebKg: 3 }))).toContain('web khai 3kg, hãng tính 7.3kg');
  });
  it('#MBLVD29572: lệch chỉ 0,4kg (web 1,6 → hãng 2,0) vẫn bắt được — Đức đúng, ngưỡng cũ sót', () => {
    expect(goiYLyDo(t([k(1.6, 39, 28, 9, 2)], { canWebKg: 1.6 }))).toBe('can_quy_doi_web');
  });
  it('web khai đúng bằng cân hãng tính thì không phải lỗi cân web', () => {
    expect(goiYLyDo(t([k(1.6, 39, 28, 9, 2)], { canWebKg: 2 }))).toBe('bang_gia_thap');
  });
  it('hai kiện thì so tổng cân hãng tính với cân web', () => {
    expect(tongBilledKg(t([k(1, 1, 1, 1, 1.1), k(1, 1, 1, 1, 3.7)]))).toBe(4.8);
  });
  it('#MBLVD29877: 0,9kg FedEx Pak nhưng hãng tính 9,4kg → hãng tính sai', () => {
    expect(goiYLyDo(t([k(0.9, 40, 31, 2, 9.4)]))).toBe('hang_tinh_sai_can');
  });
  it('#MBLVD29945: Đức ghi "không có gì phát sinh" nhưng bill có phí vùng sâu xa 550.000đ', () => {
    expect(goiYLyDo(t([k(0.3, 40, 31, 2, 0.3)], { phiVungSauXaVnd: 550_000 }))).toBe('phi_vung_sau_xa');
  });
  it('#MBLVD29752: phí sửa địa chỉ 289.200đ', () => {
    expect(goiYLyDo(t([k(0.6, 40, 31, 2, 0.6)], { phiSuaDiaChiVnd: 289_200 }))).toBe('phi_sua_dia_chi');
  });
  it('#MBLVD29467: hai kiện → tách kiện', () => {
    expect(goiYLyDo(t([k(1.1, 40, 31, 2, 1.1), k(1.9, 30, 25, 25, 3.7)]))).toBe('tach_kien');
  });
  it('không dấu hiệu nào → bảng giá thấp', () => {
    expect(goiYLyDo(t([k(1.2, 20, 20, 5, 1.2)]))).toBe('bang_gia_thap');
  });
  it('thùng 42×30×10 hãng tính 2,5kg dù quy đổi 2,52kg → hãng tính đúng, lỗi ở cân web 2kg', () => {
    expect(danhGiaKien(k(1.6, 42, 30, 10, 2.5)).lechKg).toBeLessThan(0.5);
    expect(goiYLyDo(t([k(1.6, 42, 30, 10, 2.5)], { canWebKg: 2 }))).toBe('can_quy_doi_web');
  });
  it('không có cân web thì lùi về so với cân thực', () => {
    expect(goiYLyDo(t([k(1.6, 45, 29, 28, 7.3)]))).toBe('can_quy_doi_web');
  });
});

describe('dauHieu', () => {
  it('liệt kê mọi dấu hiệu, không chỉ lý do chính', () => {
    const d = dauHieu(t([k(1.1, 39, 28, 9, 2)], { phiVungSauXaVnd: 120_000, canWebKg: 1.1 }));
    expect(d).toContain('vùng sâu xa 120.000đ');
    expect(d).toContain('web khai 1.1kg, hãng tính 2kg');
  });
});

describe('quyTrachNhiem — người giải trình không tự phân xử', () => {
  it('sai cân web là lỗi nội bộ (CEO 16/09/2026)', () => {
    expect(quyTrachNhiem('can_quy_doi_web')).toBe('noi_bo');
  });
  it('chỉ lý do nội bộ rõ ràng mới thành lỗi nội bộ', () => {
    expect(quyTrachNhiem('hang_tinh_sai_can')).toBe('hang');
    expect(quyTrachNhiem('tach_kien', { lyDoTach: 'thieu_hang' })).toBe('noi_bo');
    expect(quyTrachNhiem('phi_sua_dia_chi', { nguonSaiDiaChi: 'noi_bo' })).toBe('noi_bo');
  });
  it('thiếu dữ kiện thì chờ quản lý chốt, không đoán', () => {
    expect(quyTrachNhiem('phi_sua_dia_chi')).toBe('chua_ro');
    expect(quyTrachNhiem('tach_kien')).toBe('chua_ro');
    expect(quyTrachNhiem('khac')).toBe('chua_ro');
    expect(daPhanDinh('chua_ro')).toBe(false);
    expect(daPhanDinh('hang')).toBe(true);
  });
  it('mọi lý do trong danh mục đều quy được', () => {
    for (const l of LY_DO_AM_CUOC) expect(quyTrachNhiem(l.ma)).toBeTruthy();
    expect(layLyDoAmCuoc('khong_ton_tai')).toBeNull();
  });
});

describe('chọn đúng món sai cân (CEO 16/09/2026)', () => {
  const don = [{ sku: 'A', canHienTaiG: 700 }, { sku: 'B', canHienTaiG: 500 }];

  it('lý do cân web và quy định thùng bắt chọn món; lý do khác thì không', () => {
    expect(canChonSanPham('can_quy_doi_web')).toBe(true);
    expect(canChonSanPham('rule_thung_brand')).toBe(true);
    expect(canChonSanPham('phi_vung_sau_xa')).toBe(false);
  });

  it('chưa chọn món nào là thiếu', () => {
    expect(thieuSanPham('can_quy_doi_web', {})).toBe(true);
    expect(thieuSanPham('can_quy_doi_web', { sanPhamSai: [{ sku: 'A', canMoiG: 1200 }] })).toBe(false);
    expect(thieuSanPham('phi_vung_sau_xa', {})).toBe(false);
  });

  it('hợp lệ khi chọn đúng món trong đơn và cân mới cao hơn cân đang khai', () => {
    expect(kiemSanPhamSai([{ sku: 'A', canMoiG: 1200 }], don)).toBeNull();
  });

  it('chặn các trường hợp sai', () => {
    expect(kiemSanPhamSai([], don)).toContain('ít nhất một món');
    expect(kiemSanPhamSai([{ sku: 'X', canMoiG: 1000 }], don)).toContain('không nằm trong đơn');
    expect(kiemSanPhamSai([{ sku: 'A', canMoiG: 1000 }, { sku: 'A', canMoiG: 1100 }], don)).toContain('hai lần');
    expect(kiemSanPhamSai([{ sku: 'A', canMoiG: 0 }], don)).toContain('Nhập cân');
    expect(kiemSanPhamSai([{ sku: 'A', canMoiG: 600 }], don)).toContain('phải cao hơn');
    expect(kiemSanPhamSai([{ sku: 'A', canMoiG: 45_000 }], don)).toContain('đơn vị');
  });
});

describe('hienCanGram — cân lưu gram hiện thành kg', () => {
  it('800g là 0,8kg, không phải 800kg', () => {
    expect(hienCanGram(800)).toBe('0,8kg');
    expect(hienCanGram(2500)).toBe('2,5kg');
    expect(hienCanGram(1250)).toBe('1,25kg');
  });
  it('chưa có số thì gạch', () => {
    expect(hienCanGram(null)).toBe('—');
  });
});

describe('chưa xác định được món (CEO 30/09/2026)', () => {
  const don = [{ sku: 'A', canHienTaiG: 1000 }, { sku: 'B', canHienTaiG: 800 }];

  it('đánh dấu chưa biết thì lưu được, không chặn nữa', () => {
    expect(kiemSanPhamSai(null, don, true)).toBeNull();
    expect(kiemSanPhamSai([], don, true)).toBeNull();
  });

  it('vừa đánh dấu chưa biết vừa chọn món là hai lời mâu thuẫn → chặn', () => {
    expect(kiemSanPhamSai([{ sku: 'A', canMoiG: 2000 }], don, true)).toBe('Đã đánh dấu chưa xác định được món thì không chọn món nào');
  });

  it('KHÔNG đánh dấu thì luật cũ giữ nguyên — bỏ trống vẫn bị chặn', () => {
    expect(kiemSanPhamSai(null, don)).toBe('Chọn ít nhất một món bị khai sai cân');
    expect(kiemSanPhamSai(null, don, false)).toBe('Chọn ít nhất một món bị khai sai cân');
  });

  it('trách nhiệm vẫn là nội bộ — chưa biết món KHÔNG phải lối thoát khỏi KPI', () => {
    expect(quyTrachNhiem('can_quy_doi_web', { chuaXacDinhMon: true })).toBe('noi_bo');
  });

  it('vẫn nằm trong danh sách cần tìm món', () => {
    expect(thieuSanPham('can_quy_doi_web', { chuaXacDinhMon: true })).toBe(true);
  });
});

describe('suyMonSaiCan — suy món khi không nhớ, bằng bằng chứng chứ không chia đều', () => {
  const don = [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }];

  it('đúng MỘT món từng bị chỉ đích danh ở đơn khác → chỉ nó', () => {
    expect(suyMonSaiCan(don, new Set(['B']), new Set())).toEqual({ sku: 'B', canCu: 'don-khac' });
  });

  it('HAI món đều từng bị chỉ → TRẢ NULL, không đoán giữa hai', () => {
    expect(suyMonSaiCan(don, new Set(['A', 'B']), new Set())).toBeNull();
  });

  it('mọi món khác đã sửa cân, còn đúng một món → loại trừ ra nó', () => {
    expect(suyMonSaiCan(don, new Set(), new Set(['A', 'B']))).toEqual({ sku: 'C', canCu: 'loai-tru' });
  });

  it('còn hai món chưa sửa → TRẢ NULL', () => {
    expect(suyMonSaiCan(don, new Set(), new Set(['A']))).toBeNull();
  });

  it('bằng chứng từ đơn khác ĐƯỢC ƯU TIÊN hơn loại trừ', () => {
    expect(suyMonSaiCan(don, new Set(['A']), new Set(['A', 'B']))).toEqual({ sku: 'A', canCu: 'don-khac' });
  });

  it('đơn MỘT món không cần suy — form đã điền sẵn', () => {
    expect(suyMonSaiCan([{ sku: 'A' }], new Set(), new Set())).toBeNull();
  });

  it('đơn không có SKU nào → null, không ném', () => {
    expect(suyMonSaiCan([], new Set(), new Set())).toBeNull();
  });

  it('món trùng lặp trong đơn chỉ tính một lần', () => {
    expect(suyMonSaiCan([{ sku: 'A' }, { sku: 'A' }, { sku: 'B' }], new Set(), new Set(['A'])))
      .toEqual({ sku: 'B', canCu: 'loai-tru' });
  });
});
