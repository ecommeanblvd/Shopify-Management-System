# Ship hộ Phase 3 — Plan B: Partner-requests receiver + duyệt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhận đăng ký dịch vụ ship hộ của brand từ MMP (`POST /api/mmp/ship-ho/partner-requests`), cho MEAN duyệt/từ chối (duyệt → bật `self_service_enabled` + markup ≥30), và callback kết quả về MMP.

**Architecture:** Bảng `ship_ho_partner_requests` (cột lõi + `payload jsonb`) + core `partner-request-actions.ts` (create dedupe / approve / reject / resend-callback + callback sender ký `signMmpPayload`) + endpoint HMAC + trang MEAN review.

**Tech Stack:** Next.js App Router (breaking-changes fork), Drizzle ORM, Vitest, HMAC (`signMmpPayload`).

## Global Constraints

- Verify MMP→SMS bằng `verifyMmpSignature` + `MMP_WEBHOOK_SECRET` (đọc rawBody trước parse).
- Callback SMS→MMP ký `signMmpPayload(secret, ts, rawBody)` + `MMP_OUTBOUND_SECRET`, POST `MMP_SHIP_HO_WEBHOOK_URL`. Chưa cấu hình env → callback no-op (ghi `callback_error`, MEAN gửi lại sau).
- Duyệt: markup **≥ 30** (dùng `markupFloorError` sẵn có). Duyệt → upsert `ship_ho_partners`: `self_service_enabled=true`, `status='active'`, markup; set request `approved`.
- Callback envelope: `{ event, brandSlug, ref, occurredAt, data }`. `event` ∈ `partner.request.approved | partner.request.rejected`.
- Best-effort callback (không cron): lưu `callback_sent_at`/`callback_error`; nút "Gửi lại callback" khi lỗi.
- `id` của request = `ref` trả MMP. Dedupe: 1 request `pending`/brand.
- Migration kế tiếp: **0096** (viết tay + append journal, KHÔNG `db:generate`).
- Trước push: `npx tsc --noEmit` + `npx vitest run` xanh.
- Commit message kết thúc bằng: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: DB — `ship_ho_partner_requests`

**Files:**
- Create: `db/migrations/0096_ship-ho-partner-requests.sql`
- Modify: `db/schema.ts`, `db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: bảng `shipHoPartnerRequests` + enum `ship_ho_partner_request_status`.

- [ ] **Step 1: Migration SQL**

Tạo `db/migrations/0096_ship-ho-partner-requests.sql`:

```sql
CREATE TYPE "ship_ho_partner_request_status" AS ENUM('pending', 'approved', 'rejected');

CREATE TABLE "ship_ho_partner_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_slug" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"status" "ship_ho_partner_request_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"callback_sent_at" timestamp,
	"callback_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "ship_ho_partner_requests_status_idx" ON "ship_ho_partner_requests" ("status");
CREATE INDEX "ship_ho_partner_requests_brand_idx" ON "ship_ho_partner_requests" ("brand_slug");
```

- [ ] **Step 2: Schema Drizzle**

Trong `db/schema.ts`, thêm (sau khối shipHoPartners hoặc gần nhóm ship-ho):

```ts
export const shipHoPartnerRequestStatusEnum = pgEnum('ship_ho_partner_request_status', ['pending', 'approved', 'rejected']);

