# Quản lí đơn — gộp Vận hành + Vòng đời + playbook từng giai đoạn — Design

> Gộp module "Vận hành đơn" (worklist) và "Vòng đời đơn" (lifecycle) thành 1 module "Quản lí đơn".
> Trang chi tiết hợp nhất: mỗi giai đoạn hiển thị 4 lớp — cần làm gì · có thông tin gì ·
> estimate/rule · thời gian thực so dự kiến (trễ/đúng hẹn).

**Ngày:** 2026-07-04
**Trạng thái:** đã duyệt hướng + mockup, chờ plan.
**Nhánh:** `feat/quan-ly-don` (P1) rồi `feat/quan-ly-don-p2`.

## 1. Bối cảnh

Hai module là 2 lăng kính trên cùng pipeline đơn:
- **Vận hành** (`/f/fulfillment`, `deriveOrderStage`): 11 stage **hành động** ("giờ làm gì") — hàng đợi việc ops.
- **Vòng đời** (`/f/lifecycle`, `deriveLifecycle`): mốc + SLA + trễ/đúng + timeline + thống kê.

Trùng pipeline, khác mục đích, **mỗi cái 1 trang chi tiết riêng** (`/f/fulfillment/[orderId]`,
`/f/lifecycle/[orderId]`) — chỗ trùng lặp mà việc gộp nhắm tới.

## 2. Quyết định đã chốt (brainstorm)

| Chủ đề | Quyết định |
|---|---|
| Mức gộp | **1 nhóm nav "Quản lí đơn"** (tab Việc cần làm / Vòng đời / Thống kê) + **1 trang chi tiết hợp nhất** thay 2 trang detail. Danh sách giữ mục đích riêng. |
| Khung giai đoạn | **Khung lifecycle** (9 stage MAIN_CHAIN, đã có SLA/mốc/timeline) làm xương sống; gắn nhãn "việc hiện tại" từ worklist `deriveOrderStage`. |
| Playbook "cần làm gì" | **Hải cứng trong code** (static per stage), không bảng/editor. |
| Estimate/rule | **Tái dùng `lifecycle_sla`** (6 đoạn, đã sửa được trong UI) + actual từ `buildTimeline`. |

## 3. Kiến trúc

### 3.1 Nav — nhóm "Quản lí đơn"
Gom 3 mục hiện có vào 1 nhóm nav (route giữ nguyên, chỉ đổi nhãn/nhóm để không vỡ):
- **Việc cần làm** → `/f/fulfillment` (worklist giữ nguyên).
- **Vòng đời** → `/f/lifecycle`.
- **Thống kê** → `/f/lifecycle/stats`.

Cả worklist (`WorklistTable`) và lifecycle list đổi **link chi tiết** → trỏ về trang chi tiết hợp nhất.

### 3.2 Trang chi tiết hợp nhất (trái tim)
Route: dùng `/f/lifecycle/[orderId]` làm nơi triển khai (đã có stepper+timeline), trình bày dưới tên
"Chi tiết đơn". Worklist `/f/fulfillment/[orderId]` → redirect/trỏ về đây (giữ 1 nguồn sự thật).
RBAC `view_fulfillment` như hiện tại.

Cấu trúc:
1. **Header**: order# · store · "hiện tại [stage] → chờ [nextStage]" · chip trạng thái (đúng/sắp/trễ/nghi mất tín hiệu) · pill "việc hiện tại" (worklist stage).
2. **Stepper ngang** 9 stage (đã có).
3. **Hành trình** — mỗi point mang 4 lớp:

| Point | Nội dung |
|---|---|
| **Đã qua** | mốc thật + duration **thực vs estimate đoạn đó** + badge đúng/trễ + (≈ nếu ước lượng) |
| **Hiện tại** (mở rộng) | pill việc worklist · **Cần làm** (playbook) · lưới **Thông tin** · **Dự kiến** đoạn + đếm ngược/trễ |
| **Chưa tới** | tên stage + **dự kiến** đoạn + preview thông tin sẽ có |

