import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUA_GAN_DANH_TINH } from '@/features/nhat-ky/gom-dong';
import {
  catGiaTri, chipGiaTri, chipThaoTac, CHE_HIEN, hienOThoiGian, kieuTacNhan,
  NULL_HIEN, TRAN_KY_TU,
} from './trinh-bay';

describe('kieuTacNhan', () => {
  it('có id người → người, dù nhãn là tên hay chính id', () => {
    expect(kieuTacNhan({ tacNhanId: 'u1', tacNhanNhan: 'Đức' })).toBe('nguoi');
    expect(kieuTacNhan({ tacNhanId: 'u1', tacNhanNhan: 'u1' })).toBe('nguoi');
  });

  it('không có id mà có nhãn máy → máy, KHÔNG phải người ẩn danh', () => {
    expect(kieuTacNhan({ tacNhanId: null, tacNhanNhan: 'Đồng bộ Lark' })).toBe('may');
    expect(kieuTacNhan({ tacNhanId: null, tacNhanNhan: 'Nhập file' })).toBe('may');
  });

  it('không có cả hai → chưa gắn danh tính (món nợ), KHÔNG gộp vào máy', () => {
    expect(kieuTacNhan({ tacNhanId: null, tacNhanNhan: CHUA_GAN_DANH_TINH })).toBe('chua-gan');
  });
});

