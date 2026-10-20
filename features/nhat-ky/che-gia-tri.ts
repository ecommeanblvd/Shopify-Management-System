/**
 * Che giá trị trước/sau của một dòng nhật ký theo phân quyền đang có (spec §7).
 *
 * Thuần, không I/O: đây là hàng rào phân quyền DUY NHẤT của nhật ký, mà nhật ký chứa
 * bản sao của chính những ô mà `orders.cogs:view` / `ship_ho:view` đang cố ý chặn. Sai
 * ở đây thì nhật ký thành **đường vòng qua toàn bộ phân quyền** của dự án — nên luật
 * nằm trong tầm `vitest`, không nằm rải trong `.tsx`.
 */
import type { Permission } from '@/lib/auth/rbac';

/**
 * Bảng → cột → quyền phải có để THẤY giá trị của cột đó.
 *
 * Hai luật, và luật thứ hai mới là luật quan trọng:
 *
 *  1. Bảng **không có mặt** ở đây → mọi cột mở (vd `goods_receipt_items`: mã chiếc, kết
 *     quả QC, vị trí kho — ai vào được màn nhập kho thì đều đang thấy trên màn hình).
 *  2. Bảng **có mặt** → cột KHÔNG khai thì **BỊ CHE với mọi người**, kể cả admin.
 *
 * Luật 2 là mặc định AN TOÀN mà CEO chốt 20/10/2026: `shopify_orders` và
 * `ship_ho_orders` có email, tên, địa chỉ khách, giá vốn, bảng kê cước. Nếu cột chưa
 * khai mà mặc định HIỆN, thì ngày nào có người thêm một cột nhạy vào `CAU_HINH` mà quên
 * khai ở đây là ngày đó dữ liệu đó lộ ra cho cả công ty — và không ai thấy gì bất thường
 * vì dòng nhật ký nhìn vẫn bình thường. Chiều ngược lại chỉ tốn một dòng khai thêm.
 *
 * Quyền dùng ở đây là quyền ĐANG CÓ, cố ý không thêm quyền mới: nhật ký phải che đúng
 * bằng cái màn hình gốc đang che, không nghiêm hơn cũng không lỏng hơn.
 */