export const shipHoPartnerRequests = pgTable('ship_ho_partner_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandSlug: text('brand_slug').notNull(),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  status: shipHoPartnerRequestStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').notNull(),
  reviewNote: text('review_note'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  callbackSentAt: timestamp('callback_sent_at'),
  callbackError: text('callback_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

- [ ] **Step 3: Append journal** — idx 96 tag `0096_ship-ho-partner-requests`, `when` > entry cuối. Kiểm JSON hợp lệ.

- [ ] **Step 4: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add db/migrations/0096_ship-ho-partner-requests.sql db/migrations/meta/_journal.json db/schema.ts
git commit -m "feat(ship-ho): migration ship_ho_partner_requests (đăng ký dịch vụ brand)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Core actions + callback

**Files:**
- Create: `features/ship-ho/partner-request-actions.ts`
- Test: `features/ship-ho/partner-request-callback.test.ts`

**Interfaces:**
- Consumes: `signMmpPayload` (`@/features/mmp/hmac`); `markupFloorError` (`./partners-markup`); `requireManageShipHo`; `db, schema`; `eq, and`.
- Produces:
  - `buildPartnerCallbackEnvelope(req: { brandSlug: string; id: string }, event: string, note: string | null, occurredAtIso: string)` (thuần) → `{ event, brandSlug, ref, occurredAt, data: { note } }`
  - `createPartnerRequest(body: { brandSlug: string; contactName?: string; contactEmail?: string; contactPhone?: string; [k: string]: unknown }): Promise<{ ok: true; ref: string } | { ok: false; code: string; error: string }>`
  - `approvePartnerRequest(id: string, markupPercent: string, reviewer: string, note?: string): Promise<{ ok: boolean; error?: string }>`
  - `rejectPartnerRequest(id: string, reason: string, reviewer: string): Promise<{ ok: boolean; error?: string }>`
  - `resendPartnerCallback(id: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Test thất bại (phần thuần)**

Tạo `features/ship-ho/partner-request-callback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPartnerCallbackEnvelope } from './partner-request-actions';

describe('buildPartnerCallbackEnvelope', () => {
  it('đúng shape { event, brandSlug, ref, occurredAt, data }', () => {
    const e = buildPartnerCallbackEnvelope({ brandSlug: 'kalisa', id: 'req1' }, 'partner.request.approved', 'ok', '2026-07-04T00:00:00.000Z');
    expect(e).toEqual({ event: 'partner.request.approved', brandSlug: 'kalisa', ref: 'req1', occurredAt: '2026-07-04T00:00:00.000Z', data: { note: 'ok' } });
  });
  it('note null vẫn hợp lệ', () => {
    const e = buildPartnerCallbackEnvelope({ brandSlug: 'x', id: 'r' }, 'partner.request.rejected', null, '2026-07-04T00:00:00.000Z');
    expect(e.data).toEqual({ note: null });
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run features/ship-ho/partner-request-callback.test.ts`.

- [ ] **Step 3: Implement**

Tạo `features/ship-ho/partner-request-actions.ts`:

```ts
'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { signMmpPayload } from '@/features/mmp/hmac';
import { markupFloorError } from './partners-markup';
import { requireManageShipHo } from './require-manage';

/** THUẦN: envelope callback partner-request SMS→MMP. */
export function buildPartnerCallbackEnvelope(
  req: { brandSlug: string; id: string }, event: string, note: string | null, occurredAtIso: string,
) {
  return { event, brandSlug: req.brandSlug, ref: req.id, occurredAt: occurredAtIso, data: { note } };
}

/** Best-effort gửi callback; cập nhật callback_sent_at/error. Không throw. */
async function sendPartnerCallback(reqRow: { id: string; brandSlug: string }, event: string, note: string | null): Promise<void> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  const envelope = buildPartnerCallbackEnvelope(reqRow, event, note, new Date().toISOString());
  if (!url || !secret) {
    await db.update(schema.shipHoPartnerRequests).set({ callbackError: 'not configured' }).where(eq(schema.shipHoPartnerRequests.id, reqRow.id));
    return;
  }
  const rawBody = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signMmpPayload(secret, ts, rawBody);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mean-signature': signature, 'x-mean-timestamp': String(ts) }, body: rawBody, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    await db.update(schema.shipHoPartnerRequests).set({ callbackSentAt: new Date(), callbackError: null }).where(eq(schema.shipHoPartnerRequests.id, reqRow.id));
  } catch (e) {
    await db.update(schema.shipHoPartnerRequests).set({ callbackError: e instanceof Error ? e.message : 'fetch failed' }).where(eq(schema.shipHoPartnerRequests.id, reqRow.id));
  }
}

/** MMP→SMS: nhận đăng ký. Dedupe 1 pending/brand. Trả ref. (Endpoint tự verify HMAC + auth; hàm này KHÔNG requireManage.) */
export async function createPartnerRequest(
  body: { brandSlug: string; contactName?: string; contactEmail?: string; contactPhone?: string; [k: string]: unknown },
): Promise<{ ok: true; ref: string } | { ok: false; code: string; error: string }> {
  if (!body.brandSlug) return { ok: false, code: 'bad_input', error: 'brandSlug required' };
  const [dup] = await db.select({ id: schema.shipHoPartnerRequests.id }).from(schema.shipHoPartnerRequests)
    .where(and(eq(schema.shipHoPartnerRequests.brandSlug, body.brandSlug), eq(schema.shipHoPartnerRequests.status, 'pending'))).limit(1);
  if (dup) return { ok: true, ref: dup.id };
  const [row] = await db.insert(schema.shipHoPartnerRequests).values({
    brandSlug: body.brandSlug,
    contactName: (body.contactName as string) || null,
    contactEmail: (body.contactEmail as string) || null,
    contactPhone: (body.contactPhone as string) || null,
    payload: body,
  }).returning({ id: schema.shipHoPartnerRequests.id });
  return { ok: true, ref: row.id };
}

/** MEAN duyệt: markup ≥30, upsert partner self_service_enabled=true, set approved, callback. */
export async function approvePartnerRequest(id: string, markupPercent: string, reviewer: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const floorErr = markupFloorError(markupPercent);
  if (floorErr) return { ok: false, error: floorErr };
  const [req] = await db.select().from(schema.shipHoPartnerRequests).where(eq(schema.shipHoPartnerRequests.id, id)).limit(1);
  if (!req) return { ok: false, error: 'Không tìm thấy request' };

  const [existing] = await db.select({ id: schema.shipHoPartners.id }).from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, req.brandSlug)).limit(1);
  if (existing) {
    await db.update(schema.shipHoPartners).set({ markupPercent, status: 'active', selfServiceEnabled: true }).where(eq(schema.shipHoPartners.brandSlug, req.brandSlug));
  } else {
    await db.insert(schema.shipHoPartners).values({ brandSlug: req.brandSlug, markupPercent, selfServiceEnabled: true, status: 'active' });
  }
  await db.update(schema.shipHoPartnerRequests).set({ status: 'approved', reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: note || null }).where(eq(schema.shipHoPartnerRequests.id, id));
  await sendPartnerCallback({ id: req.id, brandSlug: req.brandSlug }, 'partner.request.approved', note || null);
  revalidatePath('/f/ship-ho/partner-requests');
  return { ok: true };
}

/** MEAN từ chối. */
export async function rejectPartnerRequest(id: string, reason: string, reviewer: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [req] = await db.select().from(schema.shipHoPartnerRequests).where(eq(schema.shipHoPartnerRequests.id, id)).limit(1);
  if (!req) return { ok: false, error: 'Không tìm thấy request' };
  await db.update(schema.shipHoPartnerRequests).set({ status: 'rejected', reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: reason }).where(eq(schema.shipHoPartnerRequests.id, id));
  await sendPartnerCallback({ id: req.id, brandSlug: req.brandSlug }, 'partner.request.rejected', reason);
  revalidatePath('/f/ship-ho/partner-requests');
  return { ok: true };
}

/** Gửi lại callback (khi lỗi). Dùng trạng thái hiện tại của request. */
export async function resendPartnerCallback(id: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [req] = await db.select().from(schema.shipHoPartnerRequests).where(eq(schema.shipHoPartnerRequests.id, id)).limit(1);
  if (!req) return { ok: false, error: 'Không tìm thấy request' };
  if (req.status === 'pending') return { ok: false, error: 'Request chưa duyệt/từ chối' };
  const event = req.status === 'approved' ? 'partner.request.approved' : 'partner.request.rejected';
  await sendPartnerCallback({ id: req.id, brandSlug: req.brandSlug }, event, req.reviewNote ?? null);
  revalidatePath('/f/ship-ho/partner-requests');
  return { ok: true };
}
```

*(Ghi chú: `buildPartnerCallbackEnvelope` là export thuần trong file `'use server'` — Next cho phép export hàm sync? KHÔNG. Nếu `npx tsc`/Next báo lỗi 'use server' chỉ cho async export, TÁCH `buildPartnerCallbackEnvelope` sang file thường `features/ship-ho/partner-request-envelope.ts` và import vào; test trỏ file đó. Ưu tiên tách sẵn để tránh lỗi.)*

- [ ] **Step 4: PASS + tsc + Commit**

Run: `npx vitest run features/ship-ho/partner-request-callback.test.ts` → PASS. `npx tsc --noEmit` → PASS.
```bash
git add features/ship-ho/partner-request-*.ts
git commit -m "feat(ship-ho): partner-request core — create/approve/reject/resend + callback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Endpoint `POST /api/mmp/ship-ho/partner-requests`

**Files:**
- Create: `app/api/mmp/ship-ho/partner-requests/route.ts`

**Interfaces:**
- Consumes: `verifyMmpSignature`, `createPartnerRequest`.

- [ ] **Step 1: Route (HMAC vào)**

Tạo `app/api/mmp/ship-ho/partner-requests/route.ts`:

```ts
/**
 * POST /api/mmp/ship-ho/partner-requests
 * MMP → SMS: brand đăng ký dịch vụ ship hộ. HMAC SHA-256 (x-mean-signature, x-mean-timestamp).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { createPartnerRequest } from '@/features/ship-ho/partner-request-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });
  const rawBody = await req.text();
  const hmac = verifyMmpSignature({ secret, rawBody, signatureHeader: req.headers.get('x-mean-signature'), timestampHeader: req.headers.get('x-mean-timestamp') });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });
  let body: { brandSlug?: string };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.brandSlug) return NextResponse.json({ error: 'brandSlug required' }, { status: 400 });
  const r = await createPartnerRequest(body as { brandSlug: string });
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.code === 'bad_input' ? 400 : 422 });
  return NextResponse.json({ ok: true, ref: r.ref });
}
```

- [ ] **Step 2: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add "app/api/mmp/ship-ho/partner-requests/route.ts"
git commit -m "feat(ship-ho): API POST /api/mmp/ship-ho/partner-requests (HMAC) — nhận đăng ký brand

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: MEAN review page

**Files:**
- Create: `app/(dashboard)/f/ship-ho/partner-requests/page.tsx`
- Create: `app/(dashboard)/f/ship-ho/partner-requests/RequestRow.tsx`

**Interfaces:**
- Consumes: `approvePartnerRequest`, `rejectPartnerRequest`, `resendPartnerCallback`; auth pattern như trang ship-ho khác.

- [ ] **Step 1: Trang server list**

Tạo `app/(dashboard)/f/ship-ho/partner-requests/page.tsx` — auth `manage_ship_ho` (như rate-card page); query `db.select().from(schema.shipHoPartnerRequests).orderBy(desc(createdAt))`; render bảng: brand, contact, status, ngày, callback status, + `<RequestRow>` cho hành động. Đọc `app/(dashboard)/f/ship-ho/[id]/page.tsx` để copy khối auth chính xác.

```tsx
import { desc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { RequestRow } from './RequestRow';

export const dynamic = 'force-dynamic';

export default async function PartnerRequestsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const rows = await db.select().from(schema.shipHoPartnerRequests).orderBy(desc(schema.shipHoPartnerRequests.createdAt));
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Đăng ký ship hộ</h1>
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr className="[&>th]:text-left [&>th]:p-2">
            <th>Brand</th><th>Liên hệ</th><th>Trạng thái</th><th>Callback</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b [&>td]:p-2 align-top">
                <td className="font-medium">{r.brandSlug}</td>
                <td className="text-muted-foreground">{[r.contactName, r.contactEmail, r.contactPhone].filter(Boolean).join(' · ')}</td>
                <td>{r.status}</td>
                <td className="text-xs">{r.callbackError ? <span className="text-red-600">lỗi: {r.callbackError}</span> : r.callbackSentAt ? 'đã gửi' : '—'}</td>
                <td><RequestRow id={r.id} status={r.status} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Chưa có đăng ký.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Client RequestRow (nút duyệt/từ chối/gửi lại)**

Tạo `app/(dashboard)/f/ship-ho/partner-requests/RequestRow.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approvePartnerRequest, rejectPartnerRequest, resendPartnerCallback } from '@/features/ship-ho/partner-request-actions';

