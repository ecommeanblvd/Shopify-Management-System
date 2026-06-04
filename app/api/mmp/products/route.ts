/**
 * POST /api/mmp/products
 *
 * MEAN Merchant Portal → SMS product ingestion webhook. Auth via
 * HMAC SHA-256 signature over `${timestamp}.${rawBody}` (per the
 * 2026-06-03 contract). Body is a `{ products: [...] }` envelope.
 *
 * Response shape mirrors the MMP team's expectation: per-item
 * `{ portalProductId, shopifyProductId, status, variantMap, error }`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { db, schema } from '@/db/client';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { mmpEnvelopeSchema } from '@/features/mmp/schema';
import { upsertMmpEnvelope } from '@/features/mmp/upsert';

// Fluid Compute / Node runtime — we need crypto.timingSafeEqual and
// raw request body access. Both work under the default Node runtime.
export const runtime = 'nodejs';
// Force dynamic so Next.js doesn't try to statically cache the POST.
export const dynamic = 'force-dynamic';

function logRun(args: {
  payloadHash: string;
  result: string;
  productCount: number;
  acceptedCount: number;
  rejectedCount: number;
  errorSummary: string | null;
  errors?: unknown;
  sourceIp: string | null;
  processingMs: number;
}): Promise<unknown> {
  return db.insert(schema.mmpIngestionRuns).values({
    payloadHash: args.payloadHash,
    result: args.result,
    productCount: args.productCount,
    acceptedCount: args.acceptedCount,
    rejectedCount: args.rejectedCount,
    errorSummary: args.errorSummary,
    errors: (args.errors ?? null) as never,
    sourceIp: args.sourceIp,
    processingMs: args.processingMs,
  });
}

function hashPayload(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

function ipFromRequest(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) {
    // 503 makes more sense than 500: the endpoint is *deliberately*
    // not ready until the operator configures the secret.
    return NextResponse.json(
      { error: 'MMP_WEBHOOK_SECRET not configured on SMS — contact ops' },
      { status: 503 },
    );
  }

  // CRITICAL: read raw body BEFORE parsing JSON. HMAC must be checked
  // against the exact bytes the client signed.
  const rawBody = await req.text();
  const payloadHash = hashPayload(rawBody);
  const sourceIp = ipFromRequest(req);

  const hmac = verifyMmpSignature({
    secret,
    rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) {
    await logRun({
      payloadHash,
      result: `auth_failed:${hmac.reason}`,
      productCount: 0, acceptedCount: 0, rejectedCount: 0,
      errorSummary: hmac.reason,
      sourceIp,
      processingMs: Date.now() - started,
    }).catch(() => undefined);
    return NextResponse.json(
      { error: 'signature verification failed', reason: hmac.reason },
      { status: 401 },
    );
  }

  // Parse + validate body.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    await logRun({
      payloadHash,
      result: 'json_parse_error',
      productCount: 0, acceptedCount: 0, rejectedCount: 0,
      errorSummary: 'malformed JSON',
      sourceIp,
      processingMs: Date.now() - started,
    }).catch(() => undefined);
    return NextResponse.json({ error: 'malformed JSON body' }, { status: 400 });
  }

  const valid = mmpEnvelopeSchema.safeParse(parsed);
  if (!valid.success) {
    // Top 5 issues — keep response small but useful for MMP debugging.
    const issues = valid.error.issues.slice(0, 5).map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    await logRun({
      payloadHash,
      result: 'schema_error',
      productCount: 0, acceptedCount: 0, rejectedCount: 0,
      errorSummary: issues[0]?.message ?? 'schema validation failed',
      errors: issues,
      sourceIp,
      processingMs: Date.now() - started,
    }).catch(() => undefined);
    return NextResponse.json(
      { error: 'schema validation failed', issues },
      { status: 400 },
    );
  }

  // Persist.
  const summary = await upsertMmpEnvelope(valid.data);
  await logRun({
    payloadHash,
    result: 'accepted',
    productCount: valid.data.products.length,
    acceptedCount: summary.accepted,
    rejectedCount: summary.rejected,
    errorSummary: summary.rejected > 0
      ? summary.results.find((r) => r.error)?.error ?? null
      : null,
    errors: summary.rejected > 0
      ? summary.results.filter((r) => r.error).map((r) => ({
        portalProductId: r.portalProductId, error: r.error,
      }))
      : null,
    sourceIp,
    processingMs: Date.now() - started,
  }).catch(() => undefined);

  return NextResponse.json({ results: summary.results });
}
