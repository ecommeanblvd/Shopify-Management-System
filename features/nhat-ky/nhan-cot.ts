/**
 * Nhãn tiếng Việt của từng cột — thứ hiện ở cột "Trường" của nhật ký (spec §6).
 *
 * Nhãn lấy từ nhãn ĐANG HIỆN trên màn hình của chính module đó, không đặt tên mới: người
 * đọc nhật ký và người sửa dữ liệu là cùng một người, hai bên gọi khác tên thì họ phải
 * dịch trong đầu. Cột chưa có nhãn hiện TÊN CỘT, không để trống — tên cột khó đọc nhưng
 * vẫn trả lời được "trường nào đổi", còn ô trống thì dòng nhật ký thành vô nghĩa.
 *
 * Danh sách cố ý KHÔNG phủ hết 10 bảng: phủ bảng đang có trigger sống
 * (`goods_receipt_items` + phiếu cha) và những cột được theo dõi có chọn lọc của
 * `shopify_orders` / `shopify_order_lines` / `ship_ho_orders`. Thêm nhãn là một dòng,
 * và cái giá của việc thiếu nhãn chỉ là thấy `snake_case`.
 */

/** Bảng → cột → nhãn. Khoá là tên cột THẬT trong CSDL, như `nhat_ky_thay_doi.truong` ghi. */
export const NHAN_COT: Record<string, Record<string, string>> = {
  // Màn Nhận hàng (`/f/warehouse/receiving/[id]`) + bảng "Đang kiểm" / kho MEAN.
  goods_receipts: {
    code: 'Mã phiếu',
    warehouse_code: 'Kho',
    source_type: 'Nguồn nhập',
    vendor: 'Nhà cung cấp',
    received_at: 'Nhận lúc',
    received_by: 'Người nhận',
    handover_doc_key: 'Biên bản bàn giao',
    note: 'Ghi chú',
  },
  goods_receipt_items: {
    unit_code: 'Mã chiếc',
    sku: 'SKU',
    product_title: 'Sản phẩm',
    variant_title: 'Biến thể',
    photo_key: 'Ảnh thực tế sản phẩm',
    qc_result: 'Kết quả QC',
    qc_fail_reason: 'Lý do lỗi',
    qc_fail_photo_key: 'Ảnh chụp lỗi QC',
    qc_checked_by: 'Người kiểm',
    qc_checked_at: 'Kiểm lúc',
    disposition: 'Xử lý kho',
    weight_kg: 'Cân (kg)',
    location: 'Vị trí',
    current_warehouse_code: 'Kho',
    stock_status: 'Trạng thái',
    unplanned: 'Ngoài kế hoạch',
    dom_price: 'Giá vốn',
    printed_at: 'In tem lúc',
    confirmed_at: 'Quét xác nhận lúc',
  },

  // Màn Đơn hàng / Đóng hàng. Hai màn này đang ghi nhãn bằng tiếng Anh
  // ("Weight override", "Qty", "Unit price"); nhật ký là màn TIẾNG VIỆT nên dùng chữ mà
  // chính repo đang dùng cho đúng khái niệm đó ở các màn khác (Cân, Số lượng, Đơn giá).
  shopify_orders: {
    selected_carrier_key: 'Line ship',
    ship_weight_kg_override: 'Cân ship (ghi đè)',
    shipping_cost_override: 'Phí ship (ghi đè)',
    shipping_cost_override_note: 'Ghi chú phí ship',
  },
  shopify_order_lines: {
    sku: 'SKU',
    quantity: 'Số lượng',
    unit_price: 'Đơn giá',
    total: 'Thành tiền',
    cost_override: 'Giá vốn nhập tay',
  },

  // Màn Ship hộ + bảng điểm KPI (nhãn lấy từ `components/kpi/ChiTietPillar1|2.tsx`).
  ship_ho_orders: {
    code: 'Mã đơn',
    brand_reference: 'Mã của brand',
    partner_brand_slug: 'Brand',
    country: 'Nước',
    weight_kg: 'Cân (kg)',
    service: 'Dịch vụ',
    packaging_type: 'Loại bao bì',
    carrier_key: 'Hãng',
    carrier_cost_vnd: 'Vốn carrier',
    charged_vnd: 'Thu brand',
    margin_vnd: 'Lãi',
    quote_breakdown: 'Bảng kê báo giá',
    actual_bill_breakdown: 'Bảng kê hoá đơn',
    actual_carrier_cost_vnd: 'Vốn carrier thực',
    actual_weight_kg: 'Cân thực',
    reconcile_status: 'Trạng thái đối soát',
    reconcile_decision: 'Quyết định đối soát',
    tracking_number: 'Tracking',
    shipped_at: 'Ngày gửi',
    delivered_at: 'Ngày giao',
    ly_do_cham: 'Lý do chậm',
    ly_do_doi_chieu: 'Đối chiếu hãng',
    ly_do_bang_chung: 'Bằng chứng',
  },
};

/**
 * Nhãn của một cột, hoặc chính tên cột khi chưa khai.
 *
 * Tra bằng khoá CỦA CHÍNH đối tượng: tên bảng/cột tới từ CSDL nên có thể là `constructor`
 * hay `toString`, mà tra kiểu kế thừa prototype sẽ trả về một HÀM rồi hiện lên màn hình.
 */
export function nhanCot(bang: string, cot: string): string {
  const cuaBang = Object.hasOwn(NHAN_COT, bang) ? NHAN_COT[bang] : undefined;
  if (cuaBang && Object.hasOwn(cuaBang, cot)) return cuaBang[cot];
  return cot;
}
