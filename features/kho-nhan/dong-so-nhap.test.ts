import { describe, it, expect } from 'vitest';
import { tachTenBienThe, nhomQc, nhomKho, danhDauNoiTiep, tenBrand } from './dong-so-nhap';

describe('tachTenBienThe', () => {
  it('tách ở dấu gạch có khoảng trắng hai bên', () => {
    expect(tachTenBienThe('Sofia Applique Midi Dress - Ivory / M'))
      .toEqual({ ten: 'Sofia Applique Midi Dress', bienThe: 'Ivory / M' });
  });

  /* Tên sản phẩm rất hay chứa gạch nối. Cắt ở dấu ĐẦU TIÊN là xé mất nửa tên. */
  it('cắt ở dấu CUỐI CÙNG, không phải dấu đầu tiên', () => {
    expect(tachTenBienThe('Ember Couture - Dual Style - Nude / L'))
      .toEqual({ ten: 'Ember Couture - Dual Style', bienThe: 'Nude / L' });
  });

  it('không có gạch thì cả câu là tên', () => {
    expect(tachTenBienThe('Eiren Lace Maxi Dress'))
      .toEqual({ ten: 'Eiren Lace Maxi Dress', bienThe: null });
  });

  /* Đuôi dài bất thường là một phần của tên chứ không phải biến thể. */
  it('đuôi quá dài thì giữ nguyên cả câu', () => {
    const dai = 'Áo dài - ' + 'x'.repeat(50);
    expect(tachTenBienThe(dai).bienThe).toBeNull();
  });

  it('rỗng hoặc null → tên rỗng', () => {
    expect(tachTenBienThe(null)).toEqual({ ten: '', bienThe: null });
    expect(tachTenBienThe('   ')).toEqual({ ten: '', bienThe: null });
  });
});

describe('nhomQc', () => {
  it('khớp nguyên văn bốn lựa chọn của Lark', () => {
    expect(nhomQc('QC Pass')).toBe('dat');
    expect(nhomQc('QC Failed')).toBe('hong');
    expect(nhomQc('Tiếp nhận - chưa QC')).toBe('cho');
    expect(nhomQc('Gửi dư')).toBe('du');
  });
  it('giá trị lạ hoặc rỗng → khác, không ném', () => {
    expect(nhomQc(null)).toBe('khac');
    expect(nhomQc('gì đó')).toBe('khac');
  });
});

describe('nhomKho', () => {
  /* " Chờ QC " trên Lark có dấu cách hai đầu — so bằng là trượt sạch. */
  it('nhận diện được " Chờ QC " kèm dấu cách thừa', () => {
    expect(nhomKho(' Chờ QC ')).toBe('cho');
  });
  it('so theo TỪ KHOÁ nên bắt được cả các lựa chọn dài', () => {
    expect(nhomKho('Tạm nhập (đi đơn)')).toBe('tam');
    expect(nhomKho('Gửi trả Vendor (QC fail)')).toBe('tra');
    expect(nhomKho('Hoàn trả brand (return)')).toBe('tra');
    expect(nhomKho('Nhập lại kho')).toBe('luu');
  });
  it('rỗng → khác', () => expect(nhomKho(null)).toBe('khac'));
});

describe('danhDauNoiTiep', () => {
  const d = (orderNumber: string | null) => ({ orderNumber });
  it('dòng thứ hai cùng đơn là nối tiếp', () => {
    const r = danhDauNoiTiep([d('#A'), d('#A'), d('#B')]);
    expect(r.map((x) => x.noiTiep)).toEqual([false, true, false]);
  });

  /* Chỉ tính dòng LIỀN KỀ — hai dòng cùng đơn nhưng cách nhau thì dòng sau vẫn
   * phải hiện mã đơn, nếu không người đọc tưởng nó thuộc đơn ở giữa. */
  it('cùng đơn nhưng KHÔNG liền kề thì không gộp', () => {
    const r = danhDauNoiTiep([d('#A'), d('#B'), d('#A')]);
    expect(r.map((x) => x.noiTiep)).toEqual([false, false, false]);
  });

  it('mã đơn rỗng không bao giờ gộp', () => {
    const r = danhDauNoiTiep([d(null), d(null)]);
    expect(r.map((x) => x.noiTiep)).toEqual([false, false]);
  });
});

describe('tenBrand', () => {
  it('có Vendor final thì dùng, không suy ra', () => {
    expect(tenBrand('DeNio', 'Denio-DN0824-M-BLA')).toEqual({ ten: 'DeNio', suyRa: false });
  });

  /* Vendor final chỉ điền 57% số dòng; tiền tố SKU phủ 96% và ứng 1:1 brand. */
  it('thiếu Vendor final thì suy ra từ tiền tố SKU', () => {
    expect(tenBrand(null, 'Denio-DN0824-M-BLA')).toEqual({ ten: 'Denio', suyRa: true });
    expect(tenBrand('  ', 'HappyClothing-VDN0082-S-BEI')).toEqual({ ten: 'HappyClothing', suyRa: true });
  });

  /* Tiền tố một ký tự hoặc toàn số không phải tên brand — thà để trống còn hơn
   * hiện "4" ở cột Brand. */
  it('tiền tố không ra tên brand thì trả null', () => {
    expect(tenBrand(null, '4951793-S-VAC')).toBeNull();
    expect(tenBrand(null, 'A-B-C')).toBeNull();
    expect(tenBrand(null, null)).toBeNull();
    expect(tenBrand(null, '   ')).toBeNull();
  });

  it('SKU không có gạch thì cả chuỗi là tiền tố', () => {
    expect(tenBrand(null, 'KALISA')).toEqual({ ten: 'KALISA', suyRa: true });
  });
});
