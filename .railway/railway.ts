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
    env: { TZ: "UTC", AUTH_GOOGLE_ID: preserve(), AUTH_GOOGLE_SECRET: preserve(), AUTH_SECRET: preserve(), DATABASE_URL: preserve(), LARK_APP_ID: preserve(), LARK_APP_SECRET: preserve(), LARK_BASE_APP_TOKEN: preserve(), LARK_LOG_TABLE_ID: preserve(), LARK_QC_TABLE_ID: preserve(), MEAN_API_BASE_URL: preserve(), MEAN_API_TOKEN: preserve(), MEAN_WEBHOOK_SECRET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve() },
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
    env: { TZ: "UTC", BETTER_AUTH_SECRET: preserve(), BETTER_AUTH_URL: preserve(), BOOTSTRAP_ADMIN_EMAILS: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DHL_API_KEY: preserve(), DHL_API_SECRET: preserve(), ENCRYPTION_KEY_CURRENT: preserve(), ENCRYPTION_KEY_V1: preserve(), EXTERNAL_API_KEY: preserve(), FEDEX_ACCOUNT_NUMBER: preserve(), FEDEX_API_BASE: preserve(), FEDEX_CLIENT_ID: preserve(), FEDEX_CLIENT_SECRET: preserve(), GOOGLE_CLIENT_ID: preserve(), GOOGLE_CLIENT_SECRET: preserve(), LARK_APP_ID: preserve(), LARK_APP_SECRET: preserve(), LARK_BASE_APP_TOKEN: preserve(), LARK_LOG_TABLE_ID: preserve(), LARK_QC_TABLE_ID: preserve(), MMP_ORDERS_URL: preserve(), MMP_OUTBOUND_SECRET: preserve(), MMP_OUTBOUND_URL: preserve(), MMP_SHIP_HO_WEBHOOK_URL: preserve(), MMP_WEBHOOK_SECRET: preserve(), RAILWAY_TOKEN: preserve(), S3_ACCESS_KEY_ID: preserve(), S3_BUCKET: preserve(), S3_ENDPOINT: preserve(), S3_REGION: preserve(), S3_SECRET_ACCESS_KEY: preserve(), SHIP_HO_ADOPT_DISABLED: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_API_VERSION: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_SCOPES: preserve(), TRACKINGMORE_API_KEY: preserve() },
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
    env: { TZ: "UTC", FEDEX_CLIENT_ID: ShopifyManagementSystem.env.FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET: ShopifyManagementSystem.env.FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER: ShopifyManagementSystem.env.FEDEX_ACCOUNT_NUMBER, DHL_API_KEY: ShopifyManagementSystem.env.DHL_API_KEY, TRACKINGMORE_API_KEY: ShopifyManagementSystem.env.TRACKINGMORE_API_KEY, MMP_ORDERS_URL: ShopifyManagementSystem.env.MMP_ORDERS_URL, MMP_OUTBOUND_SECRET: ShopifyManagementSystem.env.MMP_OUTBOUND_SECRET, MMP_SHIP_HO_WEBHOOK_URL: ShopifyManagementSystem.env.MMP_SHIP_HO_WEBHOOK_URL, MMP_WEBHOOK_SECRET: ShopifyManagementSystem.env.MMP_WEBHOOK_SECRET, BETTER_AUTH_SECRET: preserve(), BETTER_AUTH_URL: preserve(), BOOTSTRAP_ADMIN_EMAILS: preserve(), DATABASE_URL: preserve(), ENCRYPTION_KEY_CURRENT: preserve(), ENCRYPTION_KEY_V1: preserve(), FEDEX_API_BASE: preserve(), S3_REGION: preserve(), SHOPIFY_API_KEY: preserve(), SHOPIFY_API_SECRET: preserve(), SHOPIFY_API_VERSION: preserve(), SHOPIFY_APP_URL: preserve(), SHOPIFY_SCOPES: preserve() },
  });

  // ── Cron thêm 05/09: bốn tác vụ chết âm thầm (rà soát 04/09). Biến môi trường
  // THAM CHIẾU từ service chính — thiếu biến thì tác vụ chạy mà không làm gì và
  // không báo lỗi, đúng cái đã xảy ra với outbox MMP.
  const cronRetryMmp = service("cron-retry-mmp", {
    source: repo,
    start: "npm run cron:retry-mmp-orders",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { cronSchedule: "*/15 * * * *", restartPolicyType: "NEVER" },
    env: { TZ: "UTC",
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
    env: { TZ: "UTC",
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
    env: { TZ: "UTC",
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
    env: { TZ: "UTC", DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL },
  });

  return project("Shopify Management System", {
    resources: [cronRetryMmp, cronRetryShipHo, cronTrack, cronPruneLogs, cronSyncLifecycle, syncLarkOperation, SyncFedExDHLDataFromURL, ShopifyManagementSystem, cronSyncOrders, postgresVolume],
  });
});
