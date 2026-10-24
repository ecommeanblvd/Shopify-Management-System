/**
 * Permission CATALOG — single source of truth for scopes (module / sub-module)
 * and the actions applicable to each. A permission key is `"<scope>:<action>"`.
 *
 * To add a new module/function: add a ScopeDef here, then gate its pages/actions
 * with `can(perms, '<scope>:<action>')`. The role-matrix UI picks it up
 * automatically — no DB migration needed (keys are validated strings, not enums).
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'apply', 'push', 'override'] as const;
export type Action = (typeof ACTIONS)[number];

export interface ScopeDef {
  key: string;
  label: string;
  actions: Action[];
  /**
   * Nghĩa THẬT của từng action trong phạm vi này, hiện thẳng vào ô trên `/admin/roles`.
   *
   * Vì sao cần: lưới phân quyền là module × action, nên quyền `fulfillment.logistics:create`
   * chỉ hiện ra là "hàng Vận hành — logistics (tracking), cột Tạo". Không chỗ nào viết chữ
   * "Tạo vận đơn", nên CEO đi tìm đúng quyền đó KHÔNG thấy (báo 24/10/2026) dù quyền có
   * thật và đã cấp cho 4 vai. Tệ hơn: cùng ô `Tạo` ở hàng khác nghĩa khác hẳn —
   * `warehouse.receiving:create` là tạo phiếu nhập, `cx.ticket:create` là tạo ticket.
   *
   * TUỲ CHỌN, và cố ý không bắt buộc: 30 phạm vi không phải khai hết trong một lượt, và
   * nhãn SAI còn tệ hơn không có nhãn. Chỉ khai khi đã ĐỌC MÃ xem quyền đó gác cái gì —
   * mỗi nhãn dưới đây có chú thích chỉ tới chỗ kiểm thật.
   *
   * Nhãn là chuỗi NGƯỜI ĐỌC, hiện nguyên văn lên màn hình, nên viết có dấu.
   */
  nhanHanhDong?: Partial<Record<Action, string>>;
}

