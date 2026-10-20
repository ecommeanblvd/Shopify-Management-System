import { allPermissionKeys, type PermissionKey } from './permissions';

/** Legacy permission → new permission keys. Used by the compat shim and to
 *  derive system-role seeds so admin/operator/viewer behave exactly as before. */
export const OLD_TO_NEW: Record<string, PermissionKey[]> = {
  view: [],
  // The 3 legacy settings perms map to 3 DISTINCT settings_sync keys (see
  // permissions.ts) so the shim's .every() distinguishes them — exact parity:
  //   run_feature (use/run sync) → edit · manage_settings_template → create ·
  //   view_settings_history → view · apply_settings/reconcile_store → apply.
  run_feature: ['settings_sync:edit'],
  manage_stores: ['stores:view', 'stores:create', 'stores:edit', 'stores:delete'],
  manage_settings_template: ['settings_sync:create'],
  apply_settings: ['settings_sync:apply'],
  reconcile_store: ['settings_sync:apply'],
  view_settings_history: ['settings_sync:view'],
  manage_users: ['users_roles:view', 'users_roles:create', 'users_roles:edit', 'users_roles:delete'],
  manage_markets_template: ['markets:edit'],
  apply_markets: ['markets:apply'],
  view_markets_history: ['markets:view'],
  manage_carrier_rates: ['carrier_rates:create', 'carrier_rates:edit', 'carrier_rates:delete'],
  view_carrier_rates: ['carrier_rates:view'],
  view_orders: ['orders:view'],
  manage_sku_costs: ['orders:edit'],
  manage_shipping_invoices: ['carrier_rates.invoices:view', 'carrier_rates.invoices:create', 'carrier_rates.invoices:edit'],
  manage_functions: ['functions:edit'],
  view_functions: ['functions:view'],
  view_mmp_products: ['mmp_products:view'],
  manage_mmp_products: ['mmp_products:create', 'mmp_products:edit', 'mmp_products:delete', 'mmp_products:push'],
  view_fulfillment: ['fulfillment.operations:view'],
  // Chọn line ship trên màn Đóng hàng là việc của đội logistics, KHÔNG phải của OC:
  // manage_fulfillment còn đòi 'fulfillment.brand_requests:edit' nên vai trò logistics
  // (Đức) không bấm chọn được — CEO báo 22/09/2026.
  chon_line_ship: ['fulfillment.logistics:edit'],
  manage_fulfillment: ['fulfillment.operations:edit', 'fulfillment.brand_requests:edit'],
  manage_warehouse: ['fulfillment.warehouse:view', 'fulfillment.warehouse:create', 'fulfillment.warehouse:edit', 'fulfillment.warehouse:delete'],
  view_receiving: ['warehouse.receiving:view'],
  manage_receiving: ['warehouse.receiving:view', 'warehouse.receiving:create', 'warehouse.receiving:edit'],
  view_qc: ['warehouse.qc:view'],
  manage_qc: ['warehouse.qc:view', 'warehouse.qc:create', 'warehouse.qc:edit'],
  /** Sửa kết quả QC đã chốt. CỐ Ý KHÔNG nằm trong `manage_qc`: đo 14/10/2026, `manage_qc`
   *  do cả vai `operator` (3 người đang trực tiếp QC) nắm, nên gộp vào đó là người bấm sai
   *  tự gỡ được cho mình. Quyền này cấp cho quản lý — vai `OC` và `admin`. */
  sua_ket_qua_qc: ['warehouse.qc:override'],
  view_pack_check: ['fulfillment.pack_check:view'],
  check_packed: ['fulfillment.pack_check:view', 'fulfillment.pack_check:create'],
  // KPI logistics: quyền RIÊNG, không dùng chung 'fulfillment.logistics:view' — role OC cũng có quyền đó nhưng không
  // phải người bị chấm KPI này. Chỉ ĐỌC; mọi ô nhập vẫn chỉ admin.
  view_kpi_logistics: ['kpi.logistics:view'],
  view_ship_ho: ['ship_ho:view'],
  manage_ship_ho: ['ship_ho:view', 'ship_ho:create', 'ship_ho:edit'],
  view_kol: ['kol:view'],
  manage_kol: ['kol:view', 'kol:create', 'kol:edit'],
  view_cogs: ['orders.cogs:view'],
  manage_cogs: ['orders.cogs:view', 'orders.cogs:edit'],
  view_cx_ticket: ['cx.ticket:view'],
  manage_cx_ticket: ['cx.ticket:view', 'cx.ticket:create', 'cx.ticket:edit'],
  view_cx_dispute: ['cx.dispute:view'],
  manage_cx_dispute: ['cx.dispute:view', 'cx.dispute:create', 'cx.dispute:edit'],
  view_cx_incident: ['cx.incident:view'],
  manage_cx_incident: ['cx.incident:view', 'cx.incident:create', 'cx.incident:edit'],
  view_cx_review: ['cx.review:view'],
  manage_cx_review: ['cx.review:view', 'cx.review:create', 'cx.review:edit'],
  view_nhat_ky: ['nhat_ky:view'],
};

