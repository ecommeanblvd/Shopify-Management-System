# Customer Account Builder P3 — Shopify UI Extension (Preact) + deploy guide — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Spec: `docs/superpowers/specs/2026-07-05-customer-account-builder-design.md` §7 + Shopify docs 2026-04.

**Goal:** Package `shopify-extension/` (1 Customer Account UI Extension, Preact + Polaris `s-*`, api_version 2026-04) đọc config + data từ SMS API (P1/P2) và render modules; + `docs/customer-account-deploy.md` deploy guide; + cập nhật Second Brain.

**Architecture:** Package RIÊNG, EXCLUDE khỏi root tsconfig/eslint/vitest (Q11 — không ảnh hưởng SMS CI/deploy). Logic thuần `render-plan.ts` (config→thứ tự module) test standalone. Component Shopify-facing giao dev build qua Shopify CLI (`shopify app dev` preview). Auth: `shopify.sessionToken.get()` → Bearer tới SMS.

**Tech Stack:** Preact, `@shopify/ui-extensions/preact`, Vitest (trong package).

## Global Constraints

- api_version **`2026-04`**; Preact + custom elements `s-*` (KHÔNG React legacy, KHÔNG DOM/CSS tự do).
- Backend URL per-store: extension settings field `backend_url` (type url) → đọc qua `shopify.settings`.
- Auth SMS: `await shopify.sessionToken.get()` → `Authorization: Bearer <token>` (SMS verify — P1).
- Customer Account GraphQL (store credit): `fetch('shopify://customer-account/api/2025-07/graphql.json', ...)` (auth tự động).
- Wishlist: `GET <backend_url>/api/storefront/wishlist?shop=<dest domain>&email=<customer email>` (API sẵn có; KHÔNG session token — API riêng).
- SMS API endpoints (P1/P2, tương đối với `backend_url`): `/api/customer-account/config`, `/orders`, `/orders/:id/timeline`, `/loyalty`, `/returns` (GET/POST). Response shape khớp SMS (§5 spec).
- KHÔNG npm-install trong quá trình build SMS; extension có package.json riêng (dev tự `npm install`).
- Copy tiếng Anh (store quốc tế), tone luxury tối giản; icon PNG không nền từ config (`s-image src`).

---

### Task 1: Scaffold package + config toml + render-plan thuần + api client

**Files (tất cả dưới `shopify-extension/`):**
- Create `shopify.app.toml`, `extensions/customer-account-hub/shopify.extension.toml`
- Create `package.json`, `tsconfig.json`, `.gitignore`
- Create `src/lib/render-plan.ts` · Test `src/lib/render-plan.test.ts`
- Create `src/lib/api.ts`
- Modify (root) `tsconfig.json`, `eslint.config.*`, `vitest.config.*` — EXCLUDE `shopify-extension`

**Interfaces (Produces):**
```ts
// src/lib/render-plan.ts (THUẦN — không import Shopify)
export type ModuleKey = 'profile' | 'credit' | 'tracking' | 'wishlist' | 'returns';
export interface ConfigModule { key: ModuleKey; title: string | null; iconUrl: string | null }
export interface AccountConfig { enabled: boolean; branding: { logoUrl: string | null; heroUrl: string | null; supportEmail: string | null; announcement: string | null }; modules: ConfigModule[] }
export function renderPlan(config: AccountConfig): ConfigModule[]; // enabled=false → []; else modules đúng thứ tự (đã lọc enabled ở backend)
export const DEFAULT_TITLES: Record<ModuleKey, string>; // fallback title EN khi config.title null
```

- [ ] **Step 1: Exclude package khỏi root tooling**

Root `tsconfig.json`: thêm `"shopify-extension"` vào `exclude`. Root eslint config: thêm ignore `shopify-extension/**`. Root `vitest.config.ts`: thêm `test.exclude` `'shopify-extension/**'` (giữ default excludes). Verify `npx tsc --noEmit` + `npx vitest run` (root) KHÔNG chạm package.

