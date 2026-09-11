import { describe, it, expect } from 'vitest';
import { LY_DO_CHAM, demTheoLyDo, layLyDo, loaiTruKhoiKpi } from './ly-do-cham';

describe('ly-do-cham', () => {
  it('mã lý do không trùng nhau', () => {
    const ma = LY_DO_CHAM.map((l) => l.ma);
    expect(ma.length).toBe(new Set(ma).size);
  });
  it('loại trừ KPI đúng theo mục VII: lỗi khách / hải quan ngoài / thiên tai được loại, lỗi nội bộ thì không', () => {
    expect(loaiTruKhoiKpi('khach_khong_lien_he')).toBe(true);
    expect(loaiTruKhoiKpi('sai_dia_chi_khach')).toBe(true);
    expect(loaiTruKhoiKpi('thong_quan_ngoai')).toBe(true);
    expect(loaiTruKhoiKpi('thong_quan_thieu_ct_xuat')).toBe(false);
    expect(loaiTruKhoiKpi('sai_thong_tin_van_don')).toBe(false);
  });
  it('chứng từ thông quan tách hai đầu: đầu nhập là việc của người nhận nên được loại, đầu xuất là của mình nên tính', () => {
    expect(loaiTruKhoiKpi('thong_quan_thieu_ct_nhap')).toBe(true);
    expect(loaiTruKhoiKpi('thong_quan_thieu_ct_xuat')).toBe(false);
    expect(layLyDo('thong_quan_thieu_ct_nhap')?.thuocVe).toBe('khach');
    expect(layLyDo('thong_quan_thieu_ct_xuat')?.thuocVe).toBe('noi_bo');
  });
  it('khách không đóng thuế nhập khẩu là lỗi khách, được loại khỏi KPI', () => {
    expect(loaiTruKhoiKpi('khach_khong_dong_thue')).toBe(true);
  });
  it('mọi lý do thuộc nhóm nội bộ đều KHÔNG được loại — không để lách KPI', () => {
    for (const l of LY_DO_CHAM.filter((x) => x.thuocVe === 'noi_bo')) expect(l.loaiTruKpi).toBe(false);
  });
  it('chưa gán lý do thì KHÔNG được loại khỏi KPI', () => {
    expect(loaiTruKhoiKpi(null)).toBe(false);
    expect(loaiTruKhoiKpi('ma_la')).toBe(false);
    expect(layLyDo(null)).toBeNull();
  });
  it('demTheoLyDo: gom kiện chưa gán, sắp giảm dần', () => {
    const d = demTheoLyDo(['khach_khong_lien_he', 'khach_khong_lien_he', null, 'thong_quan_thieu_ct_xuat']);
    expect(d[0]).toMatchObject({ ma: 'khach_khong_lien_he', n: 2, loaiTruKpi: true, thuocVe: 'khach' });
    expect(d.find((x) => x.ma === '(chưa gán)')).toMatchObject({ n: 1, loaiTruKpi: false });
  });
});
