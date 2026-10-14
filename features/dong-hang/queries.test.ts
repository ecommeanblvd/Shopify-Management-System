/**
 * `docDanhMucBox` (nội bộ của queries.ts, dùng chung cho `danhSachBox`/`danhMucBoxQuanLy`) có
 * hai luật KHÔNG test nào trong repo bắt được hôm nay, vì cả hai không phải luật của hàm thuần
 * (`kiemBox`/`gomBox`/`tronBox` đã có test riêng) mà là luật GHÉP dữ liệu giữa kho Lark và
 * `box_dong_goi`:
 *
 *  1. **Lọc `ma` rỗng ở phía hệ thống** — cùng guard `isNotNull(dinh_danh)` mà phía kho đã có:
 *     một dòng `box_dong_goi` ghi từ TRƯỚC khi `kiemBox` chặn `ma` rỗng (hoặc một bản vá sau
 *     này lỡ bỏ chặn) vẫn phải KHÔNG lên lưới `ChonBox` — chọn nó thì ô "Thùng đã dùng" bị điền
 *     rỗng.
 *  2. **Reject đã sửa thì RỜI danh sách "chưa dùng được"** — một dòng kho `gomBox` loại vào
 *     `boLai` mà sau đó ai đó điền tay lưu vào `box_dong_goi` (nên đã lên được `tuSms`) phải
 *     biến mất khỏi `boLai` của `danhMucBoxQuanLy` — còn lại thì nó hiện ĐÚP (vừa ở "đã dùng
 *     được", vừa ở "chưa dùng được") và mục nhắc không bao giờ tắt.
 *
 * `@/db/client` tạo Pool lúc import nên phải mock (cùng lý do `actions.test.ts`). `docDanhMucBox`
 * gọi `db.select` đúng hai lần theo thứ tự cố định: (1) kho `lark_wh_inventory` — có `.where()`,
 * (2) `box_dong_goi` — KHÔNG `.where()`, đọc thẳng cả bảng. Mock phân biệt theo đúng thứ tự đó.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface WhRow { recordId: string; lineitemName: string | null; dinhDanh: string | null; kichThuoc: string | null }
interface SmsRow {
  id: string; ten: string; ma: string; loai: string;
  daiCm: string | null; rongCm: string | null; caoCm: string | null; suaTay: boolean; an: boolean;
}

let whRows: WhRow[] = [];
let smsRows: SmsRow[] = [];
let selectCalls = 0;

vi.mock('@/db/client', () => ({
  db: {
    select: () => {
      selectCalls++;
      // Lượt lẻ = truy vấn kho (có .where()); lượt chẵn = truy vấn box_dong_goi (không .where()).
      if (selectCalls % 2 === 1) return { from: () => ({ where: () => Promise.resolve(whRows) }) };
      return { from: () => Promise.resolve(smsRows) };
    },
  },
  schema: {
    larkWhInventory: {
      recordId: 'record_id', lineitemName: 'lineitem_name', dinhDanh: 'dinh_danh',
      kichThuoc: 'kich_thuoc', inventoryType: 'inventory_type',
    },
    boxDongGoi: {
      id: 'id', ten: 'ten', ma: 'ma', loai: 'loai',
      daiCm: 'dai_cm', rongCm: 'rong_cm', caoCm: 'cao_cm', suaTay: 'sua_tay', an: 'an',
    },
  },
}));

import { danhSachBox, danhMucBoxQuanLy } from './queries';

beforeEach(() => {
  whRows = [];
  smsRows = [];
  selectCalls = 0;
});

const smsRow = (p: Partial<SmsRow> = {}): SmsRow => ({
  id: 'x', ten: 'Thùng Carton 5kg', ma: 'MEAN-CAR-40x25x25', loai: 'thung',
  daiCm: '40', rongCm: '25', caoCm: '25', suaTay: false, an: false, ...p,
});

describe('docDanhMucBox (qua danhSachBox) — lọc box hệ thống ma rỗng', () => {
  it('dòng box_dong_goi ma rỗng → KHÔNG lên lưới ChonBox', async () => {
    smsRows = [smsRow({ ma: '' })];
    const r = await danhSachBox();
    expect(r).toHaveLength(0);
  });

  it('dòng box_dong_goi ma chỉ khoảng trắng → cùng bị lọc', async () => {
    smsRows = [smsRow({ ma: '   ' })];
    const r = await danhSachBox();
    expect(r).toHaveLength(0);
  });

  it('dòng box_dong_goi ma hợp lệ → vẫn lên lưới như cũ', async () => {
    smsRows = [smsRow({ ma: 'MEAN-CAR-40x25x25' })];
    const r = await danhSachBox();
    expect(r).toHaveLength(1);
    expect(r[0]!.ma).toBe('MEAN-CAR-40x25x25');
  });
});

describe('danhMucBoxQuanLy — reject đã sửa (có dòng box_dong_goi dùng được) phải RỜI boLai', () => {
  it('ten trong boLai đã có dòng box_dong_goi hợp lệ → biến mất khỏi boLai, lên box', async () => {
    // Dòng kho không đọc được kích thước — gomBox đẩy nó vào boLai.
    whRows = [{ recordId: 'r1', lineitemName: 'Hộp Lạ Chưa Đo', dinhDanh: 'X-1', kichThuoc: null }];
    // Ai đó đã điền tay và lưu — cùng TÊN với dòng kho trên.
    smsRows = [smsRow({ ten: 'Hộp Lạ Chưa Đo', ma: 'MEAN-LA-30x20x10', daiCm: '30', rongCm: '20', caoCm: '10' })];

    const r = await danhMucBoxQuanLy();

    expect(r.boLai).toHaveLength(0);
    expect(r.box).toHaveLength(1);
    expect(r.box[0]!.ten).toBe('Hộp Lạ Chưa Đo');
  });

  it('ten trong boLai CHƯA có dòng box_dong_goi nào → vẫn ở lại boLai', async () => {
    whRows = [{ recordId: 'r1', lineitemName: 'Hộp Lạ Chưa Đo', dinhDanh: 'X-1', kichThuoc: null }];
    smsRows = [];

    const r = await danhMucBoxQuanLy();

    expect(r.boLai).toHaveLength(1);
    expect(r.boLai[0]!.ten).toBe('Hộp Lạ Chưa Đo');
    expect(r.box).toHaveLength(0);
  });
});
