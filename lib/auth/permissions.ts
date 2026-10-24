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
   *
   * Luật đặt tên: nhãn phải NÓI ĐỦ phạm vi, không chỉ đúng một phần. Thà dài mà đúng, còn
   * hơn ngắn rồi làm người cấp quyền tưởng phạm vi nhỏ hơn thực tế — `markets:apply` từng
   * ghi "Đẩy market lên store" trong khi nó còn gác cả việc đẩy carrier rate và shipping
   * profile lên store THẬT, tức nhãn hẹp đang mời người ta tự tin cấp nhầm.
   */
  nhanHanhDong?: Partial<Record<Action, string>>;
  /**
   * Khoá PHẢI tích KÈM thì ô này mới có tác dụng.
   *
   * Vì sao có: shim tương thích `hasPermission()` kiểm bằng `.every()`
   * (`lib/auth/rbac.ts:131`), nên một quyền cũ ánh xạ sang NHIỀU khoá chỉ mở ra việc khi
   * tích ĐỦ cả chùm. Ví dụ `manage_fulfillment` = `fulfillment.operations:edit` **và**
   * `fulfillment.brand_requests:edit`; tích riêng một ô là ô đó KHÔNG mở ra gì cả.
   *
   * Tách khỏi `nhanHanhDong` chứ không nhét chung một chuỗi: "ô này nghĩa là gì" và "ô này
   * cần ô nào nữa" là hai sự thật khác loại, trộn vào nhau thì câu nào cũng nửa vời. Khai
   * bằng KHOÁ (không phải chữ mô tả) để `canKemLac()` kiểm được là khoá có thật, và để màn
   * hình tự dựng chữ từ chính danh mục — chữ chép tay sẽ lệch khi phạm vi đổi tên.
   */
  canKem?: Partial<Record<Action, readonly PermissionKey[]>>;
}

