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
 * MỘT luật duy nhất, áp ở CẢ HAI mức: **chưa khai thì bị che**. Cột không có trong bảng
 * khai của nó bị che; và bảng không có mặt ở đây thì BỊ CHE TOÀN BỘ, kể cả với admin.
 *
 * Vì sao luật ở mức BẢNG phải cùng chiều với luật ở mức cột (sửa 20/10/2026): trước đây
 * luật mặc-định-che chỉ áp BÊN TRONG bảng đã có mặt, còn bảng vắng mặt thì mở sạch. Hệ quả
 * đo được: `DO_NHAY` khai 3 bảng trong khi `CAU_HINH` theo dõi 10, nên 7 bảng còn lại mở
 * toàn bộ — gồm `goods_receipt_items`, bảng DUY NHẤT đang có trigger sống, với `dom_price`
 * / `global_price` (giá vốn từng chiếc). Spec §7 chốt "cột chưa khai độ nhạy thì bị che";
 * một luật che ở mức cột mà mức bảng lại mở thì câu đó chỉ đúng ở 3/10 bảng.
 *
 * Vì sao chọn ĐẢO LUẬT chứ không chỉ khai thêm hai bảng đang sống:
 *  - CHIỀU THẤT BẠI. Quên khai với luật mới = màn hình hiện `•••` kèm chữ "bị che vì
 *    quyền" cho mọi người, kể cả CEO — ầm ĩ, có người báo trong ngày. Quên khai với luật
 *    cũ = dữ liệu hiện ra cho cả công ty, dòng nhật ký nhìn vẫn bình thường, không ai có
 *    lý do gì để đi kiểm. Lỗi ồn sửa được; lỗi lặng thì không ai biết mà sửa.
 *  - §8 SẼ MỞ RỘNG. Năm bảng còn lại (`shipments`, `warehouse_inventory`,
 *    `inventory_movements`, `order_fulfillment`, `order_fulfillment_lines`) chạy chế độ
 *    `tru` — tức MỌI cột hiện có và mọi cột thêm về sau đều vào nhật ký. Người bật trigger
 *    cho chúng không có cách nào biết là phải ghé qua tệp này; với luật mới thì lượt bật
 *    đầu tiên tự nói ra (`•••` khắp bảng), còn với luật cũ thì mỗi cột mới của 5 bảng đó
 *    là một lỗ mở sẵn.
 *  - `QUYEN_MOI_VAI_TRO` tự cấp `nhat_ky:view` cho MỌI vai mới, nên số người đọc được
 *    nhật ký chỉ tăng, không giảm. Mặc định của một mặt phẳng đang nở ra phải là đóng.
 *
 * Giá phải trả, nói rõ ra: bảng chưa khai thì che cả những cột vô hại (tên SKU, vị trí
 * kho). Đó là lý do hai bảng ĐANG SỐNG được khai ĐỦ ngay dưới đây — đảo luật mà không khai
 * thì màn hình duy nhất đang chạy thật hiện `•••` sạch, tức là đổi một lỗ lặng thành một
 * tính năng chết.
 *
 * Quyền dùng ở đây là quyền ĐANG CÓ, cố ý không thêm quyền mới: cột ĐÃ KHAI phải che đúng
 * bằng cái màn hình gốc đang che, không nghiêm hơn cũng không lỏng hơn. (Cột/bảng CHƯA
 * khai thì nghiêm hơn mọi màn hình — đó là mặc định, không phải một lựa chọn về độ nhạy
 * của cột đó; cách sửa là khai nó, không phải nới mặc định.)
 */
