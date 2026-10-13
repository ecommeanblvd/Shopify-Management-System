/**
 * Đường ghi giá ước tính lên Lark, soi ở hai điểm mà chỉ test mức này nhìn thấy được:
 *
 *  1. **Lark TỪ CHỐI bản vá** → cảnh báo phải nêu MÃ LỖI Lark trả về và TÊN CỘT đã gửi.
 *     PUT của Lark là all-or-nothing: một cột bị đổi tên bên Lark chặn CẢ bản vá, kể cả những
 *     ô chẳng liên quan. Cảnh báo chỉ nói "ghi thất bại" thì người xử lý không có gì để truy —
 *     mà ô mới `Chiết khấu || API` (hai dấu gạch đứng) chính là cột dễ bị ai dọn bảng sửa tên
 *     nhất, nên đây là lưới an toàn của nó.
 *  2. **Số chiết khấu thật sự chảy tới Lark**: `patchGiaUocTinh` có test riêng, nhưng không có
 *     test nào chứng minh `GiaUocTinh.discount` đi hết đường từ nguồn giá ra lời gọi
 *     `updateLogRecordFields`. Một mắt nối bị bỏ quên ở giữa là ô vẫn trống mà mọi test đơn vị
 *     vẫn xanh.
 *
 * `@/db/client` tạo Pool lúc import nên phải mock — test này thuần, không chạm Postgres/Lark.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COT_CHI_PHI } from '@/features/lark/ghi-nguoc/cot';

/** Dòng `shipments` mà `ghiGiaUocTinhLenLark` đọc sau khi giành việc. */
const kien = { trackingNumber: 'T1', larkRecordId: 'rec1' };
/** Dấu `gia_uoc_tinh_ghi_luc` mà lệnh giành việc ghi được (rỗng = đã có người khác giành). */
let giuDuoc: Array<{ id: string }> = [{ id: 's1' }];
/** Mọi giá trị đã `set()` lên `shipments`, để phân biệt lượt GIÀNH với lượt NHẢ việc. */
const daSet: Array<Record<string, unknown>> = [];

vi.mock('@/db/client', () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => {
        daSet.push(v);
        /* `.where()` phải VỪA await được (nhánh nhả việc) VỪA có `.returning()` (nhánh giành
         * việc) — đúng hai cách Drizzle được dùng trong tệp đang test. */
        return { where: () => Object.assign(Promise.resolve(giuDuoc), { returning: () => Promise.resolve(giuDuoc) }) };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([kien]) }) }) }),
  },
  schema: { shipments: { id: 'id', giaUocTinhGhiLuc: 'gia_uoc_tinh_ghi_luc', trackingNumber: 'tracking_number', larkRecordId: 'lark_record_id' } },
}));

vi.mock('./lay-gia-uoc-tinh', () => ({ layGiaUocTinh: vi.fn() }));
vi.mock('@/features/lark/client', () => ({ getLogRecordById: vi.fn(), updateLogRecordFields: vi.fn() }));

import { ghiGiaUocTinhLenLark } from './ghi-gia-uoc-tinh-len-lark';
import { layGiaUocTinh } from './lay-gia-uoc-tinh';
import { getLogRecordById, updateLogRecordFields } from '@/features/lark/client';

/** Giá ước tính FedEx có chiết khấu, dạng `tuFedexQuote` trả về. */
const gia = {
  nguon: 'fedex-api' as const, base: 9_512_300, discount: 7_657_402, fuel: 500_000,
  remote: null, demand: null, signature: null, residential: null, importHandling: null,
  /* Ba ô mới của 14/10/2026: với FedEx cả ba đều `null`. `Phí xử lý quốc tế` là khoản `FIP`
   * riêng của UPS; `ADDITIONAL_HANDLING` và `ADDRESS_CORRECTION` đếm được 0/1.310 phản hồi
   * Rate API thô ⇒ nguồn không nói gì. */
  internationalProcessing: null, additionalHandling: null, addressCorrection: null,
  /* FedEx không có khoản GoGreen nào (chỉ DHL có) ⇒ `null` = nguồn không nói gì. */
  gogreen: null,
  vat: 100_000, total: 3_026_880, maLa: [],
};