- [ ] **Step 2: Scaffold files**

`shopify-extension/package.json`:
```json
{
  "name": "customer-account-hub-extension",
  "private": true,
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@shopify/ui-extensions": "^2026.4.0", "preact": "^10.24.0" },
  "devDependencies": { "typescript": "^5", "vitest": "^4" }
}
```
`shopify-extension/tsconfig.json`: target ES2022, module ESNext, jsx `react-jsx`, jsxImportSource `preact`, strict, `types: []`, include `src`.
`shopify-extension/.gitignore`: `node_modules`, `dist`, `.shopify`.
`shopify-extension/shopify.app.toml`:
```toml
# Điền client_id sau khi tạo Custom App (xem docs/customer-account-deploy.md)
client_id = "REPLACE_WITH_APP_CLIENT_ID"
name = "MEAN Customer Account Hub"
application_url = "https://REPLACE_WITH_SMS_URL"
embedded = false

[access_scopes]
scopes = "read_customers"

[webhooks]
api_version = "2026-04"
```
`shopify-extension/extensions/customer-account-hub/shopify.extension.toml`:
```toml
api_version = "2026-04"

[[extensions]]
type = "ui_extension"
name = "Customer Account Hub"
handle = "customer-account-hub"
uid = "customer-account-hub"
description = "MEAN customer account: profile, credit, tracking, wishlist, returns."

  [[extensions.targeting]]
  target = "customer-account.page.render"
  module = "./src/Page.tsx"

  [[extensions.targeting]]
  target = "customer-account.profile.block.render"
  module = "./src/ProfileBlock.tsx"

  [[extensions.targeting]]
  target = "customer-account.order-status.block.render"
  module = "./src/OrderStatusBlock.tsx"

  [extensions.capabilities]
  network_access = true

  [extensions.settings]
    [[extensions.settings.fields]]
    key = "backend_url"
    type = "url"
    name = "SMS backend URL"
    description = "Base URL của SMS (vd https://shopify-management-system-production.up.railway.app)."
```

- [ ] **Step 3: Test render-plan (FAIL trước)**

```ts
// shopify-extension/src/lib/render-plan.test.ts
import { describe, it, expect } from 'vitest';
import { renderPlan, DEFAULT_TITLES, type AccountConfig } from './render-plan';
const cfg = (over: Partial<AccountConfig> = {}): AccountConfig => ({
  enabled: true, branding: { logoUrl: null, heroUrl: null, supportEmail: null, announcement: null },
  modules: [{ key: 'tracking', title: null, iconUrl: null }, { key: 'wishlist', title: 'Saved', iconUrl: null }], ...over,
});
describe('renderPlan', () => {
  it('enabled=false → rỗng', () => { expect(renderPlan(cfg({ enabled: false }))).toEqual([]); });
  it('giữ đúng thứ tự module backend trả', () => {
    expect(renderPlan(cfg()).map((m) => m.key)).toEqual(['tracking', 'wishlist']);
  });
  it('DEFAULT_TITLES đủ 5 key', () => {
    for (const k of ['profile', 'credit', 'tracking', 'wishlist', 'returns'] as const) expect(DEFAULT_TITLES[k].length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Implement render-plan.ts + api.ts**

render-plan.ts: `renderPlan` trả `config.enabled ? config.modules : []`; `DEFAULT_TITLES = { profile:'Profile', credit:'Store credit & tier', tracking:'Order tracking', wishlist:'Wishlist', returns:'Returns' }`.

api.ts (import type từ render-plan; runtime dùng global `shopify` — khai `declare const shopify: any` để tsc package pass mà không cần types Shopify đầy đủ; hoặc `import type` tối thiểu):
```ts
// shopify-extension/src/lib/api.ts
import type { AccountConfig } from './render-plan';
declare const shopify: { sessionToken: { get(): Promise<string> }; settings: { backend_url?: string } };

