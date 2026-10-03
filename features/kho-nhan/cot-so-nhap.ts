/**
 * THUẦN: danh sách cột của Sổ nhập — tên tiêu đề và lưới cột khai CÙNG MỘT CHỖ.
 *
 * Trước 03/10/2026 lưới `grid-template-columns` là một chuỗi, còn tiêu đề là 14 thẻ `<span>`
 * viết tay cạnh nhau. Hai bản của một sự thật: thêm hoặc bớt một cột mà quên vế kia thì toàn
 * bộ bảng lệch một ô — và lệch âm thầm, vì mọi dòng vẫn vẽ ra bình thường, chỉ sai cột. Lượt
 * thêm hai cột lỗi QC hôm nay là đúng lúc dễ mắc lỗi đó nhất, nên gộp lại luôn.
 *
 * Thứ tự cột là thứ tự THẬT trên bảng Lark "WH - Inventory" (`QC Check` → `Lý do QC failed` →
 * `Ảnh chụp lỗi QC fail` → `WH - Action`), vì trang này tồn tại để đối chiếu: hai bên cùng
 * hình thì mắt bắt chỗ lệch ngay.
 */
export interface CotSoNhap {
  /** Chữ trên hàng tiêu đề. */
  ten: string;
  /** Độ rộng, đúng cú pháp `grid-template-columns`. KHÔNG chứa dấu cách. */
  rong: string;
  /** Căn giữa — dùng cho cột số và cột ảnh. */
  giua?: boolean;
}

export const COT_SO_NHAP: readonly CotSoNhap[] = [
  { ten: 'Đơn', rong: '104px' },
  { ten: 'Brand', rong: '92px' },
  { ten: 'Sản phẩm', rong: 'minmax(220px,1fr)' },
  { ten: 'SKU', rong: 'minmax(180px,250px)' },
  { ten: 'SL', rong: '32px', giua: true },
  { ten: 'Store', rong: '74px' },
  { ten: 'Kho', rong: '86px' },
  { ten: 'Loại nhập', rong: '112px' },
  { ten: 'QC', rong: '128px' },
  { ten: 'Lý do lỗi', rong: 'minmax(140px,180px)' },
  { ten: 'Ảnh lỗi', rong: '52px', giua: true },
  { ten: 'Xử lý kho', rong: '138px' },
  { ten: 'Ảnh', rong: '52px', giua: true },
  { ten: 'BBGN', rong: '52px', giua: true },
  { ten: 'Mã WH', rong: '76px' },
  { ten: 'Nguồn', rong: '78px' },
];

/** Chuỗi cho `grid-template-columns`, dựng TỪ danh sách trên. */
export const LUOI_SO_NHAP: string = COT_SO_NHAP.map((c) => c.rong).join(' ');

/**
 * Bề rộng tối thiểu của bảng: tổng bề rộng nhỏ nhất + khoảng cách giữa các cột + lề hai bên.
 *
 * Tính chứ không gõ tay một con số tròn: thêm cột mà quên nới trần là các cột bị bóp lại rồi
 * chữ cụt dần, không ai thấy ngay.
 */
export const RONG_TOI_THIEU: number = COT_SO_NHAP
  .reduce((s, c) => s + Number(/(\d+)px/.exec(c.rong)?.[1] ?? 0), 0)
  + (COT_SO_NHAP.length - 1) * 12   // gap-3
  + 28;                             // px-3.5 hai bên
