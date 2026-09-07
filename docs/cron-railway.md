# Lịch cron trên Railway (Infrastructure as Code)

Mọi service — web và cron — được khai trong **`.railway/railway.ts`**. Lệnh build,
lệnh start, lịch chạy (`cronSchedule`), vùng, biến môi trường đều nằm ở đó. Sửa
lịch = sửa file + `railway config apply`, không bấm trên web.

Từ 07/09/2026 repo **không còn** file `railway.json` / `railway.cron-*.json`
(config-as-code, Railway ngừng hỗ trợ 2026-12-01). Thiết lập "Railway Config
File" trên từng service đã được xoá; nếu ai đặt lại, file đó sẽ ĐÈ cấu hình IaC
một cách âm thầm — đúng cái đã xảy ra với lịch Lark và FedEx/DHL trước đây.

## Thêm hoặc sửa một cron service

1. Trong `.railway/railway.ts`, thêm một khối theo mẫu:

   ```ts
   const cronX = service("cron-x", {
     source: repo,
     build: { builder: "NIXPACKS", buildCommand: "echo 'cron: skip Next build'" },
     start: "npm run cron:x",              // script trong package.json
     replicas: { "asia-southeast1-eqsg3a": 1 },
     deploy: { cronSchedule: "0 * * * *", restartPolicyType: "NEVER" },
     env: {
       DATABASE_URL: ShopifyManagementSystem.env.DATABASE_URL,
       // THÊM HẾT biến tác vụ cần. Thiếu biến là tác vụ chạy mà không làm gì,
       // không báo lỗi (D-053). Nếu script import Better Auth (trực tiếp hay
       // gián tiếp) thì phải có BETTER_AUTH_SECRET + BETTER_AUTH_URL, không thì
       // crash ngay lúc import với NODE_ENV=production.
     },
   });
   ```
   và thêm `cronX` vào `resources` ở cuối file.
2. `railway config plan` — đọc kỹ diff; `railway config apply --yes`.
3. Khoá job phải có trong `features/jobs/registry.ts` (test `run.test.ts` canh).

Nhiều tác vụ ngắn cùng chu kỳ thì **một service chạy một nhóm**:
`start: "npm run cron:group -- hang-ngay"` (nhóm khai ở `features/jobs/groups.ts`).

## Kiểm tra đã chạy chưa

Mở `/f/jobs` trong hệ thống. Sau một chu kỳ, tác vụ phải chuyển **✅ Bình
thường**. **❌ Chưa chạy lần nào** = chưa có service nào chạy khoá đó, hoặc thiếu
biến. **Không tin cấu hình, chỉ tin `/f/jobs`** — nó đọc nhật ký do chính tác vụ
ghi ra (`job_runs`).

Xem cấu hình THẬT đang chạy của một service (không phải cái trong file):
`railway api 'query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ startCommand cronSchedule builder buildCommand railwayConfigFile } }' --raw-var s=<serviceId> --raw-var e=<envId>`

## Service ↔ tác vụ ↔ lịch (07/09/2026)

| Service | Script | Tác vụ (khoá job) | Lịch (UTC) |
|---|---|---|---|
| `cron-sync-orders` | `cron:sync-orders` | sync-orders + push-unsent-brand, addr-verify, ship-ho-tiers, apply-pod, return-links, ship-ho-reconcile, track-ship-ho, refresh-fuel | mỗi giờ |
| `sync Lark operation` | `cron:sync-lark` | sync-lark, push-nhan-hang | mỗi giờ, phút 15 |
| `cron-sync-lifecycle` | `cron:sync-lifecycle` | sync-lifecycle | 6 giờ/lần |
| `cron-track-shipments` | `cron:track-shipments` | track-shipments | 6 giờ/lần |
| `Sync FedEx/DHL data from URL` | `cron:refresh-surcharges` | refresh-surcharges | 01:00 hằng ngày |
| `cron-retry-mmp` | `cron:retry-mmp-orders` | retry-mmp-orders | 15 phút/lần |
| `cron-retry-ship-ho` | `cron:retry-ship-ho` | retry-ship-ho-events | 15 phút/lần |
| `cron-prune-logs` | `cron:prune-logs` | prune-logs | 03:00 thứ Hai |

Giờ trên Railway là **UTC**. `0 3 * * 1` = 10:00 sáng thứ Hai giờ Việt Nam.

## Tác vụ đã bỏ (07/09/2026)

8 khoá chưa từng chạy (service cũ đã xoá) được CEO cho bỏ hẳn khỏi sổ đăng ký,
nhóm, script cron và API route: `refresh-vcb-fx`, `sync-warehouse`,
`sync-meanblvd`, `create-sale`, `sync-catalog`, `refresh-demand`, `remind-fuel`,
`sync-geo`. Mã tính năng trong `features/` vẫn còn; bật lại = thêm khoá vào
`registry.ts`, script vào `scripts/cron/`, khoá vào nhóm ở `groups.ts`.