async function smsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = shopify.settings.backend_url;
  if (!base) throw new Error('backend_url chưa cấu hình trong extension settings');
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SMS ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface OrderRow { orderId: string; orderNumber: string; placedAt: string; total: string; currency: string; currentStage: string | null }
export interface TimelineStep { label: string; at: string | null }
export interface PublicTimeline { currentStage: string; currentStageLabel: string; nextStageLabel: string | null; steps: TimelineStep[] }
export interface ReturnRow { id: string; orderId: string; orderNumber: string | null; reason: string; status: string; createdAt: string }

export const getConfig = () => smsFetch<AccountConfig>('/api/customer-account/config');
export const getOrders = () => smsFetch<{ orders: OrderRow[] }>('/api/customer-account/orders');
export const getTimeline = (orderId: string) => smsFetch<{ timeline: PublicTimeline }>(`/api/customer-account/orders/${orderId}/timeline`);
export const getLoyalty = () => smsFetch<{ tier: string | null; note?: string | null }>('/api/customer-account/loyalty');
export const getReturns = () => smsFetch<{ returns: ReturnRow[] }>('/api/customer-account/returns');
export const createReturn = (orderId: string, reason: string, note?: string) =>
  smsFetch<{ ok: boolean; id?: string; error?: string }>('/api/customer-account/returns', { method: 'POST', body: JSON.stringify({ orderId, reason, note }) });
```

- [ ] **Step 5: Verify + commit**

Run (package): `cd shopify-extension && npx vitest run src/lib/render-plan.test.ts` → PASS (cd về root sau).
Run (root): `npx tsc --noEmit` → 0 (package đã exclude), `npx vitest run` → root suite KHÔNG gồm package test.
```bash
git add shopify-extension tsconfig.json eslint.config.mjs vitest.config.ts
git commit -m "feat(customer-account): scaffold Shopify extension package (Preact 2026-04) + render-plan/api thuần + test"
```
(Tên file eslint/vitest config kiểm thực tế trong repo — root có thể là `.mjs`/`.ts`.)

---

### Task 2: Full page `Page.tsx` + 5 module component

**Files (dưới `shopify-extension/src/`):** Create `Page.tsx`, `modules/ProfileCard.tsx`, `modules/CreditCard.tsx`, `modules/TrackingList.tsx`, `modules/WishlistCard.tsx`, `modules/ReturnCenter.tsx`

**Interfaces:** Consumes `render-plan.ts` + `api.ts` (T1); global `shopify` (authenticatedAccount, settings); Customer Account GraphQL qua `fetch('shopify://...')`.

- [ ] **Step 1: Page.tsx** (entry Preact)

Pattern (theo Shopify docs 2026-04):
```tsx
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getConfig } from './lib/api';
import { renderPlan, DEFAULT_TITLES, type ConfigModule, type AccountConfig } from './lib/render-plan';
import { ProfileCard } from './modules/ProfileCard';
import { CreditCard } from './modules/CreditCard';
import { TrackingList } from './modules/TrackingList';
import { WishlistCard } from './modules/WishlistCard';
import { ReturnCenter } from './modules/ReturnCenter';

