import { describe, expect, it } from 'vitest';
import {
  COT_LARK, CONG_THEM, dongDuocGan, gopToken, kiemFile, oDinhKem, tokenTuO, type DongKho,
} from './bo-sung-anh';

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

describe('ảnh lỗi QC — luật riêng (CEO 03/10/2026)', () => {
  /* Ảnh hàng đến áp cho cả đơn vì chụp chung một lô. Ảnh lỗi thì không: một chiếc xước vai
     không nói gì về chiếc cùng đơn khác size — rải ra cả đơn là vu lỗi cho chúng. */
  it('chỉ gắn vào ĐÚNG dòng được chụp, không rải ra cả đơn', () => {
    const ds = [d({ recordId: 'r1' }), d({ recordId: 'r2' }), d({ recordId: 'r3' })];
    expect(dongDuocGan(ds, ds[0]!, 'loi_qc')).toEqual(['r1']);
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual(['r1', 'r2', 'r3']);
  });

  /* 429/463 dòng QC Failed đã có ảnh người dán tay. Chặn khi ô có sẵn là khoá luôn việc bổ
     sung bằng chứng — nên ảnh lỗi CỘNG THÊM thay vì chỉ điền ô trống. */
  it('ô đã có ảnh vẫn cho thêm, khác hẳn hai loại kia', () => {
    expect(CONG_THEM.loi_qc).toBe(true);
    expect(CONG_THEM.hang_den).toBe(false);
    expect(CONG_THEM.bb_ban_giao).toBe(false);
    const ds = [d({ coAnhHangDen: true })];
    expect(dongDuocGan(ds, ds[0]!, 'loi_qc')).toEqual(['r1']);
    expect(dongDuocGan(ds, ds[0]!, 'hang_den')).toEqual([]);
  });

  it('ghi đúng tên cột đính kèm của Lark', () => {
    expect(COT_LARK.loi_qc).toBe('Ảnh chụp lỗi QC fail');
  });
});

describe('gopToken — chỗ DUY NHẤT có thể làm mất ảnh của người khác', () => {
  it('giữ nguyên token cũ, nối token mới vào sau', () => {
    expect(gopToken(['a'], ['b'])).toEqual(['a', 'b']);
  });

  it('token đã có thì không nhân đôi', () => {
    expect(gopToken(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('không bao giờ trả ít hơn token đang có', () => {
    for (const cu of [[], ['a'], ['a', 'b', 'c']]) {
      expect(gopToken(cu, []).length).toBeGreaterThanOrEqual(cu.length);
      expect(gopToken(cu, ['z'])).toEqual([...cu, 'z']);
    }
  });
});

describe('tokenTuO', () => {
  it('đọc token từ ô đính kèm Lark', () => {
    expect(tokenTuO([{ file_token: 'a', name: 'x.jpg' }, { file_token: 'b' }])).toEqual(['a', 'b']);
  });

  it('ô trống, null hay dạng lạ đều ra mảng rỗng — không nổ', () => {
    expect(tokenTuO(null)).toEqual([]);
    expect(tokenTuO(undefined)).toEqual([]);
    expect(tokenTuO('chuoi')).toEqual([]);
    expect(tokenTuO([{ name: 'thiếu token' }, null])).toEqual([]);
  });
});
