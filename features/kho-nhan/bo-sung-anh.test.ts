import { describe, expect, it } from 'vitest';
import { dongDuocGan, kiemFile, oDinhKem, type DongKho } from './bo-sung-anh';

const d = (p: Partial<DongKho>): DongKho => ({
  recordId: 'r1', ngayImport: '2026-09-29', orderNumber: '#MBLVD1',
  coAnhHangDen: false, coBbBanGiao: false, ...p,
});

describe('dongDuocGan', () => {
  it('gắn cho MỌI dòng cùng đơn cùng ngày còn thiếu', () => {
    const ds = [d({ recordId: 'a' }), d({ recordId: 'b' }), d({ recordId: 'c' })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual(['a', 'b', 'c']);
  });

  it('BỎ QUA dòng đã có file — máy không đè thứ đội kho đã đưa lên', () => {
    const ds = [d({ recordId: 'a' }), d({ recordId: 'b', coAnhHangDen: true }), d({ recordId: 'c' })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual(['a', 'c']);
  });

  it('KHÁC NGÀY thì không gắn — một đơn về nhiều đợt, ảnh đợt này không phải đợt kia', () => {
    const ds = [d({ recordId: 'a' }), d({ recordId: 'b', ngayImport: '2026-09-28' })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual(['a']);
  });

  it('khác ĐƠN thì không gắn', () => {
    const ds = [d({ recordId: 'a' }), d({ recordId: 'b', orderNumber: '#MBLVD2' })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual(['a']);
  });

  it('hai loại file xét ĐỘC LẬP', () => {
    const ds = [d({ recordId: 'a', coAnhHangDen: true }), d({ recordId: 'b', coAnhHangDen: true })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual([]);
    expect(dongDuocGan(ds, ds[0]!, 'bb_ban_giao')).toEqual(['a', 'b']);
  });

  it('dòng gốc đã có file → không làm gì, kể cả khi dòng khác còn thiếu', () => {
    const ds = [d({ recordId: 'a', coAnhHangDen: true }), d({ recordId: 'b' })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual([]);
  });

  it('đơn TRỐNG mã → chỉ áp đúng dòng gốc', () => {
    const goc = d({ recordId: 'a', orderNumber: null });
    expect(dongDuocGan([goc, d({ recordId: 'b', orderNumber: null })], goc, 'hang_den')).toEqual(['a']);
  });

  it('khoảng trắng thừa trong mã đơn vẫn gom đúng', () => {
    const ds = [d({ recordId: 'a', orderNumber: '#MBLVD1 ' }), d({ recordId: 'b', orderNumber: ' #MBLVD1' })];
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual(['a', 'b']);
  });
});

describe('oDinhKem', () => {
  it('đúng dạng API bitable nhận', () => {
    expect(oDinhKem(['t1', 't2'])).toEqual([{ file_token: 't1' }, { file_token: 't2' }]);
  });
  it('rỗng → mảng rỗng, không phải null', () => expect(oDinhKem([])).toEqual([]));
});

describe('kiemFile', () => {
  it('ảnh và PDF thì nhận', () => {
    expect(kiemFile('a.jpg', 'image/jpeg', 1000)).toBeNull();
    expect(kiemFile('bb.pdf', 'application/pdf', 1000)).toBeNull();
  });
  it('kiểu lạ thì từ chối — không đẩy rác lên Drive của đội', () => {
    expect(kiemFile('a.exe', 'application/x-msdownload', 10)).toMatch(/chỉ nhận/);
  });
  it('quá nặng hoặc rỗng thì từ chối', () => {
    expect(kiemFile('a.jpg', 'image/jpeg', 21 * 1024 * 1024)).toMatch(/20MB/);
    expect(kiemFile('a.jpg', 'image/jpeg', 0)).toMatch(/rỗng/);
  });
});
