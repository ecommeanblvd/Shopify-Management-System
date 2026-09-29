import { describe, it, expect } from 'vitest';
import { LY_DO_CHAM, demTheoLyDo, layLyDo, loaiTruKhoiKpi, duyetTayDuoc, lyDoCoHieuLuc } from './ly-do-cham';

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
  it('thiếu giấy tờ thông quan — cả đầu nhập lẫn đầu xuất — là lỗi nội bộ, không được loại (CEO 16/09/2026)', () => {
    expect(loaiTruKhoiKpi('thong_quan_thieu_ct_nhap')).toBe(false);
    expect(loaiTruKhoiKpi('thong_quan_thieu_ct_xuat')).toBe(false);
    expect(layLyDo('thong_quan_thieu_ct_nhap')?.thuocVe).toBe('noi_bo');
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

describe('duyệt tay — chỉ mở đúng chỗ máy mù (CEO 29/09/2026)', () => {
  it('máy KHÔNG KIỂM ĐƯỢC thì admin duyệt được', () => {
    // Đúng 4 kiện Aramex tháng 8: "Chưa có nguồn đối chiếu cho hãng aramex".
    expect(duyetTayDuoc('khach_khong_lien_he', 'khong_kiem_duoc')).toBe(true);
    expect(duyetTayDuoc('sai_dia_chi_khach', 'khong_kiem_duoc')).toBe(true);
  });

  it('hãng KHÔNG THẤY dấu hiệu → KHÔNG cho duyệt: bằng chứng ngược thì người không được nói khác', () => {
    expect(duyetTayDuoc('khach_khong_lien_he', 'khong_thay')).toBe(false);
    expect(lyDoCoHieuLuc('khach_khong_lien_he', 'khong_thay', 'duyet')).toBe(false);
  });

  it('chưa đối chiếu xong → phải đợi, không duyệt trước', () => {
    expect(duyetTayDuoc('khach_khong_lien_he', null)).toBe(false);
    expect(lyDoCoHieuLuc('khach_khong_lien_he', null, 'duyet')).toBe(false);
  });

  it('lý do KHÔNG thuộc nhóm loại trừ thì duyệt cũng vô nghĩa', () => {
    // 20 kiện "hãng giao chậm chưa rõ nguyên nhân" tháng 8 phải ở lại mẫu số.
    expect(duyetTayDuoc('hang_cham_khong_ro', 'khong_kiem_duoc')).toBe(false);
    expect(lyDoCoHieuLuc('hang_cham_khong_ro', 'khong_kiem_duoc', 'duyet')).toBe(false);
    expect(duyetTayDuoc('thong_quan_thieu_ct_nhap', 'khong_kiem_duoc')).toBe(false);
  });

  it('admin TỪ CHỐI thì kiện vẫn tính vào KPI', () => {
    expect(lyDoCoHieuLuc('khach_khong_lien_he', 'khong_kiem_duoc', 'tu_choi')).toBe(false);
  });

  it('duyệt rồi thì kiện rời mẫu số', () => {
    expect(lyDoCoHieuLuc('khach_khong_lien_he', 'khong_kiem_duoc', 'duyet')).toBe(true);
  });

  it('bỏ trống tham số duyệt → hành vi y như trước 29/09', () => {
    expect(lyDoCoHieuLuc('khach_khong_lien_he', 'xac_nhan')).toBe(true);
    expect(lyDoCoHieuLuc('khach_khong_lien_he', 'khong_kiem_duoc')).toBe(false);
    expect(lyDoCoHieuLuc('khach_khong_lien_he', 'khong_thay')).toBe(false);
  });
});
