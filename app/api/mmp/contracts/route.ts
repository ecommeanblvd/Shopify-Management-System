/**
 * POST /api/mmp/contracts
 * MMP → SMS: đẩy hợp đồng của 1 brand (JSON + HTML tự chứa CSS).
 * Path + auth chốt với MMP 05/08/2026 — cùng base & cùng scheme HMAC với
 * `/api/mmp/products`: `x-mean-signature: sha256=<hex>` + `x-mean-timestamp`,
 * ký `HMAC-SHA256(MMP_WEBHOOK_SECRET, "<timestamp>.<rawBody>")`.
 *
 * Body: { brandSlug, brandName?, contractType, title, version, generatedAt, html }
 * contractType: fulfillment | sales | mou | nda.
 * Idempotent theo (brandSlug, version) — trùng version thì GHI ĐÈ, không tạo bản mới.
 * Trả 200 { ok, id, action: 'created' | 'updated' }.
 */
import { type NextRequest } from 'next/server';
import { handleMmpContractRequest } from '@/features/ship-ho/contract-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  return handleMmpContractRequest(req);
}