describe('chipGiaTri', () => {
  it('cột dạng chọn ra nhãn tiếng Việt + màu', () => {
    expect(chipGiaTri('qc_result', 'pass')).toEqual({ nhan: 'Đạt', mau: expect.stringContaining('emerald') });
    expect(chipGiaTri('qc_result', 'fail')?.nhan).toBe('Không đạt');
    expect(chipGiaTri('stock_status', 'in_stock')?.nhan).toBe('Trong kho');
    expect(chipGiaTri('unplanned', 'true')?.nhan).toBe('Ngoài kế hoạch');
  });

  it('cột chữ/số tự do thì KHÔNG ra chip — hiện nguyên văn', () => {
    expect(chipGiaTri('location', 'Kệ 6-F')).toBeNull();
    expect(chipGiaTri('weight_kg', '1.250')).toBeNull();
  });

  it('nhánh enum MỚI của cột đã khai: vẫn ra chip, nhãn là nguyên văn — không bỏ trống', () => {
    const c = chipGiaTri('qc_result', 'nhanh_moi_chua_khai');
    expect(c?.nhan).toBe('nhanh_moi_chua_khai');
  });

  it('không tra theo prototype — tên cột/giá trị tới từ CSDL nên có thể là "constructor"', () => {
    expect(chipGiaTri('constructor', 'pass')).toBeNull();
    expect(chipGiaTri('qc_result', 'toString')?.nhan).toBe('toString');
  });

  it('red chỉ dành cho nghĩa "QC hỏng" — màu đã mang nghĩa, không ai mượn', () => {
    const doTrongChip = (['qc_result', 'disposition', 'stock_status', 'unplanned', 'source_type'] as const)
      .flatMap((cot) => ['pass', 'fail', 'pending', 'qc_failed', 'in_stock', 'staging', 'allocated', 'picked',
        'shipped', 'returned_to_vendor', 'allocate_to_order', 'store', 'return_to_brand', 'true', 'false',
        'retail_for_order', 'consignment', 'po']
        .map((v) => ({ cot, v, chip: chipGiaTri(cot, v) })))
      .filter((x) => x.chip?.mau.includes('red'));
    expect(doTrongChip.map((x) => `${x.cot}=${x.v}`).sort())
      .toEqual(['qc_result=fail', 'stock_status=qc_failed']);
  });

  it('class màu là CHUỖI LITERAL — Tailwind 4 quét source, class ghép lúc chạy mất CSS', () => {
    const src = readFileSync(new URL('./trinh-bay.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/`[^`]*\$\{[^}]*\}[^`]*(bg-|text-)/);
  });
});

describe('dấu hiện', () => {
  it('ô NULL và ô bị che là HAI dấu khác nhau — che im lặng là cái spec §7 cấm', () => {
    expect(NULL_HIEN).not.toBe(CHE_HIEN);
  });
});

describe('catGiaTri', () => {
  it('giá trị ngắn giữ nguyên', () => {
    expect(catGiaTri('pass')).toEqual({ hien: 'pass', daCat: false });
  });

  it('ô jsonb vài KB bị cắt — một dòng không được đẩy cả bảng dài bằng mấy trang', () => {
    const r = catGiaTri('x'.repeat(5_000));
    expect(r.daCat).toBe(true);
    expect(r.hien).toHaveLength(TRAN_KY_TU);
  });

  it('đúng trần thì CHƯA cắt (không gắn "…" vào thứ đã đủ)', () => {
    expect(catGiaTri('y'.repeat(TRAN_KY_TU)).daCat).toBe(false);
  });
});

// I1 — `thao_tac` được trigger ghi từ đầu nhưng tới lượt soát cuối thì KHÔNG AI ĐỌC.
describe('chipThaoTac', () => {
  it('xoá và thêm có chip — hai ca mà cột "Trước → Sau" đọc ra SAI nghĩa nếu không có', () => {
    expect(chipThaoTac('xoa')?.nhan).toBe('Xoá bản ghi');
    expect(chipThaoTac('them')?.nhan).toBe('Thêm mới');
  });

  it('SỬA không có chip — ca áp đảo, cột "Trước → Sau" đã tự nói', () => {
    expect(chipThaoTac('sua')).toBeNull();
  });

  it('khối lẫn nhiều loại nói ra là lẫn, không chọn bừa một nhãn', () => {
    expect(chipThaoTac('tron')?.nhan).toBe('Nhiều loại');
    expect(chipThaoTac('la')?.nhan).toBe('Thao tác lạ');
  });

  // `red` đã mang nghĩa "QC hỏng" ở `mau-nhan.ts`; chiếc nhận nhầm bị xoá không phải
  // chiếc lỗi, nên chip xoá không được mượn màu đó.
  it('chip xoá KHÔNG mượn màu đỏ của "QC hỏng"', () => {
    expect(chipThaoTac('xoa')?.mau).not.toMatch(/red/);
  });
});

// I2 — cột `*_at` ra ISO UTC thô từ `to_jsonb(...) ->> cot`.
describe('hienOThoiGian', () => {
  it('mốc KHÔNG có múi giờ được hiểu là UTC rồi quy về giờ nghiệp vụ (+7)', () => {
    // 03:00 UTC = 10:00 giờ Bangkok. Lệch 7 tiếng là đúng cái I2 báo.
    const r = hienOThoiGian('qc_checked_at', '2026-10-20T03:00:00');
    expect(r).toContain('10:00:00');
    expect(r).toContain('20/10/2026');
  });

  it('mốc có sẵn múi giờ không bị cộng thêm lần nữa', () => {
    expect(hienOThoiGian('addr_verified_at', '2026-10-20T03:00:00+00:00')).toContain('10:00:00');
  });

  it('phần giây lẻ của timestamp Postgres vẫn đọc được', () => {
    expect(hienOThoiGian('printed_at', '2026-06-11T16:08:23.235488')).toContain('11/6/2026');
  });

  it('cột `date` tên *_at KHÔNG bị quy múi giờ — quy là lệch hẳn một ngày', () => {
    // `ship_ho_orders.shipped_at` kiểu `date`, ra '2026-08-07'.
    expect(hienOThoiGian('shipped_at', '2026-08-07')).toBeNull();
  });

  it('cột không phải thời gian giữ nguyên văn', () => {
    expect(hienOThoiGian('qc_result', 'pass')).toBeNull();
    expect(hienOThoiGian('location', '2026-10-20T03:00:00')).toBeNull();
  });

  it('chuỗi hình dáng đúng mà giá trị vô nghĩa thì hiện nguyên văn, không ra "Invalid Date"', () => {
    expect(hienOThoiGian('qc_checked_at', '2026-99-99T99:00:00')).toBeNull();
  });
});
