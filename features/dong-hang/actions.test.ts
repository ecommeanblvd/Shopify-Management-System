/**
 * Soi hai luật AN TOÀN của `luuBox`/`anBox` mà không test nào trong repo bắt được hôm nay:
 * xoá dòng `suaTay: true` khỏi `luuBox`, hoặc xoá hẳn `loaiHopLe`, mọi test khác (kể cả
 * `kiemBox`) vẫn xanh — vì cả hai không phải luật kiểm dữ liệu, mà là luật GHI.
 *
 *  1. **Khoá bản-sửa-tay-thắng** (CEO 14/10/2026, spec §3b.3): `luuBox` PHẢI luôn gửi
 *     `suaTay: true` cho CẢ hai đường ghi (tạo mới qua `insert` và sửa qua `update`) — đây là
 *     cái khoá để lượt kéo Lark sau không ghi đè số đo người ta vừa đo tay.
 *  2. **Chặn `loai` lạ TẠI BIÊN**: cột `box_dong_goi.loai` là `text` thuần, không CHECK — một
 *     giá trị ngoài `thung|tui|khac` ghi lọt sẽ biến mất khỏi lưới `ChonBox` (chia khối cứng
 *     theo đúng ba chữ đó) mà không một lời báo. Phải chặn TRƯỚC khi chạm DB, không phải sau.
 *
 * Cũng soi luôn mốc quyền `manage_fulfillment` — cùng mức `ghiDongThung` đã có.
 *
 * `@/db/client` tạo Pool lúc import nên phải mock (cùng lý do với
 * `ghi-gia-uoc-tinh-len-lark.test.ts`); `@/lib/auth/*` và `next/headers`/`next/cache` cũng
 * mock để test thuần, không cần session/DB/Next request thật.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Tên đã có trong `box_dong_goi` — rỗng = không box nào trùng tên hôm nay. */
let existingNames: Array<{ id: string; ten: string }> = [];
/** Mọi payload đã gửi cho `.update(...).set(...)`, theo đúng thứ tự gọi. */
const updateSets: Array<Record<string, unknown>> = [];
/** Mọi payload đã gửi cho `.insert(...).values(...)`. */
const insertValues: Array<Record<string, unknown>> = [];
let updateReturning: Array<{ id: string }> = [{ id: 'box-1' }];
let selectCalls = 0;
let insertCalls = 0;
let updateCalls = 0;

vi.mock('@/db/client', () => ({
  db: {
    select: () => {
      selectCalls++;
      return { from: () => Promise.resolve(existingNames) };
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updateCalls++;
        updateSets.push(v);
        return { where: () => ({ returning: () => Promise.resolve(updateReturning) }) };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertCalls++;
        insertValues.push(v);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  },
  schema: {
    boxDongGoi: {
      id: 'id', ten: 'ten', ma: 'ma', loai: 'loai',
      daiCm: 'dai_cm', rongCm: 'rong_cm', caoCm: 'cao_cm',
      suaTay: 'sua_tay', an: 'an', capNhatLuc: 'cap_nhat_luc', nguoiSua: 'nguoi_sua',
    },
    // Dùng bởi `ghiDongThung` — chỉ cần có mặt để `eq(schema.shipments.id, …)` dựng được
    // biểu thức, mock `update` phía trên bỏ qua bảng thật, không đọc cột này lúc chạy.
    shipments: {
      id: 'id', smsHop: 'sms_hop', smsWeightKg: 'sms_weight_kg',
      smsDimLengthCm: 'sms_dim_length_cm', smsDimWidthCm: 'sms_dim_width_cm', smsDimHeightCm: 'sms_dim_height_cm',
      smsPackedAt: 'sms_packed_at', smsPackedBy: 'sms_packed_by',
    },
  },
}));

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const getSessionMock = vi.fn();
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: (...a: unknown[]) => getSessionMock(...a) } } }));

const getRoleMock = vi.fn();
vi.mock('@/lib/auth/role', () => ({ getRole: (...a: unknown[]) => getRoleMock(...a) }));

const hasPermissionMock = vi.fn();
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => hasPermissionMock(...a) }));

/** `ghiDongThung` gọi hàm này NGOÀI transaction lưu, trong try/catch riêng (xem actions.ts) —
 *  mock để kiểm cả ba nhánh: thành công, báo cảnh báo, và NÉM lỗi (Lark sập giữa lượt lưu). */
const ghiCanDimLenLarkMock = vi.fn();
vi.mock('./ghi-can-dim-len-lark', () => ({ ghiCanDimLenLark: (...a: unknown[]) => ghiCanDimLenLarkMock(...a) }));

import { luuBox, anBox, ghiDongThung } from './actions';
import type { LoaiBox } from './danh-muc-box';

