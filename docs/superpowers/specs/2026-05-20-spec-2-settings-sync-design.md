# Shopify Management System — Spec #2: Settings Sync (write shipping + checkout buyer experience)

- **Ngày:** 2026-05-20
- **Trạng thái:** Design — sẵn sàng cho writing-plans (user uỷ quyền review trực tiếp trên hệ thống)
- **Sub-project:** #2 / 6
- **Spec phụ thuộc:** spec #1 (Foundation + settings viewer read-only) — đã merge.

## 1. Bối cảnh & mục tiêu

Người dùng quản lý 2–5 Shopify Plus store, đa số settings shipping + checkout buyer experience là **dùng chung**, một số có custom riêng theo từng store. Spec #2 cho phép định nghĩa một **template chung** + **per-store override**, rồi đồng bộ lên các store an toàn — tránh phải vào admin Shopify chỉnh từng store một.

### Phạm vi spec #2

- **Shipping**: zones + rates trong default delivery profile.
- **Checkout buyer experience**: phone required, company name required, marketing consent default, tipping (tuỳ API support).
- Cơ chế ghi: read-then-mirror với reconciliation lần đầu mỗi store.
- 4 lớp an toàn (snapshot, dry-run + diff, confirmation, rollback) + staged rollout.
- Re-OAuth khi thêm scopes ghi.

### Ngoài phạm vi (để spec sau)

- **Checkout branding** (màu, font, layout) — per-store, không template — gộp với theme spec hoặc tách riêng.
- **Customer accounts** (classic vs new) — tương lai có custom per-website.
- **Payment customizations / Discounts / Tax** — chưa cần.
- **Shipping locations / custom delivery profiles / local pickup** — spec mở rộng sau.

### Tiêu chí thành công

- Edit một template, apply lên N store, mỗi store giữ override riêng → các store có settings nhất quán với template, không drift.
- Tất cả thao tác ghi đều có snapshot trước, diff preview, confirmation, audit, rollback option.
- Lần đầu apply mỗi store phải qua reconciliation; mọi setting hiện có không khớp template được user quyết định "giữ làm override" hoặc "discard".
- Coverage ≥ 80% cho pure-logic core (`merge`, `diff`, `writer`, `reconciliation`, `apply`).
- Không feature ghi nào bypass được 4 gate của `writer.ts`.

## 2. Quyết định công nghệ

Giữ stack spec #1: Next.js App Router + TypeScript + Drizzle + Postgres (Railway) + Better-Auth + `@shopify/shopify-api`. Spec #2 không đổi stack, chỉ thêm:

- **Worker nền cho apply hàng loạt** — *không cần ở spec #2.* Apply chạy sequentially trong cùng request handler (timeout 300s của Vercel/Railway đủ cho 5 store × vài chục mutation mỗi store). Khi nào > 30 store/job, tách worker Railway riêng.

## 3. Kiến trúc & mô hình dữ liệu

```
┌─────────── Next.js app (Railway) ───────────────────┐
│  Shell + /f/settings-sync (new feature)              │
│  ┌──────────────────────────────────────────────┐   │
│  │  features/settings-sync/                      │   │
│  │   • domain/shipping.ts                        │   │
│  │   • domain/checkout-buyer-experience.ts       │   │
│  │   • merge.ts · diff.ts · apply.ts             │   │
│  │   • reconciliation.ts                         │   │
│  │   • ui/* (template editor, wizard, preview)   │   │
│  └──────────────────────────────────────────────┘   │
│  lib/shopify/connector.ts   (read — spec #1)         │
│  lib/shopify/writer.ts      (write — NEW, 4 gates)   │
└──────────────┬─────────────────────────┬─────────────┘
               │                         │
        Postgres (Railway)        Shopify Admin GraphQL
                                  (read + write mutations)
```

### Bảng mới

**`setting_templates`** — phiên bản hoá, không UPDATE
`id · domain ('shipping' | 'checkout_buyer_experience') · payload (jsonb) · version (int) · created_by · created_at`
Mỗi lần edit tạo bản version mới (auto-increment cho domain đó). Apply tham chiếu version cụ thể.

**`setting_overrides`** — per-store, granular theo path
`id · store_id (uuid, ref stores.id) · domain · path (text) · value (jsonb) · updated_by (text, ref user.id) · updated_at`
Unique `(store_id, domain, path)`. `path` dotted notation, ví dụ `zones.Domestic.rates.Standard.price`.

