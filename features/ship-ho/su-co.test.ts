import { describe, it, expect } from 'vitest';
import { LOAI_SU_CO, layLoaiSuCo, tongChiPhi, thietHaiRong, tomTatSuCo, NHAN_THUOC_VE } from './su-co';

describe('danh mục sự cố', () => {
  it('mã không trùng và mọi loại đều có mặc định thuộc về hợp lệ', () => {
    const ma = LOAI_SU_CO.map((l) => l.ma);
    expect(ma.length).toBe(new Set(ma).size);
    for (const l of LOAI_SU_CO) expect(NHAN_THUOC_VE[l.macDinhThuocVe]).toBeTruthy();
  });
  it('ca thật CEO nêu: giao sai địa chỉ là lỗi nội bộ và gợi ý đủ ba khoản tiền', () => {
    const l = layLoaiSuCo('sai_dia_chi_giao');
    expect(l?.macDinhThuocVe).toBe('noi_bo');
    expect(l?.khoanGoiY).toEqual(['Cước hoàn hàng về', 'Mua lại hàng cho khách', 'Cước ship lại lần hai']);
  });
  it('mã lạ trả null', () => {
    expect(layLoaiSuCo('khong_co')).toBeNull();
    expect(layLoaiSuCo(null)).toBeNull();
  });
});

describe('tongChiPhi', () => {
  it('cộng đúng ca giao sai địa chỉ: hoàn hàng + mua lại hàng + ship lại', () => {
    expect(tongChiPhi([
      { khoan: 'Cước hoàn hàng về', tienVnd: 1_850_000 },
      { khoan: 'Mua lại hàng cho khách', tienVnd: 4_200_000 },
      { khoan: 'Cước ship lại lần hai', tienVnd: 2_100_000 },
    ])).toBe(8_150_000);
  });
  it('bỏ qua khoản âm hoặc không phải số, không làm lệch tổng', () => {
    expect(tongChiPhi([{ khoan: 'a', tienVnd: 100 }, { khoan: 'b', tienVnd: -50 }, { khoan: 'c', tienVnd: Number.NaN }])).toBe(100);
  });
  it('danh sách rỗng → 0', () => { expect(tongChiPhi([])).toBe(0); });
});

describe('thietHaiRong', () => {
  it('trừ phần đã đòi lại được, không bao giờ âm', () => {
    expect(thietHaiRong(8_150_000, 2_000_000)).toBe(6_150_000);
    expect(thietHaiRong(1_000_000, 5_000_000)).toBe(0);
    expect(thietHaiRong(1_000_000, -5)).toBe(1_000_000);
  });
});

describe('tomTatSuCo', () => {
  it('tách riêng phần lỗi nội bộ — chỉ phần đó mới chấm KPI của vị trí', () => {
    const t = tomTatSuCo([
      { thuocVe: 'noi_bo', tongChiPhiVnd: 8_150_000, daThuHoiVnd: 0 },
      { thuocVe: 'hang_van_chuyen', tongChiPhiVnd: 3_000_000, daThuHoiVnd: 2_500_000 },
      { thuocVe: 'khach', tongChiPhiVnd: 1_000_000, daThuHoiVnd: 0 },
    ]);
    expect(t).toEqual({ n: 3, nNoiBo: 1, tongChiPhiVnd: 12_150_000, thietHaiRongVnd: 9_650_000, thietHaiNoiBoVnd: 8_150_000 });
  });
  it('không có sự cố nào → mọi số bằng 0', () => {
    expect(tomTatSuCo([])).toEqual({ n: 0, nNoiBo: 0, tongChiPhiVnd: 0, thietHaiRongVnd: 0, thietHaiNoiBoVnd: 0 });
  });
});