beforeEach(() => {
  existingNames = [];
  updateSets.length = 0;
  insertValues.length = 0;
  updateReturning = [{ id: 'box-1' }];
  selectCalls = 0; insertCalls = 0; updateCalls = 0;
  getSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } });
  getRoleMock.mockReset().mockResolvedValue('operator');
  hasPermissionMock.mockReset().mockReturnValue(true);
  ghiCanDimLenLarkMock.mockReset().mockResolvedValue({ daGhi: true });
});

const vao = (p: Partial<Parameters<typeof luuBox>[0]> = {}): Parameters<typeof luuBox>[0] => ({
  ten: 'Thùng Carton 5kg', ma: 'MEAN-CAR-40x25x25', loai: 'thung',
  daiCm: 40, rongCm: 25, caoCm: 25, ...p,
});

describe('luuBox — khoá bản-sửa-tay-thắng: PHẢI luôn gửi suaTay: true', () => {
  it('tạo MỚI (không id, đi đường insert) → payload mang sua_tay = true', async () => {
    const r = await luuBox(vao());
    expect(r.ok).toBe(true);
    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]!.suaTay).toBe(true);
  });

  it('SỬA (có id, đi đường update) → payload mang sua_tay = true', async () => {
    const r = await luuBox(vao({ id: 'box-1' }));
    expect(r.ok).toBe(true);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]!.suaTay).toBe(true);
  });
});

describe('luuBox — chặn `loai` lạ TẠI BIÊN, trước khi chạm DB', () => {
  it('loai ngoài thung|tui|khac → lỗi, KHÔNG select/insert/update', async () => {
    // `as never`: mô phỏng payload lạ đi qua wire của server action — chữ ký TS khai
    // `LoaiBox` không ngăn được request tay gửi một chuỗi khác lúc chạy.
    const r = await luuBox(vao({ loai: 'carton' as never }));
    expect(r.ok).toBe(false);
    expect(r.loi).toContain('Loại box không hợp lệ');
    expect(selectCalls).toBe(0);
    expect(insertCalls).toBe(0);
    expect(updateCalls).toBe(0);
  });

  it.each<LoaiBox>(['thung', 'tui', 'khac'])('loai hợp lệ "%s" → KHÔNG bị chặn ở bước này', async (loai) => {
    const r = await luuBox(vao({ loai }));
    expect(r.ok).toBe(true);
  });
});

describe('luuBox/anBox — gác manage_fulfillment, cùng mốc `ghiDongThung`', () => {
  it('không có quyền → luuBox từ chối, không chạm DB', async () => {
    hasPermissionMock.mockReturnValue(false);
    const r = await luuBox(vao());
    expect(r.ok).toBe(false);
    expect(selectCalls).toBe(0);
    expect(insertCalls).toBe(0);
    expect(updateCalls).toBe(0);
  });

  it('chưa đăng nhập → luuBox từ chối', async () => {
    getSessionMock.mockResolvedValue(null);
    const r = await luuBox(vao());
    expect(r.ok).toBe(false);
  });

  it('không có quyền → anBox từ chối, không chạm DB', async () => {
    hasPermissionMock.mockReturnValue(false);
    const r = await anBox('box-1', true);
    expect(r.ok).toBe(false);
    expect(updateCalls).toBe(0);
  });

  it('chưa đăng nhập → anBox từ chối', async () => {
    getSessionMock.mockResolvedValue(null);
    const r = await anBox('box-1', true);
    expect(r.ok).toBe(false);
  });
});