export function RequestRow({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const approve = () => { const m = prompt('Markup % (≥30)?', '30'); if (!m) return; start(async () => { const r = await approvePartnerRequest(id, m, 'mean'); setMsg(r.ok ? 'Đã duyệt' : r.error ?? 'Lỗi'); }); };
  const reject = () => { const r0 = prompt('Lý do từ chối?'); if (!r0) return; start(async () => { const r = await rejectPartnerRequest(id, r0, 'mean'); setMsg(r.ok ? 'Đã từ chối' : r.error ?? 'Lỗi'); }); };
  const resend = () => start(async () => { const r = await resendPartnerCallback(id); setMsg(r.ok ? 'Đã gửi lại' : r.error ?? 'Lỗi'); });
  return (
    <div className="flex items-center gap-2">
      {status === 'pending' && <><Button variant="outline" size="sm" disabled={pending} onClick={approve}>Duyệt</Button><Button variant="outline" size="sm" disabled={pending} onClick={reject}>Từ chối</Button></>}
      {status !== 'pending' && <Button variant="outline" size="sm" disabled={pending} onClick={resend}>Gửi lại callback</Button>}
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Link + badge từ trang partner** — trong `app/(dashboard)/f/ship-ho/partners/page.tsx` (hoặc PartnersManager), thêm Link "Đăng ký ship hộ" tới `/f/ship-ho/partner-requests`. (Tùy chọn: badge số pending.)

- [ ] **Step 4: tsc + Commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add "app/(dashboard)/f/ship-ho/partner-requests" "app/(dashboard)/f/ship-ho/partners"
git commit -m "feat(ship-ho): trang MEAN duyệt đăng ký ship hộ (approve/reject/resend callback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verify + push

- [ ] **Step 1: tsc** — `npx tsc --noEmit` → PASS.
- [ ] **Step 2: full test** — `npx vitest run` → PASS (gồm `partner-request-callback`).
- [ ] **Step 3: push** — `git push origin feat/ship-ho-mmp-phase3`.

---

## Self-Review

**Spec coverage (B):**
- B1 bảng partner_requests → Task 1. ✅
- B2 endpoint receiver (dedupe pending) → Task 2 (`createPartnerRequest`) + Task 3 (route). ✅
- B3 MEAN review + duyệt (markup≥30, self_service_enabled) + từ chối → Task 2 + Task 4. ✅
- B4 callback approved/rejected best-effort + gửi lại → Task 2 (`sendPartnerCallback`/`resendPartnerCallback`) + Task 4 nút. ✅

**Placeholder scan:** không TBD; ghi chú 'use server' export thuần (tách file nếu cần) là chỉ dẫn có chủ đích.

**Type consistency:**
- `createPartnerRequest(body) → {ok,ref}|{ok,code,error}` (T2) dùng ở route T3. ✅
- `approvePartnerRequest/rejectPartnerRequest/resendPartnerCallback` (T2) dùng ở RequestRow T4. ✅
- `buildPartnerCallbackEnvelope` (T2) test T2. ✅
- `markupFloorError` (sẵn có) dùng ở approve. ✅
- Bảng `shipHoPartnerRequests` cột (T1) dùng T2/T4. ✅
