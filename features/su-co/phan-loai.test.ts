import { describe, it, expect } from 'vitest';
import {
  NGUYEN_NHAN, LOAI_CHI_PHI, donTienTo, nguyenNhanHopLe, nhanNguyenNhan,
  mapNguyenNhanLark, loaiChiPhiHopLe, nhanLoaiChiPhi, mapBoPhanLark,
  mapGiaiDoanLark, mapTrangThaiLark, maSuCo,
} from './phan-loai';

describe('donTienTo — rác thật của Lark, không phải phòng xa', () => {
  it('bỏ tiền tố (n) mà Lark để lẫn vào tên lựa chọn', () => {
    // Chính tiền tố này tách delayed_delivery thành 17 ca + 1 ca trên bảng gốc.
    expect(donTienTo('(2) sold_out')).toBe('sold_out');
    expect(donTienTo('(3) delayed_delivery')).toBe('delayed_delivery');
    expect(donTienTo('(2) delayed_delivery')).toBe('delayed_delivery');
    expect(donTienTo('(3) tax_issue')).toBe('tax_issue');
  });

  it('không có tiền tố thì giữ nguyên', () => {
    expect(donTienTo('sold_out')).toBe('sold_out');
    expect(donTienTo('  wrong_item  ')).toBe('wrong_item');
  });

  it('không cắt dấu ngoặc không phải tiền tố số', () => {
    expect(donTienTo('(abc) sold_out')).toBe('(abc) sold_out');
  });
});

describe('nguyên nhân', () => {
  it('19 nguyên nhân, không mã nào trùng', () => {
    expect(NGUYEN_NHAN).toHaveLength(19);
    expect(new Set(NGUYEN_NHAN.map((n) => n.ma)).size).toBe(19);
  });

  it('nhận mã đúng, từ chối mã lạ', () => {
    expect(nguyenNhanHopLe('sold_out')).toBe(true);
    expect(nguyenNhanHopLe('(2) sold_out')).toBe(false);
    expect(nguyenNhanHopLe('')).toBe(false);
  });

  it('map từ Lark đi qua donTienTo nên hai cách viết về cùng một mã', () => {
    expect(mapNguyenNhanLark('(2) delayed_delivery')).toBe('delayed_delivery');
    expect(mapNguyenNhanLark('(3) delayed_delivery')).toBe('delayed_delivery');
    expect(mapNguyenNhanLark('SOLD_OUT')).toBe('sold_out');
  });

  it('nguyên nhân lạ trả null để nơi gọi tự quyết, không ép về "khác"', () => {
    expect(mapNguyenNhanLark('nguyen_nhan_moi')).toBeNull();
    expect(mapNguyenNhanLark('')).toBeNull();
    expect(mapNguyenNhanLark(null)).toBeNull();
  });

  it('nhãn không nổ với mã lạ', () => {
    expect(nhanNguyenNhan('sold_out')).toBe('Hết hàng');
    expect(nhanNguyenNhan('la')).toBe('la');
    expect(nhanNguyenNhan(null)).toBe('—');
  });
});

describe('loại chi phí', () => {
  it('8 loại, KHÔNG có "mã giảm giá" — 87 ca Lark khai nó nhưng đó là mã, không phải tiền', () => {
    expect(LOAI_CHI_PHI).toHaveLength(8);
    expect(LOAI_CHI_PHI.map((l) => l.ma)).not.toContain('discount_code');
    expect(loaiChiPhiHopLe('hoan_bank')).toBe(true);
    expect(loaiChiPhiHopLe('discount_code')).toBe(false);
  });

  it('nhãn đọc được', () => {
    expect(nhanLoaiChiPhi('hoan_bank')).toBe('Hoàn qua ngân hàng');
    expect(nhanLoaiChiPhi(null)).toBe('—');
  });
});

describe('mapBoPhanLark — hai bảng Lark gọi tên khác nhau cho cùng bộ phận', () => {
  it('dịch tên của bảng sự cố về mã dùng chung', () => {
    expect(mapBoPhanLark('Warehouse')).toBe('DISCO-WH');
    expect(mapBoPhanLark('Logistic')).toBe('DISCO-LOG');
    expect(mapBoPhanLark('Procurement')).toBe('PROCUREMENT');
    expect(mapBoPhanLark('Merchandise')).toBe('MERCHANDISE');
    expect(mapBoPhanLark('CX - CS')).toBe('CX-CS');
    expect(mapBoPhanLark('Product Portfolio')).toBe('PRODUCT-PORTFOLIO');
  });

  it('nhận luôn mã đã chuẩn, không phải khai hai chiều', () => {
    expect(mapBoPhanLark('DISCO-WH')).toBe('DISCO-WH');
    expect(mapBoPhanLark('CX-CS')).toBe('CX-CS');
  });

  it('trống hoặc lạ trả null — kể cả giá trị tiền bị lọt vào danh sách của Lark', () => {
    expect(mapBoPhanLark('')).toBeNull();
    expect(mapBoPhanLark(null)).toBeNull();
    expect(mapBoPhanLark('$537.67')).toBeNull();
    expect(mapBoPhanLark('-$0.05')).toBeNull();
  });
});

describe('mapGiaiDoanLark', () => {
  it('ba giai đoạn của Lark', () => {
    expect(mapGiaiDoanLark('Pre - Purchase')).toBe('truoc_mua');
    expect(mapGiaiDoanLark('Purchase')).toBe('mua');
    expect(mapGiaiDoanLark('Post - Purchase')).toBe('sau_mua');
  });
  it('trống trả null', () => {
    expect(mapGiaiDoanLark('')).toBeNull();
    expect(mapGiaiDoanLark(null)).toBeNull();
  });
});

describe('mapTrangThaiLark', () => {
  it('dịch ba giá trị của Lark', () => {
    expect(mapTrangThaiLark('Resolved')).toBe('xong');
    expect(mapTrangThaiLark('In Progress')).toBe('dang_xu_ly');
    expect(mapTrangThaiLark('Open')).toBe('mo');
  });

  it('TRỐNG thành "mo" chứ không phải "xong" — 58/156 dòng Lark để trống', () => {
    // Coi trống là xong là âm thầm đóng 37% hồ sơ chưa ai xử lý.
    expect(mapTrangThaiLark('')).toBe('mo');
    expect(mapTrangThaiLark(null)).toBe('mo');
    expect(mapTrangThaiLark(undefined)).toBe('mo');
  });
});

describe('maSuCo', () => {
  it('đệm 4 chữ số, quá 9999 thì dài ra', () => {
    expect(maSuCo(1)).toBe('SC-0001');
    expect(maSuCo(157)).toBe('SC-0157');
    expect(maSuCo(12345)).toBe('SC-12345');
  });
});