const OPERATOR_OLD = [
  'view', 'run_feature', 'apply_settings', 'reconcile_store', 'view_settings_history',
  'apply_markets', 'view_markets_history', 'manage_carrier_rates', 'view_carrier_rates',
  'view_orders', 'manage_sku_costs', 'manage_shipping_invoices', 'view_functions',
  'view_mmp_products', 'manage_mmp_products', 'view_fulfillment', 'manage_fulfillment', 'manage_warehouse',
  'view_receiving', 'manage_receiving', 'view_qc', 'manage_qc',
  'view_pack_check', 'check_packed',
  'view_ship_ho', 'manage_ship_ho',
  'view_kol', 'manage_kol',
  'view_cx_ticket', 'manage_cx_ticket',
  'view_cx_dispute', 'manage_cx_dispute',
  'view_cx_incident', 'manage_cx_incident',
  'view_cx_review', 'manage_cx_review',
  'view_nhat_ky',
];
const VIEWER_OLD = [
  'view', 'view_settings_history', 'view_markets_history', 'view_carrier_rates',
  'view_orders', 'view_functions', 'view_mmp_products', 'view_fulfillment',
  'view_cx_ticket', 'view_cx_dispute', 'view_cx_incident', 'view_cx_review',
  'view_nhat_ky',
];

function expand(oldPerms: string[]): PermissionKey[] {
  return [...new Set(oldPerms.flatMap((p) => OLD_TO_NEW[p] ?? []))];
}

export interface RoleSeed { name: string; description: string; isSystem: boolean; keys: PermissionKey[]; }

export const SYSTEM_ROLE_SEEDS: Record<string, RoleSeed> = {
  admin: { name: 'Admin', description: 'Toàn quyền', isSystem: true, keys: allPermissionKeys() },
  operator: { name: 'Operator', description: 'Vận hành chung', isSystem: true, keys: expand(OPERATOR_OLD) },
  viewer: { name: 'Viewer', description: 'Chỉ xem', isSystem: true, keys: expand(VIEWER_OLD) },
  logistics: {
    name: 'Logistics staff', description: 'Vận hành logistics + carrier rate/invoice', isSystem: false,
    keys: [
      'fulfillment.operations:view',
      'fulfillment.logistics:view', 'fulfillment.logistics:create', 'fulfillment.logistics:edit', 'fulfillment.logistics:delete',
      'carrier_rates:view', 'carrier_rates:create',
      'carrier_rates.invoices:view', 'carrier_rates.invoices:create', 'carrier_rates.invoices:edit',
      // Ship hộ: logistics staff toàn quyền vận hành (xem/tạo/sửa, gắn tracking,
      // cân đo lại, đối soát).
      'ship_ho:view', 'ship_ho:create', 'ship_ho:edit',
      // Xem view tổng module Orders (landing + bảng đơn per-store). Chi tiết đơn
      // (modal) vẫn cần manage_sku_costs nên logistics chỉ xem, không mở chi tiết.
      'orders:view',
      // Bảng điểm KPI của CHÍNH vị trí này — chỉ ĐỌC (mọi ô nhập vẫn chỉ quản lý, chặn trong
      // features/kpi-logistics/actions.ts). Production đã có quyền này nhưng do CẤP TAY trong
      // Settings, không nằm trong hạt giống — nên môi trường dựng lại là mất, và không ai đọc
      // mã mà biết được đây là chủ ý. Seed chỉ THÊM nên ghi vào đây không đụng gì đang có.
      'kpi.logistics:view',
      // Nhật ký thay đổi: CEO chốt 20/10/2026 mọi nhân sự xem được.
      //
      // Giá trị nhạy cảm che theo `features/nhat-ky/che-gia-tri.ts`, và luật ở đó là "nhật
      // ký che ĐÚNG BẰNG màn hình gốc" — nên quyền nào vai này đang có thì trong nhật ký
      // cũng thấy đúng chừng đó, KHÔNG ít hơn. Cụ thể với vai `logistics` (sửa chú thích
      // 20/10/2026, bản cũ nói gọn "không thấy giá vốn" và điều đó KHÔNG đúng):
      //  - CHE: giá vốn mức ĐƠN (`shopify_orders.shipping_cost_override`,
      //    `shopify_order_lines.cost_override`) vì chúng đòi `orders.cogs:view` mà vai này
      //    không có — đúng như màn `/f/orders/lai-gop` đang chặn.
      //  - KHÔNG CHE: giá vốn TỪNG CHIẾC trong kho (`goods_receipt_items.dom_price` /
      //    `global_price`) vì chúng đòi `fulfillment.operations:view`, mà vai này có và
      //    đang xem thẳng hai con số đó trên `/f/warehouse`. Nhật ký không che cái mà
      //    người ta đã thấy ở màn gốc; muốn che thì siết ở màn gốc trước.
      //  - Dữ liệu cá nhân khách của `ship_ho_orders` (tên, địa chỉ, email, điện thoại)
      //    thì KHÔNG khai trong `DO_NHAY` nên bị che với mọi vai, kể cả admin.
      'nhat_ky:view',
    ],
  },
};

/**
 * Nền chung: khoá mà MỌI vai trò đều phải có, kể cả vai trò CẤP TAY trong Settings
 * (production 20/10/2026 đang có vai `OC` không nằm trong `SYSTEM_ROLE_SEEDS`).
 *
 * `seedRoles()` cấp danh sách này cho mọi dòng `app_roles`, không riêng vai hạt giống —
 * thêm vào `SYSTEM_ROLE_SEEDS` thôi là KHÔNG tới được vai cấp tay, mà "mọi nhân sự xem
 * được nhật ký" (CEO 20/10/2026) thì hụt đúng những người đang dùng vai đó.
 *
 * CHỈ dùng cho quyền mà câu trả lời đúng là "ai cũng có". Đừng nhét quyền ghi vào đây.
 */
export const QUYEN_MOI_VAI_TRO: readonly PermissionKey[] = ['nhat_ky:view'];
