import { describe, expect, it } from 'vitest';
import { CAU_HINH } from '@/features/nhat-ky/cot-theo-doi';
import type { KhoiNhatKy } from '@/features/nhat-ky/gom-dong';
import {
  BANG_MAC_DINH, CAC_BANG, docBang, docChu, docNgay, homNayVn, nguoiTrongKhoi, nhanBang, truongTrongKhoi,
} from './bo-loc';

describe('docBang', () => {
  it('tên bảng lạ từ URL không đi vào SQL — rơi về bảng mặc định', () => {
    expect(docBang('nhat_ky_thay_doi')).toBe(BANG_MAC_DINH);
    expect(docBang('user; drop table')).toBe(BANG_MAC_DINH);
    expect(docBang(undefined)).toBe(BANG_MAC_DINH);
    expect(docBang(['goods_receipts'])).toBe(BANG_MAC_DINH);
  });

  it('tên bảng có khai trong CAU_HINH thì giữ', () => {
    expect(docBang('ship_ho_orders')).toBe('ship_ho_orders');
  });
});

describe('CAC_BANG', () => {
  it('phủ đúng các bảng của CAU_HINH, không thừa không thiếu', () => {
    expect([...CAC_BANG].sort()).toEqual([...new Set(CAU_HINH.map((c) => c.bang))].sort());
  });

  it('bảng mặc định đứng đầu — mở trang ra phải rơi vào bảng có trigger đang sống', () => {
    expect(CAC_BANG[0]).toBe(BANG_MAC_DINH);
  });

  it('mọi bảng chọn được đều có nhãn tiếng Việt', () => {
    for (const b of CAC_BANG) expect(nhanBang(b)).not.toBe(b);
  });

  it('bảng chưa khai nhãn thì hiện chính tên bảng, không để trống', () => {
    expect(nhanBang('bang_la')).toBe('bang_la');
  });
});

describe('docNgay', () => {
  it('"từ ngày" là 00:00 GIỜ VIỆT NAM, không phải 00:00 UTC', () => {
    expect(docNgay('2026-10-20', 'dau')?.toISOString()).toBe('2026-10-19T17:00:00.000Z');
  });

  it('"đến ngày" khép hết ngày đó (nhatKyCuaBang dùng <=), không lấn sang ngày sau', () => {
    expect(docNgay('2026-10-20', 'cuoi')?.toISOString()).toBe('2026-10-20T16:59:59.999Z');
  });

  it('chuỗi không phải YYYY-MM-DD thì bỏ lọc, không ném lỗi', () => {
    expect(docNgay('20/10/2026', 'dau')).toBeUndefined();
    expect(docNgay('', 'dau')).toBeUndefined();
    expect(docNgay(undefined, 'cuoi')).toBeUndefined();
    expect(docNgay('2026-13-45', 'dau')).toBeUndefined();
  });
});

describe('docChu', () => {
  it('rỗng / toàn khoảng trắng nghĩa là KHÔNG lọc', () => {
    expect(docChu('')).toBeUndefined();
    expect(docChu('   ')).toBeUndefined();
    expect(docChu(undefined)).toBeUndefined();
  });
  it('cắt khoảng trắng hai đầu', () => expect(docChu('  u1 ')).toBe('u1'));
});

describe('homNayVn', () => {
  it('tối ở Việt Nam vẫn là ngày hôm đó, không nhảy về hôm trước theo UTC', () => {
    expect(homNayVn(new Date('2026-10-20T16:30:00Z'))).toBe('2026-10-20');
  });
});

const khoi = (p: Partial<KhoiNhatKy>): KhoiNhatKy => ({
  luc: new Date('2026-10-20T03:00:00Z'), tacNhanId: null, tacNhanNhan: 'Cron',
  banGhiId: 'r1', dong: [], ...p,
});
const dong = (truong: string, nhan: string) => ({ truong, nhan, truoc: null, sau: 'x', biChe: false });

describe('nguoiTrongKhoi', () => {
  it('mỗi người một lần, xếp theo tên tiếng Việt', () => {
    expect(nguoiTrongKhoi([
      khoi({ tacNhanId: 'u2', tacNhanNhan: 'Đức' }),
      khoi({ tacNhanId: 'u1', tacNhanNhan: 'An' }),
      khoi({ tacNhanId: 'u2', tacNhanNhan: 'Đức' }),
    ])).toEqual([{ gia: 'u1', nhan: 'An' }, { gia: 'u2', nhan: 'Đức' }]);
  });

  it('máy và dòng chưa gắn danh tính KHÔNG vào ô chọn — lọc theo id, mà chúng không có id', () => {
    expect(nguoiTrongKhoi([
      khoi({ tacNhanId: null, tacNhanNhan: 'Đồng bộ Lark' }),
      khoi({ tacNhanId: null, tacNhanNhan: 'Chưa gắn danh tính' }),
    ])).toEqual([]);
  });
});

describe('truongTrongKhoi', () => {
  it('giá trị là tên cột THẬT, nhãn là tiếng Việt, mỗi cột một lần', () => {
    expect(truongTrongKhoi([
      khoi({ dong: [dong('qc_result', 'Kết quả QC'), dong('location', 'Vị trí')] }),
      khoi({ dong: [dong('qc_result', 'Kết quả QC')] }),
    ])).toEqual([{ gia: 'qc_result', nhan: 'Kết quả QC' }, { gia: 'location', nhan: 'Vị trí' }]);
  });

  it('danh sách rỗng ra rỗng, không ném lỗi', () => expect(truongTrongKhoi([])).toEqual([]));
});