**`apply_runs`** — append-only
`id · template_id (ref setting_templates) · domain · target_store_ids (text array of stores.id) · status ('preview'|'in_progress'|'success'|'partial'|'failed'|'rolled_back') · started_by · started_at · finished_at · summary (jsonb: per-store create/update/delete counts) · parent_run_id (nullable, ref apply_runs — for rollback runs)`

**`reconciliation_status`** — per-store-per-domain gate
`id · store_id · domain · status ('pending'|'reconciled') · reconciled_at · reconciled_by`
Unique `(store_id, domain)`. Default `pending` khi feature lần đầu chạm store.

### Bảng dùng lại (từ spec #1)

- `settings_snapshots` — snapshot trước-apply (dedup `payload_hash`). Một snapshot pre-state mỗi (store, domain, apply_run). **Schema thay đổi**: thêm cột `apply_run_id` (uuid, nullable, ref `apply_runs.id`) để gắn snapshot với run đã tạo nó.
- `audit_log` — append-only. Mỗi apply run, mỗi mutation, mỗi reconciliation, mỗi rollback ghi 1 record.
- `feature_flags` — gate feature `settings-sync` per store.

### Cấu trúc thư mục

```
features/settings-sync/
  manifest.ts                  # hasWriteOperations: true, requiredScopes
  domain/
    shipping.ts                # type schema, fetchCurrent(store), buildOperations(diff)
    checkout-buyer-experience.ts
  merge.ts                     # mergeEffective(template, overrides) → effective
  diff.ts                      # diff(current, effective) → operations[]
  apply.ts                     # runApply({applyRunId, domain, storeId, dryRun}) → result
  reconciliation.ts            # listUnreconciled(storeId, domain) → items[]
  ui/
    TemplateEditor.tsx
    ReconciliationWizard.tsx
    ApplyPreview.tsx
    ApplyProgress.tsx
    ApplyHistory.tsx
lib/shopify/
  connector.ts                 # READ — spec #1, unchanged
  writer.ts                    # WRITE — NEW, 4 gates
app/
  f/settings-sync/
    page.tsx                   # feature home: links to templates, apply, history
    templates/page.tsx
    templates/[domain]/edit/page.tsx
    apply/page.tsx
    history/page.tsx
    history/[runId]/page.tsx
    reconcile/[storeId]/[domain]/page.tsx
    stores/[id]/overrides/[domain]/page.tsx
db/
  schema.ts                    # add setting_templates, setting_overrides,
                               # apply_runs, reconciliation_status tables
```

## 4. Connector write — máy móc an toàn 4 lớp

`lib/shopify/writer.ts` là **đường ghi duy nhất** ra Shopify. Tách hoàn toàn với `connector.ts` (read). Export `runMutation(args)` chỉ; không có catch-all `run()`.

```typescript
export interface RunMutationArgs {
  store: ConnectorStore;
  featureKey: string;
  requiredScopes: string[];
  applyRunId: string;     // BẮT BUỘC — chứng minh nằm trong một apply run hợp lệ
  domain: string;         // 'shipping' | 'checkout_buyer_experience'
  mutation: string;
  variables?: Record<string, unknown>;
  deps: WriterDeps;
}
```

**4 gate tuần tự** (mỗi gate có test riêng):

1. **Read gates** — `store.status==='active'`, `!maintenanceMode`, feature flag bật, scopes đủ. Y hệt reader.
2. **Manifest gate** — `featureRegistry.get(featureKey).hasWriteOperations === true`. Nếu false → `WriterError('feature does not declare write operations')`. Compile-time hỗ trợ bằng type guard: hàm `runMutation` chỉ chấp nhận `featureKey` mà manifest.hasWriteOperations là `true` (qua một map type).
3. **Reconciliation gate** — query `reconciliation_status` cho `(store.id, domain)`. Phải `reconciled`. Nếu `pending` → `ReconciliationRequiredError`; UI handler bắt error này và chuyển sang wizard.
4. **Snapshot gate** — query `settings_snapshots` filter `apply_run_id = args.applyRunId AND store_id = store.id AND domain = args.domain`. Phải tồn tại (pre-state snapshot đã chụp). Nếu chưa → `SnapshotRequiredError`.

→ *Lưu ý*: bảng `settings_snapshots` cần thêm cột `apply_run_id` (nullable, ref `apply_runs`). Snapshot do `apply.ts` chụp ở đầu run, gắn run id.

Sau 4 gate: gọi GraphQL mutation, retry với backoff giống reader, ghi `audit_log` (luôn — success/error đều ghi).

## 5. Apply flow

`features/settings-sync/apply.ts` điều phối. Một "apply run" gồm:

