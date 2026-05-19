import { db, schema } from '@/db/client';

export interface AuditInput {
  userId: string | null;
  storeId?: string | null;
  featureKey?: string | null;
  action: string;
  target?: string | null;
  requestSummary?: string | null;
  result: 'success' | 'error';
  errorDetail?: string | null;
}

export function buildAuditEntry(input: AuditInput) {
  return {
    userId: input.userId,
    storeId: input.storeId ?? null,
    featureKey: input.featureKey ?? null,
    action: input.action,
    target: input.target ?? null,
    requestSummary: input.requestSummary ?? null,
    result: input.result,
    errorDetail: input.errorDetail ?? null,
  };
}

/** Append-only. Used for write/config changes — populated from spec #2 onward. */
export async function recordAudit(input: AuditInput): Promise<void> {
  await db.insert(schema.auditLog).values(buildAuditEntry(input));
}