export const DO_NHAY: Record<string, Record<string, Permission>> = {
  // Bốn cột người sửa được trên màn Đơn hàng / Đóng hàng (`CAU_HINH` chế độ cho-phép).
  // Hai cột phí ship đi thẳng vào lãi gộp — màn `/f/orders/lai-gop` gác bằng `view_cogs`,
  // nên nhật ký gác đúng quyền đó. Cân kiện và line ship thì hiện sẵn trên bảng đơn cho
  // mọi người có `view_orders` (gồm cả vai `logistics` đi chọn line ship).
  shopify_orders: {
    selected_carrier_key: 'view_orders',
    ship_weight_kg_override: 'view_orders',
    shipping_cost_override: 'view_cogs',
    shipping_cost_override_note: 'view_cogs',
    /** Giá vốn mức ĐƠN. Hôm nay `CAU_HINH` chưa theo dõi cột này (`shopify_orders` chạy
     *  chế độ `cho-phep`) nên không có dòng nhật ký nào mang nó — khai sẵn để ngày nó
     *  được theo dõi thì quyền đã đúng chỗ, không phải nhớ quay lại đây. */
    cost_override: 'view_cogs',
  },

  shopify_order_lines: {
    sku: 'view_orders',
    quantity: 'view_orders',
    unit_price: 'view_orders',
    total: 'view_orders',
    // Giá vốn nhập tay — cùng loại dữ liệu với màn lãi gộp.
    cost_override: 'view_cogs',
  },

  /**
   * `ship_ho_orders` theo chế độ `tru` (ghi gần như mọi cột), nên danh sách này là
   * danh sách MỞ: cái gì màn Ship hộ đang hiện cho người có `ship_ho:view` thì khai.
   *
   * CỐ Ý KHÔNG KHAI — tức bị che với mọi người: `recipient_name`, `recipient_company`,
   * `recipient_phone`, `recipient_email`, `address1`, `address2`, `city`, `province`,
   * `postcode`, `house_number`, `short_address`, `maps_url`. Đây là dữ liệu cá nhân của
   * khách brand; người đọc nhật ký vẫn thấy AI sửa địa chỉ LÚC NÀO (dòng log, tên người,
   * tên trường, thời điểm) — chỉ nội dung cũ/mới là không hiện. Cần mở một cột nào trong
   * số đó thì khai thêm một dòng, đừng đổi luật mặc định.
   */
  ship_ho_orders: {
    code: 'view_ship_ho',
    brand_reference: 'view_ship_ho',
    partner_brand_slug: 'view_ship_ho',
    customer_ref: 'view_ship_ho',
    mmp_ref: 'view_ship_ho',
    source: 'view_ship_ho',
    country: 'view_ship_ho',
    // Kiện: cân, kích thước, loại bao bì, dịch vụ.
    weight_kg: 'view_ship_ho',
    dim_length_cm: 'view_ship_ho',
    dim_width_cm: 'view_ship_ho',
    dim_height_cm: 'view_ship_ho',
    packaging_type: 'view_ship_ho',
    service: 'view_ship_ho',
    sms_weight_kg: 'view_ship_ho',
    sms_dim_length_cm: 'view_ship_ho',
    sms_dim_width_cm: 'view_ship_ho',
    sms_dim_height_cm: 'view_ship_ho',
    // Giá và đối soát. `quote_breakdown` / `actual_bill_breakdown` là hai cột spec §7 gọi
    // tên: cả hai là bảng kê cước của hãng, và hôm nay chính màn Ship hộ (gác bằng
    // `ship_ho:view`) đang hiện chúng — nên gác đúng quyền đó, không nới ra.
    carrier_key: 'view_ship_ho',
    carrier_account_id: 'view_ship_ho',
    carrier_cost_vnd: 'view_ship_ho',
    markup_percent: 'view_ship_ho',
    charged_vnd: 'view_ship_ho',
    quote_breakdown: 'view_ship_ho',
    quoted_at: 'view_ship_ho',
    actual_carrier_cost_vnd: 'view_ship_ho',
    actual_weight_kg: 'view_ship_ho',
    actual_charged_vnd: 'view_ship_ho',
    actual_bill_breakdown: 'view_ship_ho',
    actual_duty_vnd: 'view_ship_ho',
    delta_vnd: 'view_ship_ho',
    margin_vnd: 'view_ship_ho',
    reconcile_status: 'view_ship_ho',
    reconcile_decision: 'view_ship_ho',
    claim_reason: 'view_ship_ho',
    statement_id: 'view_ship_ho',
    duty_statement_id: 'view_ship_ho',
    // Vận đơn và mốc thời gian.
    tracking_number: 'view_ship_ho',
    shipped_at: 'view_ship_ho',
    picked_up_at: 'view_ship_ho',
    delivered_at: 'view_ship_ho',
    // Giải trình giao chậm (vào KPI, nên phải đối chất được).
    ly_do_cham: 'view_ship_ho',
    ly_do_cham_ghi_chu: 'view_ship_ho',
    ly_do_doi_chieu: 'view_ship_ho',
    ly_do_bang_chung: 'view_ship_ho',
    ly_do_duyet: 'view_ship_ho',
  },
};

/**
 * Các quyền `DO_NHAY` thật sự dùng tới — suy từ chính `DO_NHAY` nên không bao giờ lệch.
 *
 * `Permission` là union type, lúc chạy không có danh sách nào để duyệt; `queries.ts` cần
 * một danh sách hữu hạn để hỏi `hasPermission` cho người đang xem. Chỉ hỏi những quyền
 * ảnh hưởng tới việc che, không hỏi cả bảng quyền.
 */
export const QUYEN_DO_NHAY: readonly Permission[] = [
  ...new Set(Object.values(DO_NHAY).flatMap((cot) => Object.values(cot))),
];

/** Tra một khoá CỦA CHÍNH đối tượng. Tên bảng/cột tới từ CSDL nên có thể là `constructor`
 *  hay `__proto__`; tra kiểu kế thừa prototype sẽ trả về hàm của `Object` và biến cột
 *  "chưa khai" thành "đã khai" — đúng chiều sai. */
function cuaRieng<T>(tu: Record<string, T>, khoa: string): T | undefined {
  return Object.hasOwn(tu, khoa) ? tu[khoa] : undefined;
}

/**
 * Giá trị được hiện, kèm cờ nói rõ **vì sao** nó rỗng.
 *
 * `biChe` là thứ màn hình cần để hiện `•••` + chữ "bị che vì quyền". Không có cờ này thì
 * ô bị che và ô vốn NULL nhìn giống nhau, và người đọc tưởng dữ liệu không có — tức ẩn
 * im lặng, đúng cái spec §7 cấm.
 */
export function cheNeuCan(
  bang: string,
  cot: string,
  giaTri: string | null,
  quyen: readonly Permission[],
): { gia: string | null; biChe: boolean } {
  const khaiCuaBang = cuaRieng(DO_NHAY, bang);
  if (!khaiCuaBang) return { gia: giaTri, biChe: false };
  const can = cuaRieng(khaiCuaBang, cot);
  if (!can) return { gia: null, biChe: true };
  return quyen.includes(can) ? { gia: giaTri, biChe: false } : { gia: null, biChe: true };
}