```
1. createApplyRun(template_id, domain, target_store_ids, status='in_progress')
2. For each store in target_store_ids (tuần tự):
   a. Check reconciliation_status[(store, domain)] = 'reconciled'.
      Nếu pending → halt run, status='failed', audit, UI báo user reconcile store đó.
   b. current = fetchCurrent(store, domain)   # qua reader
   c. effective = mergeEffective(template, overrides)
   d. ops = diff(current, effective)
   e. Nếu dryRun=true → trả ops về cho UI, không ghi DB.
   f. snapshot = captureSnapshot(store, domain, current, payload_hash, apply_run_id)
   g. For each op in ops:
        runMutation(...)   # qua writer
        record audit_log
        Nếu lỗi → halt run, status='partial', UI báo user
   h. Mark store done in apply_runs.summary
3. Mark apply_runs status='success' (hoặc 'partial' nếu có store lỗi).
```

**Diff representation** — identity dùng *semantic name*, không Shopify ID:
- Shipping zone identified bằng `name` (vd "Domestic", "International"); rate identified bằng `(zoneName, rateName)`.
- Buyer experience flat fields — diff trực tiếp từng field.
- `ops` = `{ creates: T[], updates: { path: string; before: unknown; after: unknown }[], deletes: T[] }`.

**Mapping semantic → Shopify ID**: lookup tại apply time. Zone tồn tại với name X trên store → update its existing Shopify ID. Zone trong template nhưng không tồn tại → create. Zone trên store nhưng không trong template+overrides → delete.

**Reconciliation wizard** (`reconciliation.ts` + `ReconciliationWizard.tsx`):
- Đầu vào: `(storeId, domain)` với reconciliation_status = pending.
- Process: fetch current từ store; tính `extras = { items trên store không khớp template+overrides }`.
- UI list từng item, mỗi item 2 radio: **"Giữ làm override"** | **"Sẽ xoá khi apply"**.
- Submit:
  - Tạo `setting_overrides` rows cho các item "giữ".
  - Set `reconciliation_status='reconciled'`.
  - Ghi audit `reconcile_store`.

**Rollback**:
- UI history page liệt kê `apply_runs`. Mỗi run có nút "Rollback".
- Click → tạo apply run mới với:
  - `parent_run_id` = run cũ.
  - "effective" = snapshot.payload từ run cũ.
  - Diff vs current → ops.
  - Apply như bình thường (snapshot ngược chụp luôn).
- Rollback chỉ tới snapshot pre-state của run đó, không tới state bất kỳ.

**Staged rollout**:
- UI mặc định "Apply to one store first" — user chọn store đầu tiên, run đó chạy, xanh thì hiện nút "Continue with remaining stores".
- Hoặc "Run all sequentially" — chạy hết một lượt, halt ở store lỗi.

**Concurrency**: chỉ một apply run pending/in_progress mỗi (store, domain). Check `apply_runs` trước khi tạo run mới; conflict → user thấy "Another apply is in progress for store X".

## 6. UX surfaces

`/f/settings-sync/` (feature route, namespace của feature module). Tất cả pages async server component (`dynamic = 'force-dynamic'`):

- **`page.tsx`** (home): cards cho "Shipping template", "Checkout buyer experience template", "Apply", "History". Warning banner nếu có store pending reconciliation.
- **`templates/page.tsx`**: list 2 domain với version mới nhất + date + author. Edit button cho mỗi domain.
- **`templates/[domain]/edit/page.tsx`**: form editor theo schema của domain (shipping: form cho zones + rates; checkout buyer-experience: form fields cho từng setting). Submit → create new version row.
- **`apply/page.tsx`**: 3 step UI — (1) chọn domain + template version, (2) chọn target stores (checkbox), (3) preview diff per store → confirm → progress UI.
- **`history/page.tsx`**: list `apply_runs` với status, store count, timestamp.
- **`history/[runId]/page.tsx`**: chi tiết 1 run, per-store ops, nút Rollback.
- **`reconcile/[storeId]/[domain]/page.tsx`**: wizard.
- **`stores/[id]/overrides/[domain]/page.tsx`**: list overrides của store đó cho domain đó; add/remove inline.

Shell `app/page.tsx` thêm link "Settings sync" và counter "N stores pending reconciliation" nếu > 0.

## 7. RBAC

Mở rộng matrix RBAC từ spec #1:

| Permission                    | viewer | operator | admin |
|-------------------------------|--------|----------|-------|
| view                          | ✓      | ✓        | ✓     |
| view_settings_history         | ✓      | ✓        | ✓     |
| run_feature                   | ✗      | ✓        | ✓     |
| apply_settings                | ✗      | ✓        | ✓     |
| reconcile_store               | ✗      | ✓        | ✓     |
| manage_settings_template      | ✗      | ✗        | ✓     |
| manage_stores                 | ✗      | ✗        | ✓     |

