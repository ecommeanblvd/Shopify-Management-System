import { describe, it, expect } from 'vitest';
import { LOAI_SU_CO, DIEN_BIEN, dienBienGoiY, heSoHangHoa, layLoaiSuCo, tongChiPhi, thietHaiRong, tomTatSuCo, soNgayGhiTre, NHAN_THUOC_VE } from './su-co';

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
    expect(t).toEqual({ n: 3, nNoiBo: 1, tongChiPhiVnd: 12_150_000, thietHaiRongVnd: 9_650_000, thietHaiNoiBoVnd: 8_150_000, thietHaiQuyDoiVnd: 8_150_000, thietHaiChamDiemVnd: 8_150_000, nGhiTre: 0, nChuaQuyTrachNhiem: 0, nChuaChotTien: 0 });
  });
  it('không có sự cố nào → mọi số bằng 0', () => {
    expect(tomTatSuCo([])).toEqual({ n: 0, nNoiBo: 0, tongChiPhiVnd: 0, thietHaiRongVnd: 0, thietHaiNoiBoVnd: 0, thietHaiQuyDoiVnd: 0, thietHaiChamDiemVnd: 0, nGhiTre: 0, nChuaQuyTrachNhiem: 0, nChuaChotTien: 0 });
  });
});

describe('hệ số nghiêm trọng và hạn ghi sự cố (CEO 12/09/2026)', () => {
  it('ship sai địa chỉ nhân đôi khi quy ra điểm, tiền thật giữ nguyên', () => {
    const t = tomTatSuCo([{ loai: 'sai_dia_chi_giao', thuocVe: 'noi_bo', tongChiPhiVnd: 10_000_000, daThuHoiVnd: 0 }]);
    expect(t.thietHaiNoiBoVnd).toBe(10_000_000);
    expect(t.thietHaiChamDiemVnd).toBe(20_000_000);
  });

  it('loại khác giữ hệ số 1,0', () => {
    const t = tomTatSuCo([{ loai: 'gui_tre', thuocVe: 'noi_bo', tongChiPhiVnd: 4_000_000, daThuHoiVnd: 0 }]);
    expect(t.thietHaiChamDiemVnd).toBe(4_000_000);
  });

  it('nhân hệ số trên thiệt hại RÒNG, đòi lại được thì nhẹ theo', () => {
    const t = tomTatSuCo([{ loai: 'sai_dia_chi_giao', thuocVe: 'noi_bo', tongChiPhiVnd: 10_000_000, daThuHoiVnd: 7_000_000 }]);
    expect(t.thietHaiChamDiemVnd).toBe(6_000_000);
  });

  it('chỉ lỗi nội bộ vào số chấm điểm, lỗi hãng thì không', () => {
    const t = tomTatSuCo([{ loai: 'sai_dia_chi_giao', thuocVe: 'hang_van_chuyen', tongChiPhiVnd: 10_000_000, daThuHoiVnd: 0 }]);
    expect(t.thietHaiChamDiemVnd).toBe(0);
  });

  it('ghi quá 7 ngày là ghi trễ; đúng 7 ngày vẫn trong hạn', () => {
    // Ngày sau mốc áp dụng để đo đúng luật 7 ngày (mốc: xem NGAY_AP_DUNG_HAN_GHI).
    expect(soNgayGhiTre('2026-10-01', '2026-10-08T10:00:00Z')).toBe(7);
    const dung = tomTatSuCo([{ thuocVe: 'noi_bo', tongChiPhiVnd: 0, daThuHoiVnd: 0, ngay: '2026-10-01', ngayGhi: '2026-10-08T10:00:00Z' }]);
    expect(dung.nGhiTre).toBe(0);
    const tre = tomTatSuCo([{ thuocVe: 'noi_bo', tongChiPhiVnd: 0, daThuHoiVnd: 0, ngay: '2026-10-01', ngayGhi: '2026-10-09T00:00:00Z' }]);
    expect(tre.nGhiTre).toBe(1);
  });

  it('sự cố còn để "khác" tính là chưa quy được trách nhiệm', () => {
    expect(tomTatSuCo([{ thuocVe: 'khac', tongChiPhiVnd: 500_000, daThuHoiVnd: 0 }]).nChuaQuyTrachNhiem).toBe(1);
  });
});

