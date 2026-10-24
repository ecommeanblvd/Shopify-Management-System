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
  /* `edit` KHÔNG phải "sửa đơn hàng": nó là quyền cũ `manage_sku_costs`. Đếm đủ chỗ kiểm:
   *  - MỞ CHI TIẾT ĐƠN: cờ `canEdit` xuống `OrdersTable`, và `openRow` chặn ngay đầu hàm
   *    (`components/shopify-orders/OrdersTable.tsx:142`) — `app/(dashboard)/f/orders/[storeId]/page.tsx:239`.
   *    Hạt giống vai `logistics` nói đúng điều này: "Chi tiết đơn (modal) vẫn cần
   *    manage_sku_costs nên logistics chỉ xem, không mở chi tiết" (`permission-map.ts:124`).
   *  - trang nhập CSV giá vốn SKU (`.../[storeId]/costs/page.tsx:22`) + nút vào (`:201`);
   *  - `updateOrderOverrides` — ghi đè phí ship VÀ trọng lượng cân lại
   *    (`features/shopify-orders/order-actions.ts:497`).
   * Tỷ giá/phí đóng gói của store thì KHÔNG: cái đó gác `manage_stores` (`:191`).
   *
   * Vì sao "mở chi tiết đơn" phải đứng ĐẦU nhãn: rủi ro của ô này đi NGƯỢC chiều
   * `markets:apply`. Ở đó nhãn hẹp làm người ta TÍCH nhầm; ở đây nhãn hẹp làm người ta BỎ
   * TÍCH vì tưởng chỉ gỡ quyền nhập giá vốn, rồi chặn luôn việc mở chi tiết đơn của cả vai. */
  {
    key: 'orders',
    label: 'Đơn hàng',
    actions: ['view', 'edit'],
    nhanHanhDong: {
      edit: 'Mở chi tiết đơn, nhập giá vốn SKU, ghi đè phí ship & trọng lượng',
    },
  },
  /* `view` = quyền cũ `view_cogs`, ĐỨNG MỘT MÌNH CÓ TÁC DỤNG nên KHÔNG khai `canKem`:
   *  - màn Lãi gộp `app/(dashboard)/f/orders/lai-gop/page.tsx:32` + nút vào ở
   *    `app/(dashboard)/f/orders/page.tsx:31`;
   *  - hai route xuất CSV `.../lai-gop/bang-thang.csv/route.ts:28`,
   *    `.../lai-gop/chua-co-gia-von.csv/route.ts:22`;
   *  - và nó là quyền MỞ MẶT giá vốn mức đơn trong NHẬT KÝ (`shipping_cost_override`,
   *    `cost_override` — `features/nhat-ky/che-gia-tri.ts:125-139`). Mẩu "nhật ký" phải có
   *    trong nhãn: bỏ tích ô này là che cả cột giá trị ở một module KHÁC, chỗ không ai nghĩ
   *    tới khi đang đứng ở hàng "Đơn hàng".
   *
   * `edit` = `manage_cogs`, và chùm là `view` + `edit` (`lib/auth/permission-map.ts:62`) nên
   * `edit` một mình KHÔNG mở ra gì → `canKem`. Chỗ kiểm thật:
   *  - áp bảng kê giá vốn brand `features/cogs/actions.ts:30, 39`;
   *  - tỉ giá USD→VND theo tháng `:52, :68` + form ở `components/cogs/TiGiaForm.tsx:22`;
   *  - ước giá vốn dự tính theo store `:102`, phân bổ PO theo brand `:123`;
   *  - trang Bảng kê brand `app/(dashboard)/f/orders/cogs/bang-ke/page.tsx:17`. */
  {
    key: 'orders.cogs',
    label: 'Đơn hàng — Giá vốn & lãi gộp',
    actions: ['view', 'edit'],
    nhanHanhDong: {
      view: 'Vào màn Lãi gộp & tải CSV lãi gộp; mở mặt giá vốn mức đơn trong nhật ký',
      edit: 'Áp bảng kê giá vốn brand, tỉ giá USD→VND theo tháng, ước giá vốn dự tính, phân bổ PO',
    },
    canKem: { edit: ['orders.cogs:view'] },
  },
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
  /* CẢ BỐN ô là MỘT quyền cũ duy nhất: `manage_warehouse`
   * (`lib/auth/permission-map.ts:41`). Shim kiểm `.every()` nên tích ba ô, tích một ô, hay
   * tích sai ô nào cũng là KHÔNG mở ra gì — vì vậy cả bốn mang CÙNG một nhãn và mỗi ô khai
   * `canKem` ba ô kia. Nhãn khác nhau theo cột sẽ nói dối: ở đây không có "chỉ xem" và cũng
   * không có "chỉ xoá".
   *
   * Lưu ý ô `view` KHÔNG phải cửa vào màn kho: màn `/f/warehouse` gác bằng `view_fulfillment`
   * (`app/(dashboard)/f/warehouse/page.tsx:18`), không phải quyền này.
   *
   * Chỗ kiểm thật, đã đếm đủ:
   *  - thêm/sửa SKU & vị trí `features/fulfillment/warehouse-actions.ts:39` (nút "+ Thêm SKU"
   *    và form ở `components/fulfillment/WarehouseBoard.tsx:209, 220`);
   *  - điều chỉnh tồn `:87` và chuyển kho `:131` (hai nút ở `WarehouseBoard.tsx:415`);
   *  - bổ sung ảnh hàng đến / biên bản / ảnh lỗi vào Sổ nhập Lark
   *    `features/kho-nhan/bo-sung-anh-actions.ts:37`;
   *  - cờ `canManage` của màn Kho MEAN `app/(dashboard)/f/warehouse/page.tsx:26`. */
  {
    key: 'fulfillment.warehouse',
    label: 'Kho MEAN',
    actions: ['view', 'create', 'edit', 'delete'],
    nhanHanhDong: {
      view: 'Ghi kho MEAN: thêm/sửa SKU & vị trí, điều chỉnh tồn, chuyển kho, bổ sung ảnh & biên bản vào Sổ nhập',
      create: 'Ghi kho MEAN: thêm/sửa SKU & vị trí, điều chỉnh tồn, chuyển kho, bổ sung ảnh & biên bản vào Sổ nhập',
      edit: 'Ghi kho MEAN: thêm/sửa SKU & vị trí, điều chỉnh tồn, chuyển kho, bổ sung ảnh & biên bản vào Sổ nhập',
      delete: 'Ghi kho MEAN: thêm/sửa SKU & vị trí, điều chỉnh tồn, chuyển kho, bổ sung ảnh & biên bản vào Sổ nhập',
    },
    canKem: {
      view: ['fulfillment.warehouse:create', 'fulfillment.warehouse:edit', 'fulfillment.warehouse:delete'],
      create: ['fulfillment.warehouse:view', 'fulfillment.warehouse:edit', 'fulfillment.warehouse:delete'],
      edit: ['fulfillment.warehouse:view', 'fulfillment.warehouse:create', 'fulfillment.warehouse:delete'],
      delete: ['fulfillment.warehouse:view', 'fulfillment.warehouse:create', 'fulfillment.warehouse:edit'],
    },
  },
  /* `view` = quyền cũ `view_receiving` và ĐỨNG MỘT MÌNH CÓ TÁC DỤNG → KHÔNG khai `canKem`.
   * Nó rộng hơn hẳn tên hàng: là cửa vào SÁU tab của module Kho
   * (`app/(dashboard)/f/warehouse/layout.tsx:24, 33`) cùng các màn Nhận & kiểm hàng
   * (`.../nhan-kcs/page.tsx:18`, `.../nhan-kcs/tem/page.tsx:22`,
   * `.../nhan-kcs/bien-ban/page.tsx:16`), Đóng hàng (`.../dong-goi/page.tsx:23`),
   * Sổ nhập & đối chiếu (`.../dong-bo/page.tsx:27`), Phiếu nhập (`.../receiving/page.tsx:46`,
   * `.../receiving/[id]/page.tsx:47`, `.../receiving/tem/page.tsx:85`), Chờ KCS
   * (`.../warehouse/qc/page.tsx:16`) và ảnh Lark (`app/api/kho-nhan/anh-lark/[token]/route.ts:30`).
   *
   * `create`/`edit` là hai PHẦN của `manage_receiving`, mà chùm đó còn gồm cả `:view`
   * (`lib/auth/permission-map.ts:43`) — nên mỗi ô khai kèm HAI ô kia. Chỗ kiểm thật:
   *  - tạo phiếu nhập + dòng hàng + ảnh phiếu `features/receiving/actions.ts:24, 42, 70`;
   *  - mở phiếu theo brand, in tem từng món, nhận hàng ngoài kế hoạch, xác nhận quét
   *    `features/receiving/nhan-nhanh-actions.ts:38, 48, 88, 111`;
   *  - màn Quét nhập nhanh `app/(dashboard)/f/warehouse/receiving/quet/page.tsx:15`;
   *  - cờ `canReceive` của hai màn phiếu nhập `.../receiving/page.tsx:49`,
   *    `.../receiving/[id]/page.tsx:50`. */
  {
    key: 'warehouse.receiving',
    label: 'Kho — Nhập hàng',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào module Kho: Nhận & kiểm hàng, Đóng hàng, Sổ nhập & đối chiếu, Phiếu nhập, Nhập nhanh, Chờ KCS, Tem',
      create: 'Ghi nhập hàng: tạo phiếu & dòng hàng, ảnh phiếu, in tem từng món, nhận ngoài kế hoạch, màn Quét nhập nhanh',
      edit: 'Ghi nhập hàng: tạo phiếu & dòng hàng, ảnh phiếu, in tem từng món, nhận ngoài kế hoạch, màn Quét nhập nhanh',
    },
    canKem: {
      create: ['warehouse.receiving:view', 'warehouse.receiving:edit'],
      edit: ['warehouse.receiving:view', 'warehouse.receiving:create'],
    },
  },
  /** `override` = SỬA LẠI kết quả QC người khác đã chốt (quản lý duyệt lại). Tách khỏi
   *  `edit` vì `edit` do cả nhân sự QC nắm — người bấm sai không được tự gỡ cho mình. */
  // Nhãn `override`: quyền cũ `sua_ket_qua_qc`, chỗ kiểm thật là `suaKetQuaQc`
  // (`features/kho-nhan/qc-actions.ts:237`) và ô chọn ở `components/kho-nhan/OSuaQc.tsx`.
  /* `view`/`create`/`edit` là MỘT quyền cũ duy nhất — `manage_qc`
   * (`lib/auth/permission-map.ts:45`) — nên cả ba mang CÙNG nhãn và mỗi ô khai kèm hai ô kia.
   *
   * ⚠ Vì sao `:view` CŨNG phải khai `canKem`, khác với `warehouse.receiving:view` /
   * `ship_ho:view` / `kol:view` / `cx.*:view` / `orders.cogs:view` (những ô đó ĐỨNG MỘT MÌNH
   * CÓ TÁC DỤNG nên cố ý KHÔNG khai): `warehouse.qc:view` tuy có quyền cũ đứng riêng là
   * `view_qc` (`permission-map.ts:44`), nhưng `view_qc` KHÔNG ĐƯỢC KIỂM Ở BẤT KỲ ĐÂU trong
   * app — soát toàn repo 24/10/2026, chỉ còn trong danh sách `Permission` của
   * `lib/auth/rbac.ts:43`, trong bản đồ, và trong hạt giống `OPERATOR_OLD`. Mọi màn QC gác
   * bằng `view_receiving` (`app/(dashboard)/f/warehouse/qc/page.tsx:16`,
   * `features/kho-nhan/qc-actions.ts:156`), KHÔNG phải `view_qc`. Nên tích `:view` một mình
   * thật sự không mở ra gì, và im lặng ở đây là nói dối đúng cái kiểu `canKem` sinh ra để
   * chặn. (Ô `fulfillment.pack_check:view` ở trên cùng cảnh ngộ — xem báo cáo.)
   *
   * Chỗ kiểm thật của `manage_qc`, đã đếm đủ:
   *  - QC đạt / không đạt / thêm dòng lỗi / đặt cân từng chiếc
   *    `features/kho-nhan/qc-actions.ts:24, 65, 118, 205` + `features/receiving/actions.ts:94`;
   *  - ghi nhận từng chiếc theo dòng / PO / món Lark / hàng trả, gỡ chiếc nhận nhầm, xoá
   *    chiếc, huỷ nhập chưa gửi `features/kho-nhan/nhan-actions.ts:49, 139, 209, 281, 365, 407, 422`;
   *  - ghi nhận KCS + đẩy lại dòng lỗi `features/kho-nhan/actions.ts:16, 72`;
   *  - đóng kiện + thêm/xoá ảnh kiện `features/dong-goi/actions.ts:37, 137, 161`;
   *  - ảnh phiếu nhận `features/kho-nhan/anh-nhan.ts:21, 56`, đánh dấu đã in tem
   *    `features/kho-nhan/tem-actions.ts:29`;
   *  - đẩy / gỡ khỏi Lark WH `features/kho-nhan/day-wh-lark.ts:49, 217`;
   *  - đánh dấu đã lập biên bản trả brand `features/kho-nhan/bien-ban.ts:75`;
   *  - cờ `canQc` của hai màn `app/(dashboard)/f/warehouse/qc/page.tsx:19`,
   *    `.../receiving/[id]/page.tsx:51`. */
  {
    key: 'warehouse.qc',
    label: 'Kho — QC',
    actions: ['view', 'create', 'edit', 'override'],
    nhanHanhDong: {
      view: 'Ghi QC & nhận từng chiếc: QC đạt/không đạt + dòng lỗi, cân chiếc, nhận/gỡ/xoá chiếc, đóng kiện & ảnh, in tem, đẩy Lark WH, biên bản trả brand',
      create: 'Ghi QC & nhận từng chiếc: QC đạt/không đạt + dòng lỗi, cân chiếc, nhận/gỡ/xoá chiếc, đóng kiện & ảnh, in tem, đẩy Lark WH, biên bản trả brand',
      edit: 'Ghi QC & nhận từng chiếc: QC đạt/không đạt + dòng lỗi, cân chiếc, nhận/gỡ/xoá chiếc, đóng kiện & ảnh, in tem, đẩy Lark WH, biên bản trả brand',
      override: 'Sửa đè kết quả QC đã chốt',
    },
    canKem: {
      view: ['warehouse.qc:create', 'warehouse.qc:edit'],
      create: ['warehouse.qc:view', 'warehouse.qc:edit'],
      edit: ['warehouse.qc:view', 'warehouse.qc:create'],
    },
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
  /* `view` = quyền cũ `view_carrier_rates` ĐỨNG RIÊNG (`permission-map.ts:22`), KHÔNG thuộc
   * chùm bên dưới — nên nó không khai `canKem`, và cố ý CHƯA đặt nhãn ở lượt này (nó gác
   * nhiều cửa ngoài module: Đối soát phí ship, Báo cáo ship, `lib/nav.ts:60-61`).
   *
   * `create`/`edit`/`delete` là MỘT quyền cũ duy nhất: `manage_carrier_rates`
   * (`permission-map.ts:21`) — ba ô cùng nhãn, mỗi ô khai kèm hai ô kia.
   *
   * Nhãn phải NÓI ĐỦ, vì quyền này rộng hơn "sửa bảng giá" theo đúng hướng nguy hiểm:
   *  - tạo/sửa bảng giá + zone + bậc cân + workspace + remote postcode
   *    `app/(dashboard)/f/carrier-rates/new/page.tsx:33`, `.../[id]/page.tsx:53`,
   *    `.../[id]/zones/page.tsx:72`, `.../[id]/weight-tiers/page.tsx:49`,
   *    `.../[id]/workspace/page.tsx:52`, `.../[id]/remote-postcodes/page.tsx:98`,
   *    `features/carrier-rates/rate-cards-actions.ts:88`,
   *    `features/carrier-rates/rate-card-upload-actions.ts:47, 85`;
   *  - phụ phí, kèm tự lấy fuel của hãng và seed bảng Demand FedEx VN
   *    `.../[id]/surcharges/page.tsx:366, 386, 404`;
   *  - ⚠ CHIA SẺ TỆP BẰNG CHỨNG VÙNG XA RA NGOÀI cho brand — "bật cờ này là ĐẨY MỘT TỆP RA
   *    NGOÀI công ty" (`features/carrier-rates/postcodes-actions.ts:305, 310`);
   *  - ⚠ ghi THANH TOÁN hoá đơn carrier: ô này gác `payments`/xoá của màn hoá đơn, tách khỏi
   *    quyền nhập hoá đơn (`.../[id]/bills/page.tsx:47-50, 194`);
   *  - ⚠ NỐI carrier account vào market (thêm/xoá/bật-tắt) ở một module KHÁC —
   *    `app/(dashboard)/f/markets/[handle]/page.tsx:67, 80, 90`;
   *  - và cùng `markets:apply` thì đẩy bảng giá lên store THẬT
   *    (`.../[id]/push/page.tsx:37, 45` — đòi CẢ HAI quyền). */
  {
    key: 'carrier_rates',
    label: 'Carrier rates',
    actions: ['view', 'create', 'edit', 'delete'],
    nhanHanhDong: {
      create: 'Bảng giá carrier: tạo/sửa, zone, bậc cân, phụ phí & fuel; nối carrier vào market; ghi thanh toán hoá đơn; chia sẻ tệp bằng chứng vùng xa RA NGOÀI cho brand',
      edit: 'Bảng giá carrier: tạo/sửa, zone, bậc cân, phụ phí & fuel; nối carrier vào market; ghi thanh toán hoá đơn; chia sẻ tệp bằng chứng vùng xa RA NGOÀI cho brand',
      delete: 'Bảng giá carrier: tạo/sửa, zone, bậc cân, phụ phí & fuel; nối carrier vào market; ghi thanh toán hoá đơn; chia sẻ tệp bằng chứng vùng xa RA NGOÀI cho brand',
    },
    canKem: {
      create: ['carrier_rates:edit', 'carrier_rates:delete'],
      edit: ['carrier_rates:create', 'carrier_rates:delete'],
      delete: ['carrier_rates:create', 'carrier_rates:edit'],
    },
  },
  /* CẢ BA ô là MỘT quyền cũ duy nhất: `manage_shipping_invoices`
   * (`lib/auth/permission-map.ts:25`). Không có quyền cũ nào ánh xạ riêng `:view`, nên ô
   * `Xem` ở hàng này cũng tích-một-mình-không-mở-ra-gì → cả ba đều khai `canKem`.
   *
   * Nhãn phải nói ra cả phần KPI: quyền này là "vị trí đang làm đối soát" (CEO 16/09/2026),
   * nên nó gác luôn hai bài KPI của logistics — người gỡ tích vì tưởng chỉ gỡ quyền nhập hoá
   * đơn sẽ chặn luôn việc nộp bài của cả vai. Chỗ kiểm thật, đã đếm đủ:
   *  - tải CSV hoá đơn cước toàn hệ thống + theo store
   *    `app/(dashboard)/f/orders/shipping-invoices/page.tsx:24, 57`,
   *    `.../[storeId]/shipping-invoices/page.tsx:23`, nút vào ở `.../f/orders/page.tsx:30`;
   *  - thêm/nhập hoá đơn & credit note của một carrier
   *    `app/(dashboard)/f/carrier-rates/[id]/bills/page.tsx:50, 133, 143`,
   *    `features/carrier-rates/ap/credit-note-import.ts:48`;
   *  - đối soát hoá đơn DHL `features/carrier-rates/ap/dhl-reconcile-actions.ts:24`;
   *  - gán lý do giao chậm `features/shipments/ly-do-actions.ts:21` + cờ `ganLyDoDuoc`
   *    `app/(dashboard)/f/ship-report/page.tsx:176`;
   *  - KPI tiêu chí 1.1 — giải trình đơn âm cước `features/kpi-logistics/giai-trinh-actions.ts:20`;
   *  - KPI tiêu chí 1.2 — GỬI lý do giao chậm theo kỳ `features/kpi-logistics/nop-1-2-actions.ts:25`
   *    (duyệt/trả lại thì CHỈ admin, không phải quyền này — `:33`). */
  {
    key: 'carrier_rates.invoices',
    label: 'Hoá đơn nhà cung cấp',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Hoá đơn & đối soát cước: tải CSV hoá đơn, credit note, đối soát DHL, gán lý do giao chậm, nộp KPI 1.1 & 1.2',
      create: 'Hoá đơn & đối soát cước: tải CSV hoá đơn, credit note, đối soát DHL, gán lý do giao chậm, nộp KPI 1.1 & 1.2',
      edit: 'Hoá đơn & đối soát cước: tải CSV hoá đơn, credit note, đối soát DHL, gán lý do giao chậm, nộp KPI 1.1 & 1.2',
    },
    canKem: {
      view: ['carrier_rates.invoices:create', 'carrier_rates.invoices:edit'],
      create: ['carrier_rates.invoices:view', 'carrier_rates.invoices:edit'],
      edit: ['carrier_rates.invoices:view', 'carrier_rates.invoices:create'],
    },
  },
  { key: 'shipping_reconcile', label: 'Đối soát phí ship', actions: ['view', 'edit'] },
  // Bảng điểm KPI của vị trí logistics: chính nhân sự đó xem kết quả của mình; SỬA số liệu vẫn chỉ quản lý (kiểm
  // trong features/kpi-logistics/actions.ts), nên ở đây chỉ mở action 'view'.
  { key: 'kpi.logistics', label: 'KPI vị trí Logistics', actions: ['view'] },
  /* `view` = `view_mmp_products` đứng riêng (`permission-map.ts:28`), không thuộc chùm —
   * chưa đặt nhãn ở lượt này.
   *
   * `create`/`edit`/`delete`/`push` là MỘT quyền cũ duy nhất: `manage_mmp_products`
   * (`permission-map.ts:29`), nên bốn ô cùng nhãn + kèm lẫn nhau.
   *
   * ⚠ Nhãn ở đây phải nói NGƯỢC lại tên cột, vì tên cột đang hứa thừa. Soát toàn bộ app
   * 24/10/2026, `manage_mmp_products` chỉ gác HAI chỗ:
   *  - cờ `canManage` của `BrandStatusControl` — đổi trạng thái brand (active/deactive/
   *    archived, kéo theo `curation_status` của mọi sản phẩm brand đó)
   *    `app/(dashboard)/f/mmp/[brandSlug]/page.tsx:83, 123`;
   *  - một ô chữ "Curation actions coming soon" ở màn chi tiết sản phẩm
   *    `app/(dashboard)/f/mmp/[brandSlug]/[portalProductId]/page.tsx:54, 80` — CHƯA làm.
   * Không có tạo / sửa / xoá sản phẩm, và `push` KHÔNG đẩy gì lên Shopify.
   *
   * Việc nó gác thì NHỎ nhưng KHÔNG nhẹ, nên nhãn nói ra phần lan toả: `archived` ép TOÀN BỘ
   * sản phẩm của brand sang `archived`, `deactive` ép mọi sản phẩm `approved` về `draft`
   * (`features/mmp/brand-actions.ts:40-54`) — một lệnh, không hoàn tác.
   *
   * (Tới 24/10/2026 nhãn này còn phải ghi "chỉ ẩn/hiện nút, server action chưa kiểm quyền",
   * vì `setBrandStatus` không có dòng kiểm quyền nào. Đã vá: cổng `requirePerm` nằm trong
   * chính hàm đó, nên nhãn hết phải nói hộ một lỗ.) */
  {
    key: 'mmp_products',
    label: 'Sản phẩm MMP',
    actions: ['view', 'create', 'edit', 'delete', 'push'],
    nhanHanhDong: {
      create: 'Đổi trạng thái brand MMP (archived ép MỌI sản phẩm của brand về archived, không hoàn tác). KHÔNG tạo/sửa/xoá sản phẩm, KHÔNG đẩy lên Shopify',
      edit: 'Đổi trạng thái brand MMP (archived ép MỌI sản phẩm của brand về archived, không hoàn tác). KHÔNG tạo/sửa/xoá sản phẩm, KHÔNG đẩy lên Shopify',
      delete: 'Đổi trạng thái brand MMP (archived ép MỌI sản phẩm của brand về archived, không hoàn tác). KHÔNG tạo/sửa/xoá sản phẩm, KHÔNG đẩy lên Shopify',
      push: 'Đổi trạng thái brand MMP (archived ép MỌI sản phẩm của brand về archived, không hoàn tác). KHÔNG tạo/sửa/xoá sản phẩm, KHÔNG đẩy lên Shopify',
    },
    canKem: {
      create: ['mmp_products:edit', 'mmp_products:delete', 'mmp_products:push'],
      edit: ['mmp_products:create', 'mmp_products:delete', 'mmp_products:push'],
      delete: ['mmp_products:create', 'mmp_products:edit', 'mmp_products:push'],
      push: ['mmp_products:create', 'mmp_products:edit', 'mmp_products:delete'],
    },
  },
  { key: 'functions', label: 'Functions', actions: ['view', 'edit'] },
  // CX — ticket liên bộ phận (bảng `CX - To Do` của Lark). 'edit' là quyền GHI HỘ:
  // người có nó ghi được phần việc của MỌI bộ phận, vì hệ thống chưa có tài khoản
  // cho PROCUREMENT / MERCHANDISE / WAREHOUSE (CEO 27/09/2026).
  /* `view` = `view_cx_ticket` ĐỨNG MỘT MÌNH CÓ TÁC DỤNG (không khai `canKem`), và nó là cửa
   * vào CẢ module CX chứ không riêng tab này: `lib/nav.ts:59`,
   * `app/(dashboard)/f/cx/layout.tsx:20, 28`, `.../f/cx/page.tsx:19`,
   * `.../f/cx/viec-can-lam/page.tsx:26`, `features/cx-ticket/nguoi.ts:28`,
   * `features/cx/quyen.ts:38`.
   *
   * `create`/`edit` là hai phần của `manage_cx_ticket`, chùm gồm cả `:view`
   * (`permission-map.ts:64`) → mỗi ô kèm hai ô kia. Nghĩa thật là GHI HỘ: chỗ kiểm là cờ
   * `toanQuyen` (`features/cx-ticket/nguoi.ts:37`), và nó mở ba việc mà người không có thì
   * KHÔNG làm được dù đã gắn bộ phận — tạo/ghi ticket cho bộ phận KHÁC
   * (`features/cx-ticket/actions.ts:37, 116`), đổi trạng thái ticket (`:171`), gắn/bỏ dòng
   * đơn vào ticket (`:194, 211`). */
  {
    key: 'cx.ticket',
    label: 'CX — Việc cần làm (ticket)',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào CẢ module CX (tab Hôm nay) và tab Việc cần làm',
      create: 'Ghi hộ phần việc của MỌI bộ phận, đổi trạng thái ticket, gắn/bỏ dòng đơn vào ticket',
      edit: 'Ghi hộ phần việc của MỌI bộ phận, đổi trạng thái ticket, gắn/bỏ dòng đơn vào ticket',
    },
    canKem: {
      create: ['cx.ticket:view', 'cx.ticket:edit'],
      edit: ['cx.ticket:view', 'cx.ticket:create'],
    },
  },
  // Tranh chấp / chargeback. Scope RIÊNG, không dùng chung với cx.ticket: đây là
  // tiền, và thường là việc của tài chính chứ không phải CX.
  /* `view` = `view_cx_dispute`, đứng một mình CÓ tác dụng (vào CX + tab Tranh chấp):
   * `app/(dashboard)/f/cx/layout.tsx:21, 31`, `.../f/cx/page.tsx:20`,
   * `.../f/cx/tranh-chap/page.tsx:24`, `features/dispute/queries.ts:47, 73, 87, 103`,
   * `features/cx/quyen.ts:41` → KHÔNG khai `canKem`.
   *
   * `create`/`edit` là hai phần của `manage_cx_dispute` (chùm gồm cả `:view`,
   * `permission-map.ts:66`). Chỗ kiểm thật: nhập tranh chấp
   * `features/dispute/actions.ts:32`, thêm ghi chú `:102`, sửa phần CX `:124`, chạy đồng bộ
   * hằng ngày `:145`; cờ `coQuyenGhi` ở `.../f/cx/tranh-chap/page.tsx:34`. */
  {
    key: 'cx.dispute',
    label: 'CX — Tranh chấp thanh toán',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào module CX và tab Tranh chấp',
      create: 'Ghi tranh chấp: nhập mới, thêm ghi chú, sửa phần CX, chạy đồng bộ hằng ngày',
      edit: 'Ghi tranh chấp: nhập mới, thêm ghi chú, sửa phần CX, chạy đồng bộ hằng ngày',
    },
    canKem: {
      create: ['cx.dispute:view', 'cx.dispute:edit'],
      edit: ['cx.dispute:view', 'cx.dispute:create'],
    },
  },
  // Sự cố + thiệt hại tiền quy về bộ phận. Scope riêng vì là tiền, giống cx.dispute.
  /* `view` = `view_cx_incident`, đứng một mình CÓ tác dụng → KHÔNG khai `canKem`:
   * `app/(dashboard)/f/cx/layout.tsx:22, 34`, `.../f/cx/page.tsx:21`,
   * `.../f/cx/su-co/page.tsx:24`, `features/su-co/queries.ts:50, 83, 113`,
   * `features/cx/quyen.ts:42`.
   *
   * `create`/`edit` = hai phần của `manage_cx_incident` (chùm gồm cả `:view`,
   * `permission-map.ts:68`). Nhãn phải nói ra phần TIỀN và phần QUY TRÁCH NHIỆM, không chỉ
   * "ghi sự cố": ghi sự cố `features/su-co/actions.ts:43`, thêm/xoá chi phí thiệt hại
   * `:115, 134`, ghi chú `:146`, đổi trạng thái `:161`, đánh dấu đã xem lại `:180`, ĐỔI BỘ
   * PHẬN CHỊU thiệt hại `:194`; cờ `coQuyenGhi` ở `.../f/cx/su-co/page.tsx:34`. */
  {
    key: 'cx.incident',
    label: 'CX — Sự cố & thiệt hại',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào module CX và tab Sự cố',
      create: 'Ghi sự cố: tạo, thêm/xoá chi phí thiệt hại, đổi trạng thái, đổi bộ phận chịu, ghi chú',
      edit: 'Ghi sự cố: tạo, thêm/xoá chi phí thiệt hại, đổi trạng thái, đổi bộ phận chịu, ghi chú',
    },
    canKem: {
      create: ['cx.incident:view', 'cx.incident:edit'],
      edit: ['cx.incident:view', 'cx.incident:create'],
    },
  },
  // Đánh giá Trustpilot / Judge.me. Scope riêng vì là DANH TIẾNG, không phải tiền:
  // mở được cho marketing mà không phải mở dữ liệu thiệt hại và tranh chấp.
  /* `view` = `view_cx_review`, đứng một mình CÓ tác dụng → KHÔNG khai `canKem`:
   * `app/(dashboard)/f/cx/layout.tsx:23, 37`, `.../f/cx/page.tsx:22`,
   * `.../f/cx/danh-gia/page.tsx:23`, `features/danh-gia/queries.ts:40, 71, 89`,
   * `features/cx/quyen.ts:43`.
   *
   * `create`/`edit` = hai phần của `manage_cx_review` (chùm gồm cả `:view`,
   * `permission-map.ts:70`): ghi đánh giá `features/danh-gia/actions.ts:21`, đổi trạng thái
   * `:91`, sửa phần CX `:114`; cờ `coQuyenGhi` ở `.../f/cx/danh-gia/page.tsx:33`. */
  {
    key: 'cx.review',
    label: 'CX — Đánh giá Trustpilot',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào module CX và tab Đánh giá',
      create: 'Ghi đánh giá: tạo, đổi trạng thái, sửa phần CX',
      edit: 'Ghi đánh giá: tạo, đổi trạng thái, sửa phần CX',
    },
    canKem: {
      create: ['cx.review:view', 'cx.review:edit'],
      edit: ['cx.review:view', 'cx.review:create'],
    },
  },
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
      apply:
        'Đẩy lên store THẬT: market, carrier rate, carrier service, shipping profile, Manual Shipping Rates, seed shipping hệ thống',
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
  /* `view` = `view_ship_ho`, đứng một mình CÓ tác dụng → KHÔNG khai `canKem`. Nó gác cả
   * module (`lib/nav.ts:57`, `app/(dashboard)/f/ship-ho/page.tsx:45`, `.../[id]/page.tsx:37`,
   * `.../partners/page.tsx:21`, `.../partners/[slug]/contracts/page.tsx:18`,
   * `.../statements/page.tsx:16`, `features/ship-ho/contract-actions.ts:36`) VÀ là quyền mở
   * mặt gần như toàn bộ dữ liệu Ship hộ trong NHẬT KÝ — tên/giá vốn/cước/biên lãi/tracking…
   * (`features/nhat-ky/che-gia-tri.ts:154-204`). Mẩu "nhật ký" phải có trong nhãn: bỏ tích là
   * che cả một cột giá trị ở module khác.
   *
   * `create`/`edit` = hai phần của `manage_ship_ho` (chùm gồm cả `:view`,
   * `permission-map.ts:58`) → mỗi ô kèm hai ô kia. Nó là CỔNG CHUNG của mọi server action ghi
   * của module (`features/ship-ho/require-manage.ts:15`, gọi từ 16 tệp):
   *  - đơn + nhập Excel `orders-actions.ts`, `import-actions.ts`;
   *  - đối tác, yêu cầu đối tác, hợp đồng, rate card chào giá `partners-actions.ts`,
   *    `partner-request-actions.ts`, `contract-actions.ts`, `offer-ratecard-actions.ts`;
   *  - báo giá & chọn hãng `quote-lines-actions.ts`, `carrier-select-actions.ts`;
   *  - cân đo lại `measure-actions.ts`, tracking `tracking-actions.ts`;
   *  - bảng kê `statement-actions.ts`, đối soát + quyết định `reconcile-actions.ts`,
   *    `reconcile-decision-actions.ts`, trang phụ phí `trang-phu-phi/actions.ts`;
   *  - ⚠ và VÙNG GEO ở một module khác — `features/geo/geo-actions.ts:2`;
   *  - ⚠ ghi SỰ CỐ ship hộ trên màn Báo cáo ship `features/ship-ho/pillar2-actions.ts:35`,
   *    cờ `ghiSuCoDuoc` ở `app/(dashboard)/f/ship-report/page.tsx:177`. */
  {
    key: 'ship_ho',
    label: 'Ship hộ',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào module Ship hộ (đơn, đối tác, hợp đồng, bảng kê) và mở mặt dữ liệu Ship hộ trong nhật ký',
      create: 'Toàn bộ ghi của Ship hộ: đơn & nhập Excel, đối tác/hợp đồng/rate card, báo giá & chọn hãng, cân đo, tracking, bảng kê, đối soát, vùng geo, ghi sự cố',
      edit: 'Toàn bộ ghi của Ship hộ: đơn & nhập Excel, đối tác/hợp đồng/rate card, báo giá & chọn hãng, cân đo, tracking, bảng kê, đối soát, vùng geo, ghi sự cố',
    },
    canKem: {
      create: ['ship_ho:view', 'ship_ho:edit'],
      edit: ['ship_ho:view', 'ship_ho:create'],
    },
  },
  /* `view` = `view_kol`, đứng một mình CÓ tác dụng → KHÔNG khai `canKem`:
   * `lib/nav.ts:58`, `app/(dashboard)/f/kol/page.tsx:30`, `.../nguoi-nhan/page.tsx:21`,
   * `.../dang-muon/page.tsx:17`, `.../[ma]/page.tsx:16`, và cổng đọc gọi từ client
   * `features/kol/perm.ts:27` (tra giá vốn / tìm biến thể khi gõ form).
   *
   * `create`/`edit` = hai phần của `manage_kol` (chùm gồm cả `:view`, `permission-map.ts:60`).
   * Cổng chung: `features/kol/perm.ts:16`, mở `features/kol/actions.ts` — người nhận (tạo
   * `:191`, sửa `:234`, ngưng dùng `:277`), đơn (tạo `:301`, chốt `:386`, lùi về nháp `:450`,
   * đánh dấu đã gửi `:489`, huỷ `:577`), nhận trả về `:614`, sửa giá vốn `:703`. */
  {
    key: 'kol',
    label: 'Đơn KOL & chụp đồ',
    actions: ['view', 'create', 'edit'],
    nhanHanhDong: {
      view: 'Vào module Đơn KOL (đơn, người nhận, đang mượn) và tra giá vốn / tìm biến thể',
      create: 'Ghi đơn KOL: tạo/chốt/huỷ đơn, lùi về nháp, đánh dấu đã gửi, nhận trả về, sửa giá vốn, quản lý người nhận',
      edit: 'Ghi đơn KOL: tạo/chốt/huỷ đơn, lùi về nháp, đánh dấu đã gửi, nhận trả về, sửa giá vốn, quản lý người nhận',
    },
    canKem: {
      create: ['kol:view', 'kol:edit'],
      edit: ['kol:view', 'kol:create'],
    },
  },
  /* CẢ BỐN ô là MỘT quyền cũ duy nhất: `manage_stores` (`lib/auth/permission-map.ts:12`) —
   * cùng nhãn, kèm lẫn nhau. Ở hàng này KHÔNG có "chỉ xem store" và KHÔNG có "chỉ xoá store".
   *
   * Nhãn phải nói đủ, vì hai mẩu nằm ngoài chữ "Stores" và là chỗ người ta không ngờ:
   *  - kết nối store Shopify qua OAuth (cấp scope) `app/api/auth/shopify/install/route.ts:36`,
   *    mục menu `lib/nav.ts:86`, thẻ dashboard `app/(dashboard)/page.tsx:49`;
   *  - test kết nối store `app/api/stores/[id]/test/route.ts:18`;
   *  - ⚠ đặt TIỀN TỆ GIÁ VỐN + TỶ GIÁ + PHÍ ĐÓNG GÓI của store — ô này nằm trên màn ĐƠN HÀNG
   *    per-store, không nằm trong module Stores (`features/shopify-orders/cost-fx-actions.ts:29`,
   *    nút ở `app/(dashboard)/f/orders/[storeId]/page.tsx:191`). Hai số đó vào thẳng công thức
   *    lãi gộp;
   *  - ⚠ màn Shopify sync health + CHẠY BACKFILL đơn + ĐĂNG KÝ LẠI WEBHOOK
   *    `app/(dashboard)/admin/shopify-sync-health/page.tsx:23, 67`,
   *    `features/shopify-orders/backfill/actions.ts:36`. */
  {
    key: 'stores',
    label: 'Stores',
    actions: ['view', 'create', 'edit', 'delete'],
    nhanHanhDong: {
      view: 'Kết nối store Shopify (OAuth) & test kết nối, đặt tiền tệ giá vốn + tỷ giá + phí đóng gói của store, màn Sync health: chạy backfill đơn & đăng ký lại webhook',
      create: 'Kết nối store Shopify (OAuth) & test kết nối, đặt tiền tệ giá vốn + tỷ giá + phí đóng gói của store, màn Sync health: chạy backfill đơn & đăng ký lại webhook',
      edit: 'Kết nối store Shopify (OAuth) & test kết nối, đặt tiền tệ giá vốn + tỷ giá + phí đóng gói của store, màn Sync health: chạy backfill đơn & đăng ký lại webhook',
      delete: 'Kết nối store Shopify (OAuth) & test kết nối, đặt tiền tệ giá vốn + tỷ giá + phí đóng gói của store, màn Sync health: chạy backfill đơn & đăng ký lại webhook',
    },
    canKem: {
      view: ['stores:create', 'stores:edit', 'stores:delete'],
      create: ['stores:view', 'stores:edit', 'stores:delete'],
      edit: ['stores:view', 'stores:create', 'stores:delete'],
      delete: ['stores:view', 'stores:create', 'stores:edit'],
    },
  },
  /* CHÙM DUY NHẤT TRONG 15 CHÙM **KHÔNG** KHAI `canKem`, và đó là chủ ý.
   *
   * Bốn khoá này vừa hợp thành quyền cũ `manage_users` (`permission-map.ts:17`), VỪA được
   * kiểm RIÊNG TỪNG CÁI bằng `can()` — khoá mới, không qua shim `.every()`:
   * `app/(dashboard)/admin/roles/page.tsx:15, 29, 30, 31` và
   * `features/users/role-actions.ts:18, 27, 43`. Nên tích một ô ở đây CÓ tác dụng thật, và
   * khai "cần kèm" sẽ là nói dối theo chiều ngược lại.
   *
   * Nhưng nhãn vẫn phải nói ra phần chùm: tích ĐỦ cả bốn thì còn mở thêm `manage_users`, tức
   * ba màn Admin mà không cột nào ở đây gợi ra — Users (gán vai, mời user, thu hồi lời mời)
   * `app/(dashboard)/admin/users/page.tsx:31, 98, 116, 141`; Báo lỗi (xem, đổi trạng thái,
   * xem ảnh) `app/(dashboard)/admin/issues/page.tsx:28`,
   * `.../issues/[id]/anh/[n]/route.ts:16`, `features/issue-report/actions.ts:105`; Feature
   * flags (xem + bật/tắt) `app/(dashboard)/admin/feature-flags/page.tsx:30, 61`; và bốn mục
   * menu `lib/nav.ts:94-97`.
   *
   * `edit` còn một nghĩa thứ hai không ai đoán được từ chữ "Sửa": chính khoá
   * `users_roles:edit` là DẤU "quản được user" của chốt chống tự khoá — `setRolePermissions`
   * không cho bỏ nó khỏi Admin (`role-actions.ts:31`), ô của Admin bị khoá cứng trên lưới
   * (`components/admin/RoleMatrix.tsx:87, 195`), và nó là nguồn sự thật cho bất biến
   * "không gỡ người cuối cùng" (`features/users/role-queries.ts:22, 30`,
   * `app/(dashboard)/admin/users/page.tsx:42`). */
  {
    key: 'users_roles',
    label: 'Users & Roles',
    actions: ['view', 'create', 'edit', 'delete'],
    nhanHanhDong: {
      view: 'Vào màn Roles & Permissions · đủ cả 4 ô mở thêm Users, Báo lỗi, Feature flags',
      create: 'Tạo role mới · đủ cả 4 ô mở thêm Users, Báo lỗi, Feature flags',
      edit: 'Sửa ô tích quyền của role; cũng là dấu "quản được user" của chốt chống tự khoá · đủ cả 4 ô mở thêm Users, Báo lỗi, Feature flags',
      delete: 'Xoá role không phải hệ thống · đủ cả 4 ô mở thêm Users, Báo lỗi, Feature flags',
    },
  },
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