Template edit: chỉ admin (vì ảnh hưởng nhiều store). Apply + reconcile: operator trở lên.

## 8. Scopes & re-OAuth

Thêm vào `SHOPIFY_SCOPES`:
- `write_shipping` — cho deliveryProfile/zone/rate mutations.
- `write_customers` hoặc `write_shop` (verify chính xác ở implement; có thể là `write_payment_customizations` hoặc khác tuỳ buyer experience API hiện hành) — cho buyer experience config.

App config trên Shopify Dev Dashboard cập nhật scopes → mọi store đã cài phải re-OAuth.

Cơ chế phát hiện:
- "Test connection" mỗi store (đã có ở spec #1) so sánh `store.scopes` với `requiredScopes` của các feature đang bật. Thiếu → set `status='error'`, UI báo "Re-install needed: click to re-authorize".
- Click → redirect tới install route (đã có); Shopify hiện màn consent với scope mới; callback đã có cập nhật `stores.scopes`.

## 9. Error handling

| Lỗi | Xử lý |
|---|---|
| Mutation lỗi giữa chừng | Halt run, `apply_runs.status='partial'`, audit chi tiết, UI hiện link "Rollback to snapshot" |
| Re-OAuth scope thiếu | Block apply ở store đó, hướng dẫn re-install |
| Reconciliation pending | Block, redirect tới wizard |
| Concurrent apply trên cùng store | Check pending run, từ chối tạo run mới |
| Snapshot chưa chụp khi gọi writer | `SnapshotRequiredError`, return 500 với audit |
| Diff trả về empty (no-op) | Run vẫn record `apply_runs.status='success'` với summary 0 ops; không gọi mutation |
| Shopify rate limit | Backoff retry (giống reader); quá ngưỡng → 502, audit, halt run |
| Template version conflict | Apply tham chiếu version cụ thể nên không conflict; sau apply UI thông báo "version mới đã có" |
| DB lỗi giữa apply | Run halt; audit ghi; snapshot vẫn còn → user có thể rollback manually |

## 10. Testing

**Unit (coverage gate 80%, scope giữ phong cách spec #1):**
- `merge.ts` — deep merge, immutable, override path notation correct.
- `diff.ts` — semantic-name diff cho shipping (creates/updates/deletes); flat-field diff cho buyer-experience.
- `lib/shopify/writer.ts` — 4 gates đầy đủ: read gates + manifest + reconciliation + snapshot. Mỗi gate có test riêng.
- `reconciliation.ts` — listUnreconciled tính đúng diff giữa store-current và template+overrides.
- `apply.ts` — orchestration với deps inject (mock graphql + db + writer).

**Integration:**
- Full apply run e2e với mock Shopify GraphQL: createApplyRun → snapshot → mutations → audit → success.
- Reconciliation wizard flow: list → submit → overrides created → status reconciled.
- Re-OAuth detection: scopes thiếu → status error → re-install link.

**E2E (Playwright, cần DB thật):**
- Template edit creates new version.
- Apply preview shows diff.
- Apply confirm writes to mock-Shopify (sử dụng a test mode hoặc mock fetch interceptor).
- History page lists run; rollback creates inverse run.

## 11. Migration & re-install plan

Khi merge spec #2:
1. Migration mới tạo 4 bảng (templates, overrides, apply_runs, reconciliation_status) + thêm `apply_run_id` cột vào `settings_snapshots`.
2. Update `SHOPIFY_SCOPES` env.
3. Deploy.
4. Re-install app vào từng store (admin operation, qua UI install link).
5. Mỗi store lần đầu vào settings-sync sẽ tự tạo `reconciliation_status` row pending → user qua wizard.

## 12. Câu hỏi mở (giải quyết khi implement)

- Verify exact scopes Shopify đòi cho buyer experience (`shopBuyerExperienceConfiguration` mutation hoặc tương đương). Chốt tại bước writing-plans + verify với `@shopify/shopify-api` docs.
- Buyer experience có expose hết qua Admin GraphQL không (tipping, marketing consent default)? Nếu một số field thiếu API → giảm scope hoặc fall back vào REST Admin API.
- Template editor UI: form field cho từng key của template, hay JSON editor raw? Đề xuất: form field cho buyer experience (vài flat fields), JSON-aware structured editor cho shipping (zones + rates dạng list). Confirm khi implement.
