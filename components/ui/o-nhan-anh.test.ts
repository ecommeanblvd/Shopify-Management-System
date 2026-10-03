import { describe, it, expect } from 'vitest';
import { chonOTrong, xuLyDan, type ONhanAnhDaGan } from './o-nhan-anh';

const o = (thuTu: number, coFile = false, disabled = false): ONhanAnhDaGan => ({ thuTu, coFile, disabled });

describe('chonOTrong — dán ảnh khi không bấm vào ô nào', () => {
  it('một ô trống thì nhận', () => {
    expect(chonOTrong([o(0)])).toBe(0);
  });

  /* Khối lỗi QC bày nhiều ô cùng lúc, mỗi chỗ lỗi một ô. Ảnh phải vào ô trống ĐẦU TIÊN theo
     thứ tự trên màn hình, không phải ô cuối. */
  it('nhiều ô trống thì vào ô đầu tiên trên màn hình', () => {
    expect(chonOTrong([o(2), o(0), o(1)])).toBe(1);
  });

  it('ô đầu đã có ảnh thì xuống ô trống kế tiếp', () => {
    expect(chonOTrong([o(0, true), o(1), o(2)])).toBe(1);
  });

  /* KHÔNG BAO GIỜ đè ô đã có ảnh. Đè lên tấm vừa dán là làm mất bằng chứng mà không ai thấy —
     đúng loại lỗi đã xảy ra với chiếc WH-2610-00042 ngày 03/10/2026. */
  it('mọi ô đều đã có ảnh → không ô nào nhận', () => {
    expect(chonOTrong([o(0, true), o(1, true)])).toBeNull();
  });

  it('ô đang khoá thì bỏ qua, kể cả khi nó trống và đứng đầu', () => {
    expect(chonOTrong([o(0, false, true), o(1)])).toBe(1);
    expect(chonOTrong([o(0, false, true)])).toBeNull();
  });

  it('không ô nào → null', () => {
    expect(chonOTrong([])).toBeNull();
  });
});

describe('xuLyDan — lượt dán ở cấp tài liệu', () => {
  const anh = (ten: string) => ({ type: 'image/png', name: ten } as File);
  const chu = { type: 'text/plain', name: 'a.txt' } as File;
  /** Phần tử giả: chỉ cần hai thứ `xuLyDan` dùng tới. `viTri` nhỏ hơn = đứng trước. */
  const el = (viTri: number) => ({
    isConnected: true,
    compareDocumentPosition: (k: unknown) => ((k as { __v: number }).__v > viTri ? 4 : 2),
    __v: viTri,
  }) as unknown as HTMLElement;
  const o = (viTri: number, coFile = false, disabled = false) => {
    const nhan: File[] = [];
    return { muc: { el: el(viTri), coFile: () => coFile, disabled, dat: (fs: File[]) => nhan.push(...fs) }, nhan };
  };
  const su = (files: File[]) => {
    let chan = false;
    return { e: { defaultPrevented: false, clipboardData: { files }, preventDefault: () => { chan = true; } }, daChan: () => chan };
  };

  it('ảnh vào ô trống đầu tiên và chặn hành vi mặc định', () => {
    const a = o(0), b = o(1);
    const s = su([anh('x.png')]);
    xuLyDan(s.e, [b.muc, a.muc]);
    expect(a.nhan).toHaveLength(1);
    expect(b.nhan).toHaveLength(0);
    expect(s.daChan()).toBe(true);
  });

  /* Dán CHỮ vào ô ghi chú không được bị cướp — đây là lý do chỉ nhận khi clipboard có ẢNH. */
  it('dán chữ thì không đụng tới ô ảnh nào', () => {
    const a = o(0);
    const s = su([chu]);
    xuLyDan(s.e, [a.muc]);
    expect(a.nhan).toHaveLength(0);
    expect(s.daChan()).toBe(false);
  });

  /* Ô đang có focus đã tự xử lý và gọi `preventDefault` — làm lần hai là dán vào hai ô. */
  it('đã có ô xử lý rồi thì bỏ qua', () => {
    const a = o(0);
    const s = su([anh('x.png')]);
    xuLyDan({ ...s.e, defaultPrevented: true }, [a.muc]);
    expect(a.nhan).toHaveLength(0);
  });

  it('ô đã rời khỏi trang thì không nhận', () => {
    const a = o(0);
    (a.muc.el as unknown as { isConnected: boolean }).isConnected = false;
    const s = su([anh('x.png')]);
    xuLyDan(s.e, [a.muc]);
    expect(a.nhan).toHaveLength(0);
  });

  it('mọi ô đã có ảnh → không đè, và KHÔNG chặn hành vi mặc định', () => {
    const a = o(0, true);
    const s = su([anh('x.png')]);
    xuLyDan(s.e, [a.muc]);
    expect(a.nhan).toHaveLength(0);
    expect(s.daChan()).toBe(false);
  });
});