describe('luuBox — chặn `ma` rỗng TẠI BIÊN (reopening cùng hố đã đóng ở `kiemBox`)', () => {
  it('ma rỗng → lỗi, KHÔNG insert/update — không được để lọt một box không dùng được', async () => {
    const r = await luuBox(vao({ ma: '' }));
    expect(r.ok).toBe(false);
    expect(r.loi).toContain('Chưa nhập mã vật tư');
    expect(insertCalls).toBe(0);
    expect(updateCalls).toBe(0);
  });

  it('ma chỉ toàn khoảng trắng → cùng lỗi', async () => {
    const r = await luuBox(vao({ ma: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.loi).toContain('Chưa nhập mã vật tư');
  });

  it('ma hợp lệ → ghi đúng ma đã trim (qua `kiemBox`, không phải đọc tay từ `v.ma`)', async () => {
    const r = await luuBox(vao({ ma: '  MEAN-CAR-40x25x25  ' }));
    expect(r.ok).toBe(true);
    expect(insertValues[0]!.ma).toBe('MEAN-CAR-40x25x25');
  });
});

describe('luuBox — tự loại tên của chính box đang sửa trước khi kiểm trùng tên', () => {
  it('trùng tên với box KHÁC → lỗi', async () => {
    existingNames = [{ id: 'box-2', ten: 'Thùng Carton 5kg' }];
    const r = await luuBox(vao({ id: 'box-1' }));
    expect(r.ok).toBe(false);
    expect(r.loi).toContain('Tên box này đã có trong danh mục');
  });

  it('giữ nguyên tên của CHÍNH box đang sửa → KHÔNG bị báo trùng', async () => {
    existingNames = [{ id: 'box-1', ten: 'Thùng Carton 5kg' }];
    const r = await luuBox(vao({ id: 'box-1' }));
    expect(r.ok).toBe(true);
  });
});

/**
 * `ghiDongThung` — hàm LƯU + KIỂM QUYỀN + ĐẨY LARK của bước Đóng thùng (CEO 30/09/2026). Hôm
 * nay KHÔNG có test nào cho hàm này: xoá dòng gọi `ghiCanDimLenLark` khỏi `actions.ts` thì
 * toàn bộ 5.162 test khác vẫn xanh — "đẩy cân/kích thước lên Lark" chết ÂM THẦM. Khoá lại đúng
 * ba điều spec yêu cầu: quyền, có gọi Lark, và Lark lỗi không làm hỏng lượt lưu CSDL.
 */
const nhapDongThungHopLe = (p: Partial<Parameters<typeof ghiDongThung>[1]> = {}): Parameters<typeof ghiDongThung>[1] => ({
  hop: 'MEAN-BOX-30x25x20', canKg: '1.2', dai: '', rong: '', cao: '', ...p,
});

describe('ghiDongThung — gác manage_fulfillment, KHÔNG chạm DB nếu thiếu quyền', () => {
  it('không có quyền manage_fulfillment → {ok: false}, KHÔNG update DB', async () => {
    hasPermissionMock.mockReturnValue(false);
    const r = await ghiDongThung('ship-1', nhapDongThungHopLe());
    expect(r.ok).toBe(false);
    expect(updateCalls).toBe(0);
    expect(ghiCanDimLenLarkMock).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập → {ok: false}, KHÔNG chạm DB', async () => {
    getSessionMock.mockResolvedValue(null);
    const r = await ghiDongThung('ship-1', nhapDongThungHopLe());
    expect(r.ok).toBe(false);
    expect(updateCalls).toBe(0);
  });

  it('ô nhập sai (ví dụ thiếu cân) → {ok: false} kèm `loi`, KHÔNG chạm DB', async () => {
    const r = await ghiDongThung('ship-1', nhapDongThungHopLe({ canKg: '' }));
    expect(r.ok).toBe(false);
    expect(r.loi).toContain('Chưa cân cả kiện');
    expect(updateCalls).toBe(0);
  });
});

describe('ghiDongThung — lưu CSDL xong PHẢI gọi ghiCanDimLenLark (Task 9, spec §3b.3)', () => {
  it('lưu thành công → gọi ghiCanDimLenLark đúng shipmentId, trả ok:true không cảnh báo', async () => {
    ghiCanDimLenLarkMock.mockResolvedValue({ daGhi: true });
    const r = await ghiDongThung('ship-1', nhapDongThungHopLe());
    expect(r.ok).toBe(true);
    expect(updateCalls).toBe(1);
    expect(ghiCanDimLenLarkMock).toHaveBeenCalledTimes(1);
    expect(ghiCanDimLenLarkMock).toHaveBeenCalledWith('ship-1');
    expect(r.canhBaoLark).toBeUndefined();
  });

  it('ghiCanDimLenLark báo chưa ghi được (daGhi:false + canhBao) → ok:true, canhBaoLark mang lý do', async () => {
    ghiCanDimLenLarkMock.mockResolvedValue({ daGhi: false, canhBao: 'kiện chưa có dòng Lark tương ứng' });
    const r = await ghiDongThung('ship-1', nhapDongThungHopLe());
    expect(r.ok).toBe(true);
    expect(r.canhBaoLark).toBe('kiện chưa có dòng Lark tương ứng');
  });

  it('ghiCanDimLenLark NÉM lỗi (Lark sập) → đã lưu CSDL xong vẫn trả ok:true, kèm cảnh báo', async () => {
    // Đúng cái lỗ review nêu: người đóng hàng đang cầm kiện trên tay, Lark sập không được
    // làm mất lượt lưu cân/dim vào CSDL.
    ghiCanDimLenLarkMock.mockRejectedValue(new Error('Lark API 500'));
    const r = await ghiDongThung('ship-1', nhapDongThungHopLe());
    expect(r.ok).toBe(true);
    expect(updateCalls).toBe(1); // đã lưu CSDL TRƯỚC khi gọi Lark — không bị huỷ theo.
    expect(r.canhBaoLark).toContain('thất bại');
  });

  it('KHÔNG tìm thấy kiện (update trả về rỗng) → ok:false, KHÔNG gọi ghiCanDimLenLark', async () => {
    updateReturning = [];
    const r = await ghiDongThung('ship-khong-ton-tai', nhapDongThungHopLe());
    expect(r.ok).toBe(false);
    expect(ghiCanDimLenLarkMock).not.toHaveBeenCalled();
  });
});