export const CATALOG: ScopeDef[] = [
  // `edit` KHÔNG phải "sửa đơn hàng": nó là quyền cũ `manage_sku_costs`, gác ĐỦ BA chỗ —
  // trang nhập CSV giá vốn SKU (`app/(dashboard)/f/orders/[storeId]/costs/page.tsx:22`,
  // cùng nút vào trang đó ở `.../[storeId]/page.tsx:201`), cờ `canEdit` của bảng đơn
  // (`.../[storeId]/page.tsx:239`), và `updateOrderOverrides` — ghi đè phí ship VÀ trọng
  // lượng cân lại (`features/shopify-orders/order-actions.ts:497`).
  // Tỷ giá/phí đóng gói của store thì KHÔNG: cái đó gác `manage_stores` (`:191`).
  {
    key: 'orders',
    label: 'Đơn hàng',
    actions: ['view', 'edit'],
    nhanHanhDong: { edit: 'Nhập giá vốn SKU, ghi đè phí ship & trọng lượng đơn' },
  },
  { key: 'orders.cogs', label: 'Đơn hàng — Giá vốn & lãi gộp', actions: ['view', 'edit'] },
  /* `edit` là MỘT NỬA của quyền cũ `manage_fulfillment` (`lib/auth/permission-map.ts:40`),
   * và shim kiểm bằng `.every()` — tích riêng ô này KHÔNG mở ra việc gì, phải có kèm
   * `fulfillment.brand_requests:edit`. Đó là lý do có `canKem` bên dưới: nhãn cũ
   * ("Quản lý đóng hàng") hứa một thứ mà ô đó một mình không làm được.
   *
   * Nó cũng rộng hơn "đóng hàng" nhiều. Chỗ kiểm thật, đã đếm đủ:
   *  - đóng/mở kiện `features/dong-hang/actions.ts:99`, ghi đóng thùng `:184`,
   *    danh mục box `luuBox`/`anBox` `:247, :300`;
   *  - `createPack`/`shipPack` `features/packing/actions.ts:38, 108`,
   *    `features/packing/shopify-actions.ts:17`;
   *  - vòng đời đơn + SLA `features/lifecycle/sla-actions.ts:15`,
   *    `app/(dashboard)/f/lifecycle/sla/page.tsx:18`, `.../lifecycle/[orderId]/page.tsx:62`;
   *  - yêu cầu brand `features/fulfillment/brand-actions.ts:15`;
   *  - ĐẨY ĐƠN SANG MMP + backfill `features/mmp/order-push-query.ts:27`,
   *    `features/mmp/order-backfill.ts:38`, `app/(dashboard)/f/fulfillment/page.tsx:73-74`;
   *  - `features/fulfillment/actions.ts:127, 267, 282, 303, 311, 320`. */
  {
    key: 'fulfillment.operations',
    label: 'Vận hành — thao tác (pick/pack/ship)',
    actions: ['view', 'edit'],
    nhanHanhDong: {
      edit: 'Quản lý vận hành đơn: đóng/mở kiện, danh mục box, SLA, đẩy đơn sang MMP',
    },
    canKem: { edit: ['fulfillment.brand_requests:edit'] },
  },
  // Chỉ còn `create` (nhập mã vận đơn — `tao_van_don`) và `edit` (chọn line ship —
  // `chon_line_ship`). Bỏ `view` và `delete` ngày 21/10/2026: KHÔNG chỗ nào trong hệ thống
  // kiểm chúng, nên trên màn Roles & Permissions chúng là hai ô tích được mà không mở ra
  // việc gì — một checkbox nói sai còn tệ hơn không có ô nào. Dòng `role_permissions` mồ côi
  // của hai khoá này dọn bằng `scripts/quyen-tao-van-don.ts --don-o-chet`.
  /* `create` = quyền cũ `tao_van_don`: gác CẢ hai bước phân tích và ghi mã vận đơn
   * (`features/dong-hang/actions.ts:439`, `:629`) cùng cờ `coQuyenVanDon` của màn Đóng hàng
   * (`app/(dashboard)/f/dong-hang/page.tsx:52`). Đây đúng là ô CEO đi tìm 24/10/2026 mà
   * không thấy, nên chữ "Tạo vận đơn" phải đứng ĐẦU nhãn để Ctrl+F ra ngay.
   *
   * `edit` = quyền cũ `chon_line_ship`, gác HAI việc chứ không một: chọn hãng cho đơn
   * (`:88`) và verify địa chỉ đơn trên màn Đóng hàng (`:396` — cố ý tách khỏi
   * `verifyOrderAddressAction` của `features/fulfillment` vì hàm đó đòi `manage_fulfillment`
   * mà vai `logistics` không có). */
  {
    key: 'fulfillment.logistics',
    label: 'Vận hành — logistics (tracking)',
    actions: ['create', 'edit'],
    nhanHanhDong: {
      create: 'Tạo vận đơn — nhập mã trên màn Đóng hàng',
      edit: 'Chọn line ship & verify địa chỉ đơn',
    },
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
  /* Nhãn `create`: quyền cũ `check_packed`, gác `markCheckPacked`
   * (`features/packing/actions.ts:94`) và cờ `canCheckPacked` của màn vòng đời đơn
   * (`app/(dashboard)/f/lifecycle/[orderId]/page.tsx:63`) — bước xác nhận BẮT BUỘC trước
   * khi ship kiện. Không phải "tạo" một bản ghi nào, nên ô `Tạo` trần ở đây nói sai việc.
   *
   * `canKem`: `check_packed` ánh xạ sang CẢ `:view` và `:create`
   * (`lib/auth/permission-map.ts:51`), mà shim kiểm `.every()` — tích riêng `:create` là
   * không bấm được nút nào. */
  {
    key: 'fulfillment.pack_check',
    label: 'Vận hành — kiểm tra đóng gói',
    actions: ['view', 'create'],
    nhanHanhDong: { create: 'Xác nhận đã kiểm kiện (check-packed)' },
    canKem: { create: ['fulfillment.pack_check:view'] },
  },
  /* `edit` là NỬA KIA của `manage_fulfillment` (xem `fulfillment.operations` ở trên): nó
   * không mở riêng việc gì của màn Yêu cầu brand — chính màn đó
   * (`app/(dashboard)/f/fulfillment/brand-requests/page.tsx:61`) và `brand-actions.ts:15`
   * đều kiểm `manage_fulfillment`, tức đòi đủ cả hai ô. */
  {
    key: 'fulfillment.brand_requests',
    label: 'Yêu cầu brand',
    actions: ['view', 'edit'],
    nhanHanhDong: { edit: 'Duyệt & sửa yêu cầu brand' },
    canKem: { edit: ['fulfillment.operations:edit'] },
  },
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
  /* Ba action ở đây KHÔNG theo nghĩa thường, và cả ba đều RỘNG HƠN tên module.
   * Bản đồ quyền cũ: `lib/auth/permission-map.ts:18-20`.
   *
   * `view` = `view_markets_history`. Không chỉ lịch sử: nó là cửa vào CẢ module Markets
   * (`app/(dashboard)/f/markets/page.tsx:20`, `.../[handle]/page.tsx:31`,
   * `.../markets/history/page.tsx:21`, thẻ ở `app/(dashboard)/page.tsx:50`,
   * `lib/nav.ts:90-91`) VÀ màn Manual Shipping Rates
   * (`app/(dashboard)/f/functions/manual-shipping-rates/page.tsx:27`,
   * khối ở `.../f/functions/page.tsx:136`).
   *
   * `edit` = `manage_markets_template`: tạo market mới (`.../markets/new/page.tsx:23`) và
   * sửa template (`.../markets/page.tsx:25, 35`, `.../[handle]/page.tsx:38, 57`).
   *
   * ⚠ `apply` = `apply_markets` là ô NGUY HIỂM NHẤT của bảng này, và nhãn cũ
   * ("Đẩy market lên store") hẹp theo đúng hướng nguy hiểm: admin tích vì tưởng chỉ đụng
   * market, trong khi cùng ô đó mở ra việc ĐẨY GIÁ VẬN CHUYỂN lên store thật. Đếm đủ:
   *  - áp market lên store `app/(dashboard)/f/markets/apply/page.tsx:19`,
   *    `.../markets/[handle]/stores/[storeId]/page.tsx:25`;
   *  - đẩy carrier rate `features/carrier-rates/push-engine/actions.ts:32` + trang
   *    `app/(dashboard)/f/carrier-rates/[id]/push/page.tsx:37, 45`;
   *  - đăng ký carrier service lên store `features/carrier-rates/carrier-service-actions.ts:44`;
   *  - ghi shipping profile `features/settings-sync/shipping-profiles-actions.ts:38`;
   *  - seed bảng shipping hệ thống `features/markets/system-shipping.ts:17`;
   *  - áp Manual Shipping Rates `.../f/functions/manual-shipping-rates/page.tsx:30`. */
  {
    key: 'markets',
    label: 'Markets',
    actions: ['view', 'edit', 'apply'],
    nhanHanhDong: {
      view: 'Vào Markets + Manual Shipping Rates (kèm lịch sử áp dụng)',
      edit: 'Tạo & sửa template market',
      apply: 'Đẩy lên store THẬT: market, carrier rate, carrier service, shipping profile',
    },
  },
  // settings_sync needs 3 distinct non-apply capabilities to mirror the legacy
  // perms exactly: view=xem lịch sử (view_settings_history), create=quản lý
  // template (manage_settings_template), edit=chạy/dùng sync (run_feature).
  /* Nhãn khai đúng bốn quyền cũ nói ở chú thích trên. Chỗ kiểm thật, đã đếm đủ:
   *  - `view` = `view_settings_history`: `app/(dashboard)/f/settings-sync/history/page.tsx:21`,
   *    `lib/nav.ts:89`.
   *  - `create` = `manage_settings_template` — QUẢN LÝ TEMPLATE, không phải tạo bản ghi nào:
   *    `.../settings-sync/templates/page.tsx:32`, `.../templates/[domain]/edit/page.tsx:42`.
   *  - `edit` = `run_feature`: cửa vào module, và KHÔNG chỉ Settings Sync — nó mở cả
   *    Settings Viewer (`lib/nav.ts:87-88`, `.../settings-sync/page.tsx:18`,
   *    thẻ ở `app/(dashboard)/page.tsx:61`).
   *  - `apply` = `apply_settings` **và** `reconcile_store` (hai quyền cũ, cùng một khoá —
   *    `lib/auth/permission-map.ts:14-15`). Nên ô này không chỉ "đẩy": nó mở luôn sửa
   *    override (`.../settings-sync/stores/[id]/overrides/[domain]/page.tsx:22, 39, 58`),
   *    reconcile (`.../settings-sync/reconcile/[storeId]/[domain]/page.tsx:96`) và
   *    ROLLBACK một lượt đã áp (`.../settings-sync/history/[runId]/page.tsx:48`).
   *
   * `create` và `edit` đổi chỗ nhau trong đầu người đọc là cấp sai quyền, nên phải viết ra. */
  {
    key: 'settings_sync',
    label: 'Settings Sync',
    actions: ['view', 'create', 'edit', 'apply'],
    nhanHanhDong: {
      view: 'Xem lịch sử áp settings',
      create: 'Quản lý template settings',
      edit: 'Vào module Settings Sync & Settings Viewer',
      apply: 'Đẩy settings lên store THẬT: áp dụng, reconcile, sửa override, rollback',
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
/**
 * Khai `canKem` hỏng: khai cho action mà phạm vi không có, trỏ tới khoá không tồn tại trong
 * danh mục, hoặc trỏ về CHÍNH nó. Trả về `scope:action -> khoá` sai, rỗng là sạch.
 *
 * Vì sao cần: dòng "cần kèm" trên màn hình được dựng TỪ danh mục, nên một khoá chết hiện ra
 * là một chỉ dẫn sai cho người đang cấp quyền — tệ hơn im lặng, vì họ sẽ đi tích đúng cái
 * được bảo mà vẫn không mở ra việc gì.
 */
export function canKemLac(catalog: readonly ScopeDef[] = CATALOG): string[] {
  const hopLe = new Set(catalog.flatMap((s) => s.actions.map((a) => `${s.key}:${a}`)));
  const lac: string[] = [];
  for (const s of catalog) {
    if (!s.canKem) continue;
    const co = new Set<string>(s.actions);
    for (const [a, keys] of Object.entries(s.canKem)) {
      const tu = `${s.key}:${a}`;
      if (!co.has(a)) { lac.push(`${tu} -> (action không có)`); continue; }
      for (const k of keys ?? []) {
        if (k === tu || !hopLe.has(k)) lac.push(`${tu} -> ${k}`);
      }
    }
  }
  return lac;
}

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