export const CATALOG: ScopeDef[] = [
  // `edit` KHÔNG phải "sửa đơn hàng": nó là quyền cũ `manage_sku_costs`, và chỗ kiểm thật
  // là trang nhập CSV giá vốn SKU (`app/(dashboard)/f/orders/[storeId]/costs/page.tsx:22`)
  // cùng `updateOrderOverrides` — ghi đè phí ship / trọng lượng cân lại
  // (`features/shopify-orders/order-actions.ts:495`). Không màn nào cho sửa nội dung đơn.
  {
    key: 'orders',
    label: 'Đơn hàng',
    actions: ['view', 'edit'],
    nhanHanhDong: { edit: 'Nhập giá vốn SKU & ghi đè phí ship' },
  },
  { key: 'orders.cogs', label: 'Đơn hàng — Giá vốn & lãi gộp', actions: ['view', 'edit'] },
  // `edit` là nửa mới của quyền cũ `manage_fulfillment` (nửa kia là
  // `fulfillment.brand_requests:edit` — xem `lib/auth/permission-map.ts:40`). Chỗ kiểm thật:
  // `dongKien`/`moLaiKien` (`features/dong-hang/actions.ts:99`), `ghiDongThung` (:184),
  // `luuBox`/`anBox` danh mục box (:247, :300) và `createPack`/`shipPack`
  // (`features/packing/actions.ts:38, 108`). Màn hình đã gọi nó đúng chữ này —
  // `components/dong-hang/QuanLyBox.tsx:49` ghi "cần quyền quản lý đóng hàng".
  {
    key: 'fulfillment.operations',
    label: 'Vận hành — thao tác (pick/pack/ship)',
    actions: ['view', 'edit'],
    nhanHanhDong: { edit: 'Quản lý đóng hàng (đóng/mở kiện, danh mục box)' },
  },
  // Chỉ còn `create` (nhập mã vận đơn — `tao_van_don`) và `edit` (chọn line ship —
  // `chon_line_ship`). Bỏ `view` và `delete` ngày 21/10/2026: KHÔNG chỗ nào trong hệ thống
  // kiểm chúng, nên trên màn Roles & Permissions chúng là hai ô tích được mà không mở ra
  // việc gì — một checkbox nói sai còn tệ hơn không có ô nào. Dòng `role_permissions` mồ côi
  // của hai khoá này dọn bằng `scripts/quyen-tao-van-don.ts --don-o-chet`.
  // Nhãn hai action: `create` = quyền cũ `tao_van_don`, gác `nguoiDuocGhiVanDon` và đường
  // ghi mã vận đơn (`features/dong-hang/actions.ts:439, 629`). `edit` = quyền cũ
  // `chon_line_ship`, gác `chonHangChoDon` (:88) và verify địa chỉ (:396).
  // Đây ĐÚNG là cái ô CEO đi tìm 24/10/2026 mà không thấy.
  {
    key: 'fulfillment.logistics',
    label: 'Vận hành — logistics (tracking)',
    actions: ['create', 'edit'],
    nhanHanhDong: { create: 'Tạo vận đơn', edit: 'Chọn line ship' },
  },
  { key: 'fulfillment.warehouse', label: 'Kho MEAN', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'warehouse.receiving', label: 'Kho — Nhập hàng', actions: ['view', 'create', 'edit'] },
  /** `override` = SỬA LẠI kết quả QC người khác đã chốt (quản lý duyệt lại). Tách khỏi
   *  `edit` vì `edit` do cả nhân sự QC nắm — người bấm sai không được tự gỡ cho mình. */
  // Nhãn `override`: quyền cũ `sua_ket_qua_qc`, chỗ kiểm thật là `suaKetQuaQc`
  // (`features/kho-nhan/qc-actions.ts:237`) và ô chọn ở `components/kho-nhan/OSuaQc.tsx`.
  {
    key: 'warehouse.qc',
    label: 'Kho — QC',
    actions: ['view', 'create', 'edit', 'override'],
    nhanHanhDong: { override: 'Sửa đè kết quả QC đã chốt' },
  },
  // Nhãn `create`: quyền cũ `check_packed`, gác `markCheckPacked`
  // (`features/packing/actions.ts:94`) — bước xác nhận BẮT BUỘC trước khi ship kiện.
  // Không phải "tạo" một bản ghi nào, nên ô `Tạo` trần ở đây nói sai việc.
  {
    key: 'fulfillment.pack_check',
    label: 'Vận hành — kiểm tra đóng gói',
    actions: ['view', 'create'],
    nhanHanhDong: { create: 'Xác nhận đã kiểm kiện (check-packed)' },
  },
  { key: 'fulfillment.brand_requests', label: 'Yêu cầu brand', actions: ['view', 'edit'] },
  { key: 'carrier_rates', label: 'Carrier rates', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'carrier_rates.invoices', label: 'Hoá đơn nhà cung cấp', actions: ['view', 'create', 'edit'] },
  { key: 'shipping_reconcile', label: 'Đối soát phí ship', actions: ['view', 'edit'] },
  // Bảng điểm KPI của vị trí logistics: chính nhân sự đó xem kết quả của mình; SỬA số liệu vẫn chỉ quản lý (kiểm
  // trong features/kpi-logistics/actions.ts), nên ở đây chỉ mở action 'view'.
  { key: 'kpi.logistics', label: 'KPI vị trí Logistics', actions: ['view'] },
  { key: 'mmp_products', label: 'Sản phẩm MMP', actions: ['view', 'create', 'edit', 'delete', 'push'] },
  { key: 'functions', label: 'Functions', actions: ['view', 'edit'] },
  // CX — ticket liên bộ phận (bảng `CX - To Do` của Lark). 'edit' là quyền GHI HỘ:
  // người có nó ghi được phần việc của MỌI bộ phận, vì hệ thống chưa có tài khoản
  // cho PROCUREMENT / MERCHANDISE / WAREHOUSE (CEO 27/09/2026).
  { key: 'cx.ticket', label: 'CX — Việc cần làm (ticket)', actions: ['view', 'create', 'edit'] },
  // Tranh chấp / chargeback. Scope RIÊNG, không dùng chung với cx.ticket: đây là
  // tiền, và thường là việc của tài chính chứ không phải CX.
  { key: 'cx.dispute', label: 'CX — Tranh chấp thanh toán', actions: ['view', 'create', 'edit'] },
  // Sự cố + thiệt hại tiền quy về bộ phận. Scope riêng vì là tiền, giống cx.dispute.
  { key: 'cx.incident', label: 'CX — Sự cố & thiệt hại', actions: ['view', 'create', 'edit'] },
  // Đánh giá Trustpilot / Judge.me. Scope riêng vì là DANH TIẾNG, không phải tiền:
  // mở được cho marketing mà không phải mở dữ liệu thiệt hại và tranh chấp.
  { key: 'cx.review', label: 'CX — Đánh giá Trustpilot', actions: ['view', 'create', 'edit'] },
  // Nhật ký thay đổi mức từng ô. CHỈ có action 'view': nhật ký do trigger Postgres ghi,
  // không màn nào sửa hay xoá dòng của nó (dọn dòng cũ là việc của cron giữ 12 tháng).
  { key: 'nhat_ky', label: 'Nhật ký thay đổi', actions: ['view'] },
  // Ba action ở đây KHÔNG theo nghĩa thường: `view` = quyền cũ `view_markets_history`
  // (xem LỊCH SỬ áp dụng), `edit` = `manage_markets_template` (soạn template —
  // `app/(dashboard)/f/markets/page.tsx:35`, `.../markets/new/page.tsx:23`),
  // `apply` = `apply_markets`, tức ĐẨY lên store thật và cũng là quyền gác việc đẩy
  // carrier rate (`features/carrier-rates/push-engine/actions.ts:32`).
  // Xem `lib/auth/permission-map.ts:18-20` cho bản đồ ba quyền cũ này.
  {
    key: 'markets',
    label: 'Markets',
    actions: ['view', 'edit', 'apply'],
    nhanHanhDong: {
      view: 'Xem lịch sử áp market',
      edit: 'Soạn template market',
      apply: 'Đẩy market lên store',
    },
  },
  // settings_sync needs 3 distinct non-apply capabilities to mirror the legacy
  // perms exactly: view=xem lịch sử (view_settings_history), create=quản lý
  // template (manage_settings_template), edit=chạy/dùng sync (run_feature).
  // Nhãn khai đúng bốn quyền cũ nói ở chú thích trên — `create` nghĩa là QUẢN LÝ TEMPLATE
  // (`app/(dashboard)/f/settings-sync/templates/[domain]/edit/page.tsx:42`), không phải tạo
  // một bản ghi nào; `edit` chỉ là quyền VÀO và chạy module (`.../settings-sync/page.tsx:18`).
  // Hai ô này đổi chỗ nhau trong đầu người đọc là cấp sai quyền, nên phải viết ra.
  {
    key: 'settings_sync',
    label: 'Settings Sync',
    actions: ['view', 'create', 'edit', 'apply'],
    nhanHanhDong: {
      view: 'Xem lịch sử áp settings',
      create: 'Quản lý template settings',
      edit: 'Vào & chạy Settings Sync',
      apply: 'Đẩy settings lên store',
    },
  },
  { key: 'ship_ho', label: 'Ship hộ', actions: ['view', 'create', 'edit'] },
  { key: 'kol', label: 'Đơn KOL & chụp đồ', actions: ['view', 'create', 'edit'] },
  { key: 'stores', label: 'Stores', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'users_roles', label: 'Users & Roles', actions: ['view', 'create', 'edit', 'delete'] },
];