function Hub() {
  const [config, setConfig] = useState<AccountConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getConfig().then(setConfig).catch((e) => setError(String(e?.message ?? e))); }, []);
  if (error) return <s-banner tone="critical"><s-text>{error}</s-text></s-banner>;
  if (!config) return <s-spinner />;
  if (!config.enabled) return <s-section><s-text>Account hub is not enabled for this store.</s-text></s-section>;
  const plan = renderPlan(config);
  return (
    <s-page heading="My account">
      {config.branding.announcement ? <s-banner><s-text>{config.branding.announcement}</s-text></s-banner> : null}
      <s-stack direction="block" gap="large">
        {plan.map((m) => <Module key={m.key} m={m} branding={config.branding} />)}
      </s-stack>
    </s-page>
  );
}
function Module({ m, branding }: { m: ConfigModule; branding: AccountConfig['branding'] }) {
  const title = m.title ?? DEFAULT_TITLES[m.key];
  switch (m.key) {
    case 'profile': return <ProfileCard title={title} icon={m.iconUrl} />;
    case 'credit': return <CreditCard title={title} icon={m.iconUrl} />;
    case 'tracking': return <TrackingList title={title} icon={m.iconUrl} />;
    case 'wishlist': return <WishlistCard title={title} icon={m.iconUrl} supportEmail={branding.supportEmail} />;
    case 'returns': return <ReturnCenter title={title} icon={m.iconUrl} />;
  }
}
export default async () => { render(<Hub />, document.body); };
```
(Kiểm chính xác cách export entry + JSX intrinsic `s-*` theo `@shopify/ui-extensions/preact` docs; nếu cần khai `declare global` JSX cho `s-*`, thêm `src/shopify.d.ts` với `declare namespace preact.JSX { interface IntrinsicElements { [k: `s-${string}`]: any } }`.)

- [ ] **Step 2: 5 module component** (mỗi cái `s-section` heading title + optional `s-image src={icon}` khi có)

- **ProfileCard**: `shopify.authenticatedAccount.customer` (name/email) + Customer Account GraphQL `{ customer { defaultAddress { formatted } } }` → hiện tên/email/địa chỉ (`s-text`).
- **CreditCard**: Customer Account GraphQL `{ customer { storeCreditAccounts(first:5){ nodes { balance { amount currencyCode } } } } }` (nếu field không có ở version → try/catch, ẩn) + `getLoyalty()` tier → badge `s-badge`. (Ghi comment: verify field storeCreditAccounts theo schema version thực tế — deploy guide nhắc.)
- **TrackingList**: `getOrders()` → list; bấm 1 đơn → `getTimeline(id)` → stepper các `steps` (`s-stack` + `s-text` label + `s-time`); hiện `currentStageLabel` → `nextStageLabel`.
- **WishlistCard**: lấy email từ `shopify.authenticatedAccount.customer.email` + shop domain từ token/settings → `fetch(<backend_url>/api/storefront/wishlist?shop=…&email=…)` (KHÔNG session token) → list sản phẩm (`s-product-thumbnail`/`s-text`). Lỗi/trống → `s-text` "No saved items".
- **ReturnCenter**: `getReturns()` list (status badge) + form (`s-select` chọn đơn từ getOrders + `s-text-field` reason) → `createReturn()` → refresh; báo `s-banner` khi ok/lỗi.

Mỗi component: loading `s-spinner`, error `s-banner`, empty state nhã.

- [ ] **Step 3: Verify (package tsc) + commit**

Run: `cd shopify-extension && npx tsc --noEmit` → 0 (cần `npm install` trước; nếu môi trường không install được → BÁO, để dev chạy; tối thiểu đảm bảo render-plan/api tsc pass + code cấu trúc đúng). Root `npx tsc --noEmit` vẫn 0.
```bash
git add shopify-extension/src
git commit -m "feat(customer-account): extension full-page Hub + 5 module (profile/credit/tracking/wishlist/returns)"
```

---

### Task 3: 2 block component + JSX types

**Files:** Create `shopify-extension/src/ProfileBlock.tsx`, `shopify-extension/src/OrderStatusBlock.tsx`, `shopify-extension/src/shopify.d.ts` (nếu cần khai JSX `s-*`)

- **ProfileBlock** (`customer-account.profile.block.render`): mini — `getLoyalty()` tier badge + link tới full page. Gọn.
- **OrderStatusBlock** (`customer-account.order-status.block.render`): lấy orderId từ context (`shopify` order-status target cung cấp order id — kiểm API target) → `getTimeline(orderId)` → stepper gọn. Nếu target không cấp order id trực tiếp → ẩn/thông báo (comment cho dev).
- `shopify.d.ts`: khai JSX intrinsic `s-*` nếu package tsc cần.

- [ ] **Verify + commit**

Run: `cd shopify-extension && npx tsc --noEmit` (best-effort) · root `npx tsc --noEmit` 0.
```bash
git add shopify-extension/src
git commit -m "feat(customer-account): extension blocks profile + order-status tracking"
```

---

### Task 4: Deploy guide + Second Brain

**Files:** Create `docs/customer-account-deploy.md` · Modify Second Brain (Activity Log, Decisions, Overview)

- [ ] **Step 1: `docs/customer-account-deploy.md`** — deploy guide CỰC CƠ BẢN (theo research + spec):
  1. **Chuẩn bị**: Shopify Partners account; Node 18+; `npm i -g @shopify/cli`.
  2. **Tạo Custom App per store**: Admin → Settings → Apps and sales channels → Develop apps → Create app; scope `read_customers`; lấy **Client ID** + **API secret key**.
  3. **Cấu hình SMS env** (Railway): `CUSTOMER_ACCOUNT_APP_SECRETS` = API secret key (nhiều app → phân cách dấu phẩy); `CUSTOMER_ACCOUNT_APP_CLIENT_IDS` = Client ID(s) (optional). Redeploy.
  4. **Build extension**: `cd shopify-extension`; điền `client_id` + `application_url` (SMS URL) vào `shopify.app.toml`; `npm install`; `shopify app dev` (preview trên dev store — verify UI + fetch config); rồi `shopify app deploy`.
  5. **Kích hoạt trong store**: Settings → Checkout → Customize → Checkout and Accounts Editor → thêm block/full-page extension vào trang customer account; nhập **SMS backend URL** vào settings `backend_url` của extension; Save/Publish.
  6. **Bật config trong SMS**: `/f/customer-account` → chọn store → bật + cấu hình module + upload PNG.
  7. **Lưu ý**: verify field `storeCreditAccounts` theo Customer Account API version thực tế; CORS SMS đã set `extensions.shopifycdn.com`; token verify tự động.

- [ ] **Step 2: Second Brain** (`/Users/macos/Obsidian/Le Minh Tiep Second Brain/Shared/Projects/Shopify-Management-System/`):
  - `Activity Log.md`: append entry (theo template) — Customer Account Builder P1-P3.
  - `Decisions.md`: thêm **D-010** (Customer Account Builder: config-hub trên SMS + 1 extension chung, auth session-token JWT, store credit đọc trực tiếp Customer Account API, loyalty gán tay).
  - `Overview.md`: cập nhật danh sách feature module (+customer-account) + số bảng.

- [ ] **Step 3: Commit**

```bash
git add docs/customer-account-deploy.md
git commit -m "docs(customer-account): deploy guide cơ bản (custom app + extension + env + kích hoạt)"
```
(Second Brain nằm ngoài repo — commit riêng nếu là git repo, hoặc chỉ ghi file.)

---

## Self-Review (đã chạy)

- **Spec coverage §7 + deliverable:** extension 3 target + 5 module (T2/T3) ✓ · config-driven render (T1 render-plan) ✓ · auth session token (api.ts) ✓ · store credit Customer Account API + loyalty SMS (CreditCard) ✓ · wishlist API sẵn có (WishlistCard) ✓ · returns (ReturnCenter) ✓ · deploy guide (T4) ✓ · Second Brain (T4) ✓ · PNG assets qua config iconUrl/logoUrl ✓.
- **Placeholder scan:** toml/scaffold/render-plan/api đầy đủ; component mô tả cấu trúc + data source cụ thể (dev build qua CLI — không runtime-verify được ở đây, deploy guide nêu `shopify app dev`).
- **Isolation:** package exclude khỏi root tsconfig/eslint/vitest (T1) → SMS CI/deploy KHÔNG ảnh hưởng; render-plan thuần test standalone.
- **Rủi ro:** API 2026-04 mới — component có thể cần chỉnh nhỏ khi `shopify app dev` (deploy guide đã nêu); `storeCreditAccounts` field verify theo version; entry export pattern theo docs.