describe('khai báo nhanh: tick diễn biến, tiền chốt sau', () => {
  it('loại sai địa chỉ tick sẵn hoàn về và brand làm lại hàng', () => {
    expect(dienBienGoiY('sai_dia_chi_giao')).toEqual(['dang_hoan_ve', 'brand_lam_lai_hang']);
  });

  it('lỗi hãng tick sẵn đang đòi bồi thường', () => {
    expect(dienBienGoiY('hang_lam_mat')).toEqual(['dang_doi_boi_thuong']);
  });

  it('loại không có gợi ý thì không tick gì', () => {
    expect(dienBienGoiY('khac')).toEqual([]);
  });

  it('mọi mã diễn biến trong goiYCho phải là mã loại sự cố thật', () => {
    const ma = new Set(LOAI_SU_CO.map((l) => l.ma));
    for (const d of DIEN_BIEN) for (const g of d.goiYCho ?? []) expect(ma.has(g)).toBe(true);
  });

  it('đếm được số vụ khai báo mà chưa chốt tiền', () => {
    const t = tomTatSuCo([
      { thuocVe: 'noi_bo', tongChiPhiVnd: 0, daThuHoiVnd: 0, daChotTien: false },
      { thuocVe: 'noi_bo', tongChiPhiVnd: 2_000_000, daThuHoiVnd: 0, daChotTien: true },
    ]);
    expect(t.nChuaChotTien).toBe(1);
    expect(t.thietHaiChamDiemVnd).toBe(2_000_000);
  });
});

describe('hệ số hàng hoá — ước phần nằm ngoài hệ thống (CEO 12/09/2026)', () => {
  it('có hàng phải làm lại thì nhân 2 để đại diện tiền hàng', () => {
    expect(heSoHangHoa(['brand_lam_lai_hang'])).toBe(2);
    expect(heSoHangHoa(['da_mua_lai_hang'])).toBe(2);
  });

  it('diễn biến chỉ về ship thì không nhân — cước đã đo được rồi', () => {
    expect(heSoHangHoa(['dang_hoan_ve', 'da_ship_lai'])).toBe(1);
    expect(heSoHangHoa([])).toBe(1);
  });

  it('có số tiền hàng THẬT từ đối soát thì tắt ước', () => {
    expect(heSoHangHoa(['brand_lam_lai_hang'], true)).toBe(1);
  });

  it('ba tầng số tách rời: tiền thật, ước cả hàng, số chấm điểm', () => {
    const t = tomTatSuCo([{
      loai: 'sai_dia_chi_giao', thuocVe: 'noi_bo',
      tongChiPhiVnd: 3_570_458, daThuHoiVnd: 1_892_043,
      dienBien: ['dang_hoan_ve', 'brand_lam_lai_hang'],
    }]);
    expect(t.thietHaiNoiBoVnd).toBe(1_678_415);       // tiền thật, dùng cho kế toán
    expect(t.thietHaiQuyDoiVnd).toBe(3_356_830);      // × 2 hàng hoá
    expect(t.thietHaiChamDiemVnd).toBe(6_713_660);    // × 2 nghiêm trọng sai địa chỉ
  });
});

describe('hạn ghi sự cố không hồi tố (CEO 12/09/2026)', () => {
  it('sự cố trước ngày áp dụng thì đếm hạn TỪ ngày áp dụng, không phải ngày sự cố', () => {
    // Ca KLS2053: sự cố 25/08, quy định có 12/09 — ghi ngày 12/09 phải là đúng hạn.
    expect(soNgayGhiTre('2026-08-25', '2026-09-12T10:00:00Z')).toBe(0);
    expect(tomTatSuCo([{ thuocVe: 'noi_bo', tongChiPhiVnd: 0, daThuHoiVnd: 0, ngay: '2026-08-25', ngayGhi: '2026-09-12T10:00:00Z' }]).nGhiTre).toBe(0);
  });

  it('quá 7 ngày kể từ ngày áp dụng vẫn là ghi trễ', () => {
    expect(soNgayGhiTre('2026-08-25', '2026-09-20T00:00:00Z')).toBe(8);
  });

  it('sự cố SAU ngày áp dụng thì đếm từ chính ngày sự cố', () => {
    expect(soNgayGhiTre('2026-10-01', '2026-10-09T00:00:00Z')).toBe(8);
  });
});
