/**
 * Đường ghi cân/kích thước lên Lark, soi ở ba điểm mà chỉ test mức này nhìn thấy được (xem
 * `ghi-gia-uoc-tinh-len-lark.test.ts`, sinh ra vì cùng một lý do — "thuần" không chứng minh
 * được I/O đúng):
 *
 *  1. Kiện chưa có dòng Lark (`larkRecordId` null) không được ném lỗi — caller (`ghiDongThung`)
 *     gọi hàm này NGOÀI transaction, Lark/CSDL hỏng không được chặn việc lưu đóng thùng.
 *  2. Chuyển đổi kiểu `numeric` (Drizzle trả CHUỖI) → SỐ xảy ra NGOÀI `xemTruocGhiCanDim`
 *     (hàm đó thuần, nhận số sẵn) — nếu ai lỡ bỏ bước `so()` ở đây, cột cân nặng kiểu chuỗi
 *     `'2.4'` sẽ lọt tới `updateLogRecordFields`, Lark từ chối CẢ bản vá vì ô `Weights` là
 *     type Number. Không test đơn vị nào khác bắt được ca này.
 *  3. Đường BIÊN NHẬN đi hết từ CSDL (`o_lark_do_sms_ghi`) → `xemTruocGhiCanDim` → patch thật
 *     → ghi lại biên nhận MỚI — khớp hoặc không khớp Lark hiện tại.
 *
 * `@/db/client` tạo Pool lúc import nên phải mock — test này thuần, không chạm Postgres/Lark.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Dòng `shipments` mà `ghiCanDimLenLark` đọc — tên field khớp ALIAS trong câu `db.select({
 *  canKg: schema.shipments.smsWeightKg, … })` của hàm đang test, KHÔNG phải tên cột gốc:
 *  Drizzle trả hàng theo tên khoá truyền vào `select()`, không phải tên cột CSDL. */
let kien: {
  canKg: string | null; daiCm: string | null; rongCm: string | null;
  caoCm: string | null; larkRecordId: string | null; oLarkDoSmsGhi: unknown;
} = {
  canKg: '2.4', daiCm: '40', rongCm: '30', caoCm: '12',
  larkRecordId: 'rec1', oLarkDoSmsGhi: {},
};
/** Mọi giá trị đã `set()` lên `shipments` qua `db.update` — để kiểm biên nhận vừa ghi. */
const daSet: Array<Record<string, unknown>> = [];

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([kien]) }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        daSet.push(v);
        return { where: () => Promise.resolve([]) };
      },
    }),
  },
  schema: {
    shipments: {
      id: 'id', smsWeightKg: 'sms_weight_kg', smsDimLengthCm: 'sms_dim_length_cm',
      smsDimWidthCm: 'sms_dim_width_cm', smsDimHeightCm: 'sms_dim_height_cm',
      larkRecordId: 'lark_record_id', oLarkDoSmsGhi: 'o_lark_do_sms_ghi',
    },
  },
}));

vi.mock('@/features/lark/client', () => ({ getLogRecordById: vi.fn(), updateLogRecordFields: vi.fn() }));

import { ghiCanDimLenLark } from './ghi-can-dim-len-lark';
import { getLogRecordById, updateLogRecordFields } from '@/features/lark/client';

beforeEach(() => {
  kien = {
    canKg: '2.4', daiCm: '40', rongCm: '30', caoCm: '12',
    larkRecordId: 'rec1', oLarkDoSmsGhi: {},
  };
  vi.mocked(getLogRecordById).mockReset().mockResolvedValue({ record_id: 'rec1', fields: {} } as never);
  vi.mocked(updateLogRecordFields).mockReset().mockResolvedValue(undefined);
  daSet.length = 0;
});

describe('ghiCanDimLenLark', () => {
  it('kiện chưa có larkRecordId → { daGhi: false } kèm cảnh báo, không ném lỗi', async () => {
    kien.larkRecordId = null;

    const r = await ghiCanDimLenLark('s1');

    expect(r.daGhi).toBe(false);
    expect(r.canhBao).toBeTruthy();
    expect(updateLogRecordFields).not.toHaveBeenCalled();
  });

  it('ghi thành công → updateLogRecordFields nhận Weights là SỐ (không phải chuỗi cột numeric), và biên nhận được lưu cho cả hai cột', async () => {
    const r = await ghiCanDimLenLark('s1');

    expect(r.daGhi).toBe(true);
    const patch = vi.mocked(updateLogRecordFields).mock.calls[0]![1];
    expect(patch['Weights']).toBe(2.4);
    expect(typeof patch['Weights']).toBe('number'); // KHÔNG phải chuỗi '2.4' của cột numeric.
    expect(patch['Dimension ( điền tay)']).toBe('40x30x12');

    const bienNhanMoi = daSet.at(-1)!['oLarkDoSmsGhi'] as Record<string, unknown>;
    expect(bienNhanMoi).toEqual({ 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' });
  });

  it('đường biên nhận: Lark vẫn giữ đúng giá trị hệ thống từng ghi → được ghi lại (cân đã sửa)', async () => {
    kien.canKg = '2.1'; // cân lại — số mới khác biên nhận cũ
    kien.oLarkDoSmsGhi = { 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' };
    vi.mocked(getLogRecordById).mockResolvedValue({
      record_id: 'rec1', fields: { 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' },
    } as never);

    const r = await ghiCanDimLenLark('s1');

    expect(r.daGhi).toBe(true);
    expect(r.canhBao).toBeUndefined();
    const patch = vi.mocked(updateLogRecordFields).mock.calls[0]![1];
    expect(patch['Weights']).toBe(2.1);
  });

  it('ô Lark KHÔNG còn khớp biên nhận (người đã sửa tay) → bỏ qua, cảnh báo nêu tên cột, không gọi Lark', async () => {
    kien.daiCm = null; // cô lập: chỉ xét ô Weights trong ca này
    kien.rongCm = null;
    kien.oLarkDoSmsGhi = { 'Weights': 2.4 };
    vi.mocked(getLogRecordById).mockResolvedValue({ record_id: 'rec1', fields: { 'Weights': 3.0 } } as never);

    const r = await ghiCanDimLenLark('s1');

    expect(updateLogRecordFields).not.toHaveBeenCalled();
    expect(r.canhBao).toContain('Weights');
  });

  it('cột numeric hỏng (không đọc ra số) → ô đó bị bỏ, không gửi NaN lên Lark', async () => {
    kien.canKg = 'không phải số'; // numeric hỏng hiếm khi xảy ra, nhưng Number() ra NaN
    kien.daiCm = null; kien.rongCm = null; // cô lập: chỉ xét ô cân

    const r = await ghiCanDimLenLark('s1');

    expect(r.daGhi).toBe(true); // không có gì để ghi — không phải lỗi
    expect(updateLogRecordFields).not.toHaveBeenCalled();
  });
});
