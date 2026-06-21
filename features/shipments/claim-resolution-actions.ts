'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { putObject } from '@/lib/storage/s3';
import { parseCreditNoteXml } from './credit-note-parse';
import { matchCreditToDisputing, type DisputingRow } from './credit-note-match';
import type { UploadFile } from '@/features/carrier-rates/ap/bills-actions';

const ROUTE = '/f/shipping-reconcile';
async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) throw new Error('Forbidden');
  return session.user.id;
}

export interface CreditApplyResult {
  creditNoteNumber: string | null;
  matched: { tracking: string; creditVnd: number; credited: boolean }[];
  unmatched: { tracking: string; creditVnd: number; reason: string }[];
}

export async function applyCreditNote(input: { xml: UploadFile; pdf?: UploadFile }): Promise<CreditApplyResult> {
  const userId = await requireUser();
  // 1) XML TT78 là text — decode UTF-8 rồi parse (không pdftotext, không carrier param).
  const xmlText = new TextDecoder('utf-8').decode(input.xml.bytes);
  const parsed = parseCreditNoteXml(xmlText);
  if (parsed.lines.length === 0) return { creditNoteNumber: parsed.creditNoteNumber, matched: [], unmatched: [] };
  if (!parsed.creditNoteNumber) {
    return { creditNoteNumber: null, matched: [], unmatched: parsed.lines.map((l) => ({ tracking: l.tracking, creditVnd: l.creditVnd, reason: 'Credit note thiếu số (không áp được)' })) };
  }

  // 2) đơn đang đòi (join tracking + claimed/recovered hiện tại)
  const rows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      tracking: schema.shipments.trackingNumber,
      delta: schema.shipmentReconcileStatus.deltaVndAtReview,
      recovered: schema.shipmentReconcileStatus.recoveredVnd,
      cn: schema.shipmentReconcileStatus.creditNoteNumber,
    })
    .from(schema.shipmentReconcileStatus)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentReconcileStatus.shipmentId))
    .where(eq(schema.shipmentReconcileStatus.status, 'disputing'));

  // idempotent: bỏ đơn đã áp đúng credit note này (tránh cộng đôi); bỏ đơn delta null (claimedVnd=0 → sai)
  const disputing: DisputingRow[] = rows
    .filter((r) => r.tracking && r.delta !== null && !(r.cn === parsed.creditNoteNumber))
    .map((r) => ({
      shipmentId: r.shipmentId,
      tracking: r.tracking as string,
      claimedVnd: Math.abs(Number(r.delta)),
      recoveredVnd: r.recovered !== null ? Number(r.recovered) : 0,
    }));

  const res = matchCreditToDisputing(parsed.lines, disputing);
  if (res.matched.length === 0) {
    return { creditNoteNumber: parsed.creditNoteNumber, matched: [], unmatched: res.unmatched };
  }

  // 3) lưu file BẰNG CHỨNG 1 lần: ưu tiên PDF (người xem), fallback XML. Set cho từng đơn khớp.
  const proof = input.pdf ?? input.xml;
  const ct = proof.contentType || (input.pdf ? 'application/pdf' : 'application/xml');
  const ext = proof.filename.includes('.') ? proof.filename.slice(proof.filename.lastIndexOf('.')) : '';
  const fileKey = `carrier-credit-notes/${randomUUID()}${ext}`;
  await putObject(fileKey, proof.bytes, ct);

  const matchedOut: CreditApplyResult['matched'] = [];
  await db.transaction(async (tx) => {
    for (const m of res.matched) {
      await tx.update(schema.shipmentReconcileStatus)
        .set({
          recoveredVnd: String(m.newRecovered),
          creditNoteNumber: parsed.creditNoteNumber,
          creditNoteFileKey: fileKey,
          status: m.fullyRecovered ? 'credited' : 'disputing',
          reconciledBy: userId,
          reconciledAt: sql`now()`,
        })
        .where(and(eq(schema.shipmentReconcileStatus.shipmentId, m.shipmentId), eq(schema.shipmentReconcileStatus.status, 'disputing')));
      matchedOut.push({ tracking: m.tracking, creditVnd: m.creditVnd, credited: m.fullyRecovered });
    }
  });
  revalidatePath(ROUTE);
  return { creditNoteNumber: parsed.creditNoteNumber, matched: matchedOut, unmatched: res.unmatched };
}

export async function acceptDifference(input: { shipmentId: string }): Promise<void> {
  const userId = await requireUser();
  await db.update(schema.shipmentReconcileStatus)
    .set({ status: 'accepted', reconciledBy: userId, reconciledAt: sql`now()` })
    .where(and(eq(schema.shipmentReconcileStatus.shipmentId, input.shipmentId), eq(schema.shipmentReconcileStatus.status, 'disputing')));
  revalidatePath(ROUTE);
}