export const DO_NHAY: Record<string, Record<string, Permission>> = {
  /**
   * Hai bảng ĐANG SỐNG (trigger `nhat_ky_goods_receipt_items` bật trên production
   * 20/10/2026). Chế độ `tru` nên danh sách cột phải là MỌI cột của CSDL trừ
   * `LOAI_TRU_CHUNG` và `id` — kiểm `information_schema` 20/10/2026, 35 cột cho chiếc và
   * 8 cột cho phiếu.
   *
   * `view_fulfillment` cho TOÀN BỘ, kể cả `dom_price` / `global_price`, vì đó là đúng
   * quyền mà màn hình gốc đang gác: `/f/warehouse` (`page.tsx` chặn bằng
   * `view_fulfillment`) hiện cho từng chiếc mã WH, vị trí, trạng thái, nguồn nhập (chính
   * `goods_receipts.note`) và cột "Giá vốn" = `dom_price` — xem
   * `components/fulfillment/WarehouseBoard.tsx` + `features/warehouse/queries.ts`.
   *
   * CỐ Ý KHÔNG dùng `view_cogs` cho hai cột giá dù chúng là giá vốn: `view_cogs`
   * (`orders.cogs:view`) gác giá vốn MỨC ĐƠN ở màn lãi gộp, còn giá từng chiếc trong kho
   * thì vai `viewer` và `logistics` đang xem thẳng trên `/f/warehouse` mà không có
   * `view_cogs`. Gác bằng `view_cogs` là nhật ký NGHIÊM HƠN màn hình gốc: cùng một con số,
   * trên bảng kho thì thấy mà trong nhật ký lại `•••` — người đọc kết luận nhật ký hỏng.
   * Ngày nào `/f/warehouse` siết lại thì siết ở đây theo, cùng một dòng.
   */
  goods_receipts: {
    code: 'view_fulfillment',
    warehouse_code: 'view_fulfillment',
    source_type: 'view_fulfillment',
    vendor: 'view_fulfillment',
    received_at: 'view_fulfillment',
    received_by: 'view_fulfillment',
    handover_doc_key: 'view_fulfillment',
    note: 'view_fulfillment',
  },

  goods_receipt_items: {
    receipt_id: 'view_fulfillment',
    unit_code: 'view_fulfillment',
    sku: 'view_fulfillment',
    product_title: 'view_fulfillment',
    variant_title: 'view_fulfillment',
    photo_key: 'view_fulfillment',
    qc_result: 'view_fulfillment',
    qc_fail_reason: 'view_fulfillment',
    qc_fail_photo_key: 'view_fulfillment',
    qc_checked_by: 'view_fulfillment',
    qc_checked_at: 'view_fulfillment',
    disposition: 'view_fulfillment',
    vendor_return_doc_key: 'view_fulfillment',
    brand_request_id: 'view_fulfillment',
    fulfillment_line_id: 'view_fulfillment',
    order_id: 'view_fulfillment',
    // Giá vốn từng chiếc — xem đoạn giải thích `view_fulfillment` ở trên.
    dom_price: 'view_fulfillment',
    dom_price_currency: 'view_fulfillment',
    global_price: 'view_fulfillment',
    global_price_currency: 'view_fulfillment',
    weight_kg: 'view_fulfillment',
    current_warehouse_code: 'view_fulfillment',
    location: 'view_fulfillment',
    stock_status: 'view_fulfillment',
    printed_at: 'view_fulfillment',
    confirmed_at: 'view_fulfillment',
    unplanned: 'view_fulfillment',
    shopify_variant_id: 'view_fulfillment',
    lark_record_id: 'view_fulfillment',
    lark_unique_code: 'view_fulfillment',
    po_order_number: 'view_fulfillment',
    po_record_id: 'view_fulfillment',
    mon_dinh_danh: 'view_fulfillment',
    mon_record_id: 'view_fulfillment',
    return_record_id: 'view_fulfillment',
  },

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
  // Bảng chưa khai → che TẤT CẢ, cùng chiều với cột chưa khai. Đây là luật của `DO_NHAY`;
  // lý do chọn chiều này (và cái giá của nó) ghi ngay trên `DO_NHAY`.
  const khaiCuaBang = cuaRieng(DO_NHAY, bang);
  if (!khaiCuaBang) return { gia: null, biChe: true };
  const can = cuaRieng(khaiCuaBang, cot);
  if (!can) return { gia: null, biChe: true };
  return quyen.includes(can) ? { gia: giaTri, biChe: false } : { gia: null, biChe: true };
}
