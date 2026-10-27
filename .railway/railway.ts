/*
 * ⚠ TỆP NÀY TỪNG TRÔI XA SO VỚI THỰC TẾ — và `railway config apply` thì XOÁ thứ không được
 * khai ở đây. Đo 27/10/2026: plan báo **1 to add, 32 to destroy**, trong đó có
 * `Shopify-Management-System.UPS_ACCOUNT_NUMBER` (giá sống UPS tắt),
 * `sync Lark operation.WH_TON_KHO_LARK` (đồng bộ tồn Lark âm thầm tụt về chạy thử) và
 * `MMP_RESALE_TON_KHO_URL` + `MMP_WEBHOOK_SECRET` (đường đẩy tồn sang MMP đứt). Tức một cú
 * `apply` vô tư là một lượt hỏng production, không phải một lượt dọn dẹp.
 *
 * Nguyên nhân: biến được thêm dần trên dashboard mà không ai ghi lại vào đây. Đã khai lại cả
 * 32 biến bằng `preserve()` để plan trở về thuần-cộng-thêm.
 *
 * LUẬT: thêm biến trên dashboard thì PHẢI khai vào đây bằng `preserve()` trong cùng lượt. Và
 * **luôn chạy `railway config plan` rồi ĐỌC nó trước khi `apply`** — plan là lệnh chỉ xem.
 */
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // MỌI service phải nằm CÙNG VÙNG với database (Supabase ap-southeast-1,
  // Singapore). Trước 05/09 các cron chạy ở us-west2: mỗi lệnh SQL vượt Thái
  // Bình Dương ~270ms, khiến sync-lark với ~15.000 lệnh mất 68 PHÚT mỗi lượt
  // trong khi phần đọc chỉ hết 40 giây.
  const repo = github("ecommeanblvd/Shopify-Management-System", { checkSuites: false });

  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 5000 });
  const cronSyncLifecycle = service("cron-sync-lifecycle", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "npm run build" },
    start: "npm run cron:sync-lifecycle",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "0 */6 * * *", restartPolicyType: "NEVER" },
    env: { TZ: "UTC", BETTER_AUTH_SECRET: preserve(), BETTER_AUTH_URL: preserve(), BOOTSTRAP_ADMIN_EMAILS: preserve(), DATABASE_URL: preserve(), ENCRYPTION_KEY_CURRENT: preserve(), ENCRYPTION_KEY_V1: preserve(), FEDEX_ACCOUNT_NUMBER: preserve(), FEDEX_API_BASE: preserve(), FEDEX_CLIENT_ID: preserve(), FEDEX_CLIENT_SECRET: preserve(), GOOGLE_CLIENT_ID: preserve(), GOOGLE_CLIENT_SECRET: preserve(), MMP_ORDERS_URL: preserve(), MMP_OUTBOUND_SECRET: preserve(), MMP_OUTBOUND_URL: preserve(), MMP_WEBHOOK_SECRET: preserve(), S3_ACCESS_KEY_ID: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve(), S3_SECRET_ACCESS_KEY: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_API_VERSION: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_SCOPES: preserve() },
  });
  const syncLarkOperation = service("sync Lark operation", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "npm run build" },
    start: "npm run cron:sync-lark",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "15 * * * *", restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "mean-merchant-portal" },
    env: { LARK_GHI_NGUOC: preserve(), MMP_RESALE_TON_KHO_URL: preserve(), MMP_WEBHOOK_SECRET: preserve(), WH_GHI_CAN_LARK: preserve(), WH_GHI_LARK: preserve(), WH_TON_KHO_LARK: preserve(), TZ: "UTC", AUTH_GOOGLE_ID: preserve(), AUTH_GOOGLE_SECRET: preserve(), AUTH_SECRET: preserve(), DATABASE_URL: preserve(), LARK_APP_ID: preserve(), LARK_APP_SECRET: preserve(), LARK_BASE_APP_TOKEN: preserve(), LARK_LOG_TABLE_ID: preserve(), LARK_QC_TABLE_ID: preserve(), MEAN_API_BASE_URL: preserve(), MEAN_API_TOKEN: preserve(), MEAN_WEBHOOK_SECRET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve() },
  });
  const SyncFedExDHLDataFromURL = service("Sync FedEx/DHL data from URL", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "npm run build" },
    start: "npm run cron:refresh-surcharges",
    preDeploy: [],
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "0 1 * * *", restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "enthusiastic-serenity" },
    env: { TZ: "UTC", DATABASE_URL: preserve() },
  });
  // 07/09: chuyển từ railway.json (config-as-code, hết hạn 2026-12-01) sang IaC.
  // Giá trị build/start/cron dưới đây chép từ các file railway*.json đang được
  // service đọc — chúng mới là cấu hình THẬT, còn giá trị dashboard kéo về hôm
  // 05/09 là giá trị cũ bị file đè (Lark: 15 * * * * chứ không phải 0 1-12;
  // FedEx/DHL: refresh-surcharges 1h sáng chứ không phải refresh-fuel thứ Hai).
  const ShopifyManagementSystem = service("Shopify-Management-System", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "npm run build" },
    start: "npm run db:migrate && npm run db:seed-roles && npm run start",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    networking: { privateNetworkEndpoint: "shopify-management-system" },
    env: { FEDEX_TRACK_CLIENT_ID: preserve(), FEDEX_TRACK_CLIENT_SECRET: preserve(), GOOGLE_SA_EMAIL: preserve(), GOOGLE_SA_PRIVATE_KEY: preserve(), ISSUE_API_TOKEN: preserve(), LARK_PACK_DRY: preserve(), LARK_PACK_WEBHOOK_SECRET: preserve(), MMP_TACH_DUTY: preserve(), UPS_ACCOUNT_NUMBER: preserve(), UPS_CLIENT_ID: preserve(), UPS_CLIENT_SECRET: preserve(), WH_GHI_CAN_LARK: preserve(), WH_GHI_LARK: preserve(), TZ: "UTC", BETTER_AUTH_SECRET: preserve(), BETTER_AUTH_URL: preserve(), BOOTSTRAP_ADMIN_EMAILS: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DHL_API_KEY: preserve(), DHL_API_SECRET: preserve(), ENCRYPTION_KEY_CURRENT: preserve(), ENCRYPTION_KEY_V1: preserve(), EXTERNAL_API_KEY: preserve(), FEDEX_ACCOUNT_NUMBER: preserve(), FEDEX_API_BASE: preserve(), FEDEX_CLIENT_ID: preserve(), FEDEX_CLIENT_SECRET: preserve(), GOOGLE_CLIENT_ID: preserve(), GOOGLE_CLIENT_SECRET: preserve(), LARK_APP_ID: preserve(), LARK_APP_SECRET: preserve(), LARK_BASE_APP_TOKEN: preserve(), LARK_LOG_TABLE_ID: preserve(), LARK_QC_TABLE_ID: preserve(), MMP_ORDERS_URL: preserve(), MMP_OUTBOUND_SECRET: preserve(), MMP_OUTBOUND_URL: preserve(), MMP_SHIP_HO_WEBHOOK_URL: preserve(), MMP_WEBHOOK_SECRET: preserve(), RAILWAY_TOKEN: preserve(), S3_ACCESS_KEY_ID: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve(), S3_SECRET_ACCESS_KEY: preserve(), SHIP_HO_ADOPT_DISABLED: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_API_VERSION: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_SCOPES: preserve(), TRACKINGMORE_API_KEY: preserve() },
  });
  // Bổ sung 05/09: service này chạy 8 việc, trong đó addr-verify cần FedEx và
  // track-ship-ho cần FedEx + TrackingMore + DHL — nhưng chỉ có FEDEX_API_BASE,
  // KHÔNG có credential. Hậu quả: addr-verify hỏng 100/100, track-ship-ho hỏng
  // 48/48 mỗi lượt, IM LẶNG, cho tới khi tách tác vụ ra mới lộ.
  const cronSyncOrders = service("cron-sync-orders", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "echo 'cron service: skip Next build (tsx chạy thẳng TS)'" },
    start: "npm run cron:sync-orders",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "0 * * * *", restartPolicyType: "NEVER" },
    env: { FEDEX_TRACK_CLIENT_ID: preserve(), FEDEX_TRACK_CLIENT_SECRET: preserve(), MMP_TACH_DUTY: preserve(), UPS_CLIENT_ID: preserve(), UPS_CLIENT_SECRET: preserve(), TZ: "UTC", FEDEX_CLIENT_ID: ShopifyManagementSystem.env.FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET: ShopifyManagementSystem.env.FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER: ShopifyManagementSystem.env.FEDEX_ACCOUNT_NUMBER, DHL_API_KEY: ShopifyManagementSystem.env.DHL_API_KEY, TRACKINGMORE_API_KEY: ShopifyManagementSystem.env.TRACKINGMORE_API_KEY, MMP_ORDERS_URL: ShopifyManagementSystem.env.MMP_ORDERS_URL, MMP_OUTBOUND_SECRET: ShopifyManagementSystem.env.MMP_OUTBOUND_SECRET, MMP_SHIP_HO_WEBHOOK_URL: ShopifyManagementSystem.env.MMP_SHIP_HO_WEBHOOK_URL, MMP_WEBHOOK_SECRET: ShopifyManagementSystem.env.MMP_WEBHOOK_SECRET, BETTER_AUTH_SECRET: preserve(), BETTER_AUTH_URL: preserve(), BOOTSTRAP_ADMIN_EMAILS: preserve(), DATABASE_URL: preserve(), ENCRYPTION_KEY_CURRENT: preserve(), ENCRYPTION_KEY_V1: preserve(), FEDEX_API_BASE: preserve(), S3_REGION: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_API_VERSION: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_SCOPES: preserve() },
  });

  // ── Cron thêm 05/09: bốn tác vụ chết âm thầm (rà soát 04/09). Biến môi trường
  // THAM CHIẾU từ service chính — thiếu biến thì tác vụ chạy mà không làm gì và
  // không báo lỗi, đúng cái đã xảy ra với outbox MMP.
  const cronRetryMmp = service("cron-retry-mmp", {
    source: repo,
    start: "npm run cron:retry-mmp-orders",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "*/15 * * * *", restartPolicyType: "NEVER" },
    env: { WH_GHI_LARK: preserve(), TZ: "UTC",
      DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL,
      MMP_ORDERS_URL: ShopifyManagementSystem.env.MMP_ORDERS_URL,
      MMP_OUTBOUND_SECRET: ShopifyManagementSystem.env.MMP_OUTBOUND_SECRET,
      // 07/09: order-backfill.ts import Better Auth ở cấp module; NODE_ENV=production
      // mà thiếu secret là Better Auth ném lỗi lúc import → cron CRASHED dù không
      // dùng auth. Cấp biến để chạy được; tách import là việc riêng.
      BETTER_AUTH_SECRET: ShopifyManagementSystem.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: ShopifyManagementSystem.env.BETTER_AUTH_URL,
    },
  });
  const cronRetryShipHo = service("cron-retry-ship-ho", {
    source: repo,
    start: "npm run cron:retry-ship-ho",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "*/15 * * * *", restartPolicyType: "NEVER" },
    env: { WH_GHI_LARK: preserve(), TZ: "UTC",
      DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL,
      MMP_SHIP_HO_WEBHOOK_URL: ShopifyManagementSystem.env.MMP_SHIP_HO_WEBHOOK_URL,
      MMP_WEBHOOK_SECRET: ShopifyManagementSystem.env.MMP_WEBHOOK_SECRET,
    },
  });
  const cronTrack = service("cron-track-shipments", {
    source: repo,
    start: "npm run cron:track-shipments",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "0 */6 * * *", restartPolicyType: "NEVER" },
    env: { FEDEX_TRACK_CLIENT_ID: preserve(), FEDEX_TRACK_CLIENT_SECRET: preserve(), UPS_CLIENT_ID: preserve(), UPS_CLIENT_SECRET: preserve(), TZ: "UTC",
      DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL,
      FEDEX_API_BASE: ShopifyManagementSystem.env.FEDEX_API_BASE,
      FEDEX_CLIENT_ID: ShopifyManagementSystem.env.FEDEX_CLIENT_ID,
      FEDEX_CLIENT_SECRET: ShopifyManagementSystem.env.FEDEX_CLIENT_SECRET,
      FEDEX_ACCOUNT_NUMBER: ShopifyManagementSystem.env.FEDEX_ACCOUNT_NUMBER,
      DHL_API_KEY: ShopifyManagementSystem.env.DHL_API_KEY,
      TRACKINGMORE_API_KEY: ShopifyManagementSystem.env.TRACKINGMORE_API_KEY,
    },
  });
  const cronPruneLogs = service("cron-prune-logs", {
    source: repo,
    start: "npm run cron:prune-logs",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "0 3 * * 1", restartPolicyType: "NEVER" },
    env: { FEDEX_SANDBOX_CLIENT_ID: preserve(), FEDEX_SANDBOX_CLIENT_SECRET: preserve(), TZ: "UTC", DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL },
  });

  // 08/09: giá vốn hàng TỰ SẢN XUẤT (tinhatelier, mirermirer-official,
  // meanblvd/MEAN BLVD) — sync-unit-cost (đọc Cost per item Shopify) +
  // apply-own-cogs (ghi order_line_cogs theo line), lồng trong cùng script
  // scripts/cron/cogs-own.ts (xem features/jobs/run.ts::chayMotJob).
  const cronCogsOwn = service("cron-cogs-own", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "echo 'cron service: skip Next build (tsx chạy thẳng TS)'" },
    start: "npm run cron:cogs-own",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "0 2 * * *", restartPolicyType: "NEVER" },
    env: {
      TZ: "UTC",
      DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL,
      ENCRYPTION_KEY_V1: ShopifyManagementSystem.env.ENCRYPTION_KEY_V1,
      ENCRYPTION_KEY_CURRENT: ShopifyManagementSystem.env.ENCRYPTION_KEY_CURRENT,
      SHOPIFY_API_KEY: ShopifyManagementSystem.env.SHOPIFY_API_KEY,
      SHOPIFY_API_SECRET: ShopifyManagementSystem.env.SHOPIFY_API_SECRET,
      SHOPIFY_SCOPES: ShopifyManagementSystem.env.SHOPIFY_SCOPES,
      SHOPIFY_APP_URL: ShopifyManagementSystem.env.SHOPIFY_APP_URL,
      SHOPIFY_API_VERSION: ShopifyManagementSystem.env.SHOPIFY_API_VERSION,
      BETTER_AUTH_SECRET: ShopifyManagementSystem.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: ShopifyManagementSystem.env.BETTER_AUTH_URL,
    },
  });

  /* Điền bù giá ước tính lên Lark cho kiện lỡ nhịp ở lượt đầu (BL-2, 27/10/2026).
   *
   * Route `app/api/cron/dien-bu-gia-uoc-tinh/route.ts` có từ 12/10 nhưng CHƯA BAO GIỜ được
   * gọi — không npm script, không service ở đây, `job_runs` 0 lượt — trong khi giao diện hứa
   * với nhân sự "cron sẽ thử lại". Kiện PK-22436 nằm im 20 giờ rồi thành báo lỗi.
   *
   * PHẢI là service riêng, không nhét vào `sync Lark operation`: đo 27/10/2026, service đó
   * CHỈ có `LARK_*` — không `UPS_ACCOUNT_NUMBER`, không `FEDEX_*`, nên job sẽ trả null ngay ở
   * chốt `!soTaiKhoan` mỗi lượt. Và không cron service nào hiện có đủ bộ:
   * `cron-sync-orders`/`cron-track-shipments` có `UPS_CLIENT_*` nhưng thiếu
   * `UPS_ACCOUNT_NUMBER` và không có `LARK_*`. Chỉ service chính đủ, nên lấy tham chiếu từ nó.
   *
   * 30 phút một lượt: lượt ghi ĐẦU chạy ngay trong action nhập mã, đây chỉ là lưới an toàn. */
  const cronDienBuGia = service("cron-dien-bu-gia", {
    source: repo,
    build: { builder: "NIXPACKS", buildCommand: "echo 'cron service: skip Next build (tsx chạy thẳng TS)'" },
    start: "npm run cron:dien-bu-gia-uoc-tinh",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "*/30 * * * *", restartPolicyType: "NEVER" },
    env: {
      TZ: "UTC",
      DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL,
      // Giá sống UPS — `layGiaUocTinh` trả null ngay nếu thiếu SỐ TÀI KHOẢN.
      UPS_ACCOUNT_NUMBER: ShopifyManagementSystem.env.UPS_ACCOUNT_NUMBER,
      UPS_CLIENT_ID: ShopifyManagementSystem.env.UPS_CLIENT_ID,
      UPS_CLIENT_SECRET: ShopifyManagementSystem.env.UPS_CLIENT_SECRET,
      // Giá sống FedEx — kiện FedEx đi nhánh khác của cùng hàm đó.
      FEDEX_ACCOUNT_NUMBER: ShopifyManagementSystem.env.FEDEX_ACCOUNT_NUMBER,
      FEDEX_API_BASE: ShopifyManagementSystem.env.FEDEX_API_BASE,
      FEDEX_CLIENT_ID: ShopifyManagementSystem.env.FEDEX_CLIENT_ID,
      FEDEX_CLIENT_SECRET: ShopifyManagementSystem.env.FEDEX_CLIENT_SECRET,
      FEDEX_TRACK_CLIENT_ID: ShopifyManagementSystem.env.FEDEX_TRACK_CLIENT_ID,
      FEDEX_TRACK_CLIENT_SECRET: ShopifyManagementSystem.env.FEDEX_TRACK_CLIENT_SECRET,
      // Ghi ô giá lên dòng LOG của kiện.
      LARK_APP_ID: ShopifyManagementSystem.env.LARK_APP_ID,
      LARK_APP_SECRET: ShopifyManagementSystem.env.LARK_APP_SECRET,
      LARK_BASE_APP_TOKEN: ShopifyManagementSystem.env.LARK_BASE_APP_TOKEN,
      LARK_LOG_TABLE_ID: ShopifyManagementSystem.env.LARK_LOG_TABLE_ID,
      // Cùng lý do đã ghi ở cron-retry-mmp: Better Auth ném lỗi LÚC IMPORT khi
      // NODE_ENV=production mà thiếu secret, nên cron chết dù không dùng auth.
      BETTER_AUTH_SECRET: ShopifyManagementSystem.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: ShopifyManagementSystem.env.BETTER_AUTH_URL,
    },
  });

  return project("Shopify Management System", {
    resources: [cronDienBuGia, cronRetryMmp, cronRetryShipHo, cronTrack, cronPruneLogs, cronCogsOwn, cronSyncLifecycle, syncLarkOperation, SyncFedExDHLDataFromURL, ShopifyManagementSystem, cronSyncOrders, postgresVolume],
  });
});