### 3.3 Phần code mới (thuần, test được)

**`features/lifecycle/playbook.ts`** (thuần):
- `STAGE_PLAYBOOK: Record<StageKey, { whatToDo: string; infoKeys: InfoKey[] }>` — static.
- `type InfoKey` = tập khoá thông tin (`address`,`items`,`brand`,`brandEta`,`brandRequests`,`kcs`,`packs`,`carrier`,`tracking`,`deliveryStatus`,`refund`).
- Nội dung seed (rút gọn):
  - `placed`: "Xác nhận đơn, kiểm tồn kho, quyết định push brand hay lấy kho." — `address,items`
  - `production`: "Theo dõi brand xác nhận + gửi hàng; giục KCS khi hàng về kho." — `brand,brandEta,brandRequests,kcs`
  - `qc`: "Đối chiếu KCS pass/fail; xử lý hàng lỗi trước khi đóng gói." — `kcs,packs`
  - `packed`: "Lên vận đơn, bàn giao carrier." — `packs,carrier`
  - `shipped`/`in_transit`/`out_for_delivery`: "Theo dõi tracking; xử lý sự cố giao; báo khách." — `carrier,tracking,deliveryStatus,address`
  - `post_delivery`: "Theo dõi return/refund trong 30 ngày trước khi đóng đơn." — `deliveryStatus,refund`
  - `completed`: "Đơn đã hoàn tất." — `[]`

**`features/lifecycle/stage-timing.ts`** (thuần) hoặc mở rộng `display.ts`:
- `STAGE_SEGMENT: Record<StageKey, SlaKey | null>` — map stage → đoạn SLA "đang chờ hoàn thành"
  (placed→placed_to_production, production→production, qc→qc/pack, packed→ship, shipped/in_transit/out_for_delivery→deliver, còn lại null). Nhất quán logic deadline trong `derive.ts`.
- `segmentActualVsEstimate(timeline, sla) → Array<{ segment, actualHrs, estimateHrs, verdict:'đúng'|'trễ'|null }>` —
  ghép mỗi bước timeline đã qua với đoạn SLA của nó.

**Query gom "Thông tin cần xem"** — 1 query theo `orderId` gom: address, items (SKU/tồn), brand+ETA+request counts, KCS, packs/carrier/tracking/deliveryStatus, refund. Phần lớn đã có ở
`worklist-status-queries.ts`/`brand-queries`/lifecycle — gom lại thành `getOrderDossier(orderId)`.

## 4. Phân phase

| Phase | Deliverable | Rủi ro |
|---|---|---|
| **P1** | Nav group "Quản lí đơn" (3 tab) + trỏ cả 2 list về 1 trang chi tiết (lifecycle detail) + worklist detail redirect | Thấp — plumbing |
| **P2** | Làm giàu trang chi tiết: `playbook.ts` + `stage-timing.ts` + `getOrderDossier` + render 4 lớp/point (đã qua/hiện tại/chưa tới) + pill việc worklist | Vừa — thêm mới, đọc-thuần |

## 5. Test & lỗi

- **Thuần:** `playbook` (mọi stage có entry, infoKeys hợp lệ); `STAGE_SEGMENT` + `segmentActualVsEstimate` (đúng/trễ theo đoạn, đoạn thiếu mốc → null, không kéo verdict sai).
- **Query:** `getOrderDossier` mỏng (gom + map), không unit-test DB.
- **UI:** đọc snapshot + dossier, không tính nặng client.

## 6. YAGNI / không làm

- Không viết lại `deriveOrderStage`/`deriveLifecycle` (giữ 2 engine); chỉ **đọc** để gộp hiển thị.
- Không editor playbook (static code).
- Không đổi worklist list / lifecycle list logic (chỉ đổi nav group + link chi tiết).
- Không bảng mới / migration (dùng dữ liệu sẵn).
- Không gộp thành 1 stage model mới (đã loại phương án C).