export type PermissionKey = string; // `${scope}:${action}`

export function allPermissionKeys(): PermissionKey[] {
  return CATALOG.flatMap((s) => s.actions.map((a) => `${s.key}:${a}`));
}

const VALID = new Set(allPermissionKeys());
export function isValidKey(key: string): boolean {
  return VALID.has(key);
}

/**
 * Nhãn khai cho một action mà phạm vi KHÔNG có trong `actions` — tức nhãn không bao giờ
 * hiện ra ô nào. Trả về danh sách `scope:action` sai, rỗng là sạch.
 *
 * Vì sao cần một hàm riêng thay vì tin vào kiểu: `Partial<Record<Action, string>>` chỉ
 * chặn được tên action lạ, KHÔNG chặn được nhãn khai cho action đúng tên mà phạm vi này
 * không mở (ví dụ gỡ `view` khỏi `fulfillment.logistics` nhưng để lại nhãn `view`). Lúc đó
 * nhãn im lặng biến mất khỏi màn hình — đúng lại cái lỗi "quyền có mà không ai thấy" mà
 * trường này sinh ra để sửa. Test ghim bằng hàm này; chú thích thì không đỏ.
 */
export function nhanHanhDongLac(catalog: readonly ScopeDef[] = CATALOG): string[] {
  const lac: string[] = [];
  for (const s of catalog) {
    if (!s.nhanHanhDong) continue;
    const co = new Set<string>(s.actions);
    for (const a of Object.keys(s.nhanHanhDong)) {
      if (!co.has(a)) lac.push(`${s.key}:${a}`);
    }
  }
  return lac;
}
