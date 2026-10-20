/**
 * Khai cột nào của bảng nào được ghi vào nhật ký thay đổi.
 *
 * Thuần, không I/O: `vitest` không chạm được SQL, mà "cột nào được ghi" là chỗ dễ
 * sai nhất của cả tính năng. Nên quyết định nằm ở đây (có test), và trigger Postgres
 * được SINH từ chính cấu hình này — không viết tay một bản thứ hai để lệch nhau.
 */

/**
 * - `tru`: bảng người sửa là chính → ghi MỌI cột trừ danh sách loại trừ. Cột mới thêm
 *   về sau tự được theo dõi, nên không sót thay đổi của người.
 * - `cho-phep`: bảng máy ghi là chính → CHỈ ghi cột trong danh sách. Cron Shopify đặt
 *   lại ~90 cột mỗi lượt đồng bộ; loại trừ thì phải duyệt tay từng cột để khỏi sót,
 *   còn cho phép thì cột mới của máy mặc định không vào nhật ký.
 */
export type CheDoCot = 'tru' | 'cho-phep';

export interface CauHinhBang {
  /** Tên bảng trong CSDL (snake_case), không phải tên biến Drizzle. */
  bang: string;
  cheDo: CheDoCot;
  /** Tên cột THẬT trong CSDL. Ý nghĩa tuỳ `cheDo`: danh sách loại trừ hoặc danh sách cho phép. */
  cot: readonly string[];
  /**
   * Chỉ có ở bảng con: cột khoá ngoại trỏ về bản ghi cha. Màn "Lịch sử" của lô nhập kho
   * phải cuốn cả thay đổi của từng chiếc (QC xảy ra ở dòng con, nhưng thứ người ta mở là lô),
   * nên trigger ghi sẵn bản ghi cha lúc chạy thay vì join lúc truy vấn.
   */
  cotCha?: string;
  bangCha?: string;
}

/**
 * Mốc do cron / đồng bộ tự đặt. Đổi liên tục mà không phải quyết định của ai, ghi vào
 * chỉ làm nhật ký ngập rác và chôn mất thay đổi thật của người.
 */
const LOAI_TRU_CHUNG = [
  'updated_at',
  'created_at',
  'last_tracked_at',
  'lark_synced_at',
  'delivery_status',
  'track_detail',
] as const;

export const CAU_HINH: readonly CauHinhBang[] = [
  { bang: 'shipments', cheDo: 'tru', cot: LOAI_TRU_CHUNG },
  { bang: 'goods_receipts', cheDo: 'tru', cot: LOAI_TRU_CHUNG },
  {
    bang: 'goods_receipt_items',
    cheDo: 'tru',
    cot: LOAI_TRU_CHUNG,
    cotCha: 'receipt_id',
    bangCha: 'goods_receipts',
  },
  { bang: 'warehouse_inventory', cheDo: 'tru', cot: LOAI_TRU_CHUNG },
  { bang: 'inventory_movements', cheDo: 'tru', cot: LOAI_TRU_CHUNG },
  { bang: 'order_fulfillment', cheDo: 'tru', cot: LOAI_TRU_CHUNG },
  {
    bang: 'order_fulfillment_lines',
    cheDo: 'tru',
    cot: LOAI_TRU_CHUNG,
    cotCha: 'fulfillment_id',
    bangCha: 'order_fulfillment',
  },
  { bang: 'ship_ho_orders', cheDo: 'tru', cot: LOAI_TRU_CHUNG },

  // Chỉ cột người sửa được qua giao diện. `selected_carrier_at/by` cố ý KHÔNG vào: chúng
  // chỉ là dấu giờ/người của chính lần chọn carrier, mà nhật ký đã có sẵn người và giờ.
  // `raw_payload` TUYỆT ĐỐI không vào: mỗi lần đổi hàng chục KB và chứa dữ liệu cá nhân khách.
  {
    bang: 'shopify_orders',
    cheDo: 'cho-phep',
    cot: [
      'selected_carrier_key',
      'shipping_cost_override',
      'shipping_cost_override_note',
      'ship_weight_kg_override',
    ],
  },
  // Chưa có màn nào sửa dòng đơn bằng tay; thay đổi ở đây phần lớn đến từ đồng bộ Shopify.
  // Vẫn ghi vì số lượng / đơn giá / SKU của một dòng đổi SAU khi khách đặt là việc kho phải
  // biết lúc nhặt hàng, và CEO chốt "cần thấy hết" cả thay đổi do máy — cột tác nhân của
  // nhật ký ghi nhãn máy nên không ai nhầm đó là người sửa. Cố ý chỉ liệt kê 5 cột này,
  // không mở cả bảng: tên/biến thể/metafield dòng đơn đổi theo Shopify là nhiễu.
  {
    bang: 'shopify_order_lines',
    cheDo: 'cho-phep',
    cot: ['quantity', 'unit_price', 'total', 'sku', 'cost_override'],
    cotCha: 'order_id',
    bangCha: 'shopify_orders',
  },
];

/** Cột của `moiCot` (mọi cột hiện có của bảng) mà trigger phải so OLD với NEW. */
export function cotDuocGhi(ch: CauHinhBang, moiCot: readonly string[]): string[] {
  const danhSach = new Set(ch.cot);
  return moiCot.filter((c) => (ch.cheDo === 'tru' ? !danhSach.has(c) : danhSach.has(c)));
}

/**
 * NULL và chuỗi rỗng là HAI giá trị khác nhau: xoá trắng một ô là một hành động của
 * người, không được nuốt mất. Cũng là cách `IS DISTINCT FROM` của Postgres đối xử NULL.
 */
export function laThayDoi(truoc: string | null, sau: string | null): boolean {
  return truoc !== sau;
}