beforeEach(() => {
  vi.mocked(layGiaUocTinh).mockReset().mockResolvedValue(gia);
  vi.mocked(getLogRecordById).mockReset().mockResolvedValue({ record_id: 'rec1', fields: {} } as never);
  vi.mocked(updateLogRecordFields).mockReset().mockResolvedValue(undefined);
  giuDuoc = [{ id: 's1' }];
  daSet.length = 0;
});

describe('ghiGiaUocTinhLenLark', () => {
  /* Hình lỗi thật của `features/lark/client.ts` (`putRecord`): `[lark] update fail: code=… msg=…`.
   * 1254045 / FieldNameNotFound là đúng mã Lark trả khi một tên cột trong bản vá không tồn tại —
   * ca xảy ra nếu ai sửa `Chiết khấu || API` thành một dấu gạch. */
  it('Lark từ chối bản vá → cảnh báo nêu MÃ LỖI và TÊN CỘT đã gửi', async () => {
    vi.mocked(updateLogRecordFields).mockRejectedValue(
      new Error('[lark] update fail: code=1254045 msg=FieldNameNotFound'),
    );

    const r = await ghiGiaUocTinhLenLark('s1');

    expect(r.giaDaGhi).toBe(false);
    expect(r.canhBao).toContain('code=1254045');
    expect(r.canhBao).toContain('FieldNameNotFound');
    // Tên cột: không có nó thì không biết cột nào bị đổi tên mà vào Lark sửa.
    expect(r.canhBao).toContain(COT_CHI_PHI.discountApi);
    expect(r.canhBao).toContain(COT_CHI_PHI.base);
  });

  /* Thất bại ở Lark là ca CÒN THỬ LẠI ĐƯỢC (có thể chỉ là mạng) nên phải nhả dấu, không thì
   * cron bỏ qua kiện này mãi mãi và chẳng ai ghi được giá cho nó nữa. */
  it('Lark từ chối → nhả dấu để cron còn thử lại', async () => {
    vi.mocked(updateLogRecordFields).mockRejectedValue(new Error('[lark] update fail: code=1254045 msg=FieldNameNotFound'));
    await ghiGiaUocTinhLenLark('s1');
    expect(daSet.at(-1)).toEqual({ giaUocTinhGhiLuc: null });
  });

  /* Mắt nối cuối: số chiết khấu phải tới được ô Lark, DƯƠNG và đã làm tròn. */
  it('ghi được → bản vá mang ô "Chiết khấu || API" với số chiết khấu dương', async () => {
    const r = await ghiGiaUocTinhLenLark('s1');

    expect(r.giaDaGhi).toBe(true);
    const patch = vi.mocked(updateLogRecordFields).mock.calls[0]![1];
    expect(patch[COT_CHI_PHI.discountApi]).toBe(7_657_402);
    // Và base là giá GỐC (> tổng ở kiện chiết khấu sâu) — D-245 bản 2.
    expect(patch[COT_CHI_PHI.base]).toBe(9_512_300);
  });

  /* Nguồn không nói gì về chiết khấu (UPS) ⇒ ô phải VẮNG khỏi bản vá, không phải bằng 0: ghi 0
   * là khoá ô ở 0 vĩnh viễn, số thật sau này không vào được nữa. */
  it('chiết khấu null (UPS) → ô đó KHÔNG có mặt trong bản vá', async () => {
    vi.mocked(layGiaUocTinh).mockResolvedValue({ ...gia, nguon: 'ups-api', discount: null });
    await ghiGiaUocTinhLenLark('s1');
    const patch = vi.mocked(updateLogRecordFields).mock.calls[0]![1];
    expect(COT_CHI_PHI.discountApi in patch).toBe(false);
  });
});
