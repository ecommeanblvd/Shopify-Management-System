import { describe, it, expect } from 'vitest';
import { tachMaDon, maHienThi } from './ma-hien-thi';

describe('tachMaDon', () => {
  it('tách phần đầu dùng chung khỏi nhóm số cuối', () => {
    expect(tachMaDon('26-INSLG-SV-0954')).toEqual({ dau: '26-INSLG-SV-', duoi: '0954' });
  });
  it('mã không kết thúc bằng số thì đuôi rỗng, không mất chữ nào', () => {
    expect(tachMaDon('#KLS2073-A')).toEqual({ dau: '#KLS2073-A', duoi: '' });
  });
  it('bỏ khoảng trắng hai đầu', () => {
    expect(tachMaDon('  26-INSLG-SV-0145  ')).toEqual({ dau: '26-INSLG-SV-', duoi: '0145' });
  });
});

describe('maHienThi', () => {
  it('có mã LOG thì mã LOG đứng trước, mã hệ thống xuống phụ', () => {
    const r = maHienThi({ code: '26-INSLG-SV-0145', larkOrderNumber: '26-INSLG-SV-0954' });
    expect(r.chinh).toMatchObject({ ma: '26-INSLG-SV-0954', nhan: 'LOG', duoi: '0954' });
    expect(r.phu).toMatchObject({ ma: '26-INSLG-SV-0145', nhan: 'HT', duoi: '0145' });
    expect(r.thieuMaLog).toBe(false);
  });
  /* 3/183 đơn chưa có mã LOG (đo 12/10/2026) — hai trong đó đang `quoted`, chưa đi hàng
   * nên đội logistics chưa tạo dòng Lark. Không được để ô trống. */
  it('chưa có mã LOG thì mã hệ thống đứng trước và CÓ cờ báo thiếu', () => {
    const r = maHienThi({ code: '26-INSLG-SV-0076', larkOrderNumber: null });
    expect(r.chinh).toMatchObject({ ma: '26-INSLG-SV-0076', nhan: 'HT' });
    expect(r.phu).toBeNull();
    expect(r.thieuMaLog).toBe(true);
  });
  it('chuỗi rỗng/khoảng trắng coi như chưa có mã LOG', () => {
    expect(maHienThi({ code: '26-INSLG-SV-0076', larkOrderNumber: '   ' }).thieuMaLog).toBe(true);
  });
  it('hai mã bằng nhau thì KHÔNG hiện hai lần', () => {
    const r = maHienThi({ code: '26-INSLG-SV-0954', larkOrderNumber: '26-INSLG-SV-0954' });
    expect(r.chinh.nhan).toBe('LOG');
    expect(r.phu).toBeNull();
    expect(r.thieuMaLog).toBe(false);
  });
});

describe('maHienThi: cungDau quyết định ô phụ hiện đuôi hay hiện đủ', () => {
  it('cùng khuôn INSLG → chỉ cần đuôi', () => {
    expect(maHienThi({ code: '26-INSLG-SV-0145', larkOrderNumber: '26-INSLG-SV-0954' }).cungDau).toBe(true);
  });
  /* Đơn SMS tự sinh mang prefix INSMS (D-020). Cắt còn đuôi sẽ thành một mã không tồn tại. */
  it('khác khuôn (INSMS cạnh INSLG) → phải hiện đủ', () => {
    const r = maHienThi({ code: '26-INSMS-SV-0003', larkOrderNumber: '26-INSLG-SV-0954' });
    expect(r.cungDau).toBe(false);
    expect(r.phu?.ma).toBe('26-INSMS-SV-0003');
  });
});
