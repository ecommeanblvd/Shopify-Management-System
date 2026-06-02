/**
 * Operator audit-log helpers for the Functions module. Append-only;
 * every toggle / config change goes through `logFunctionAudit`.
 *
 * Reads:
 *   - `listAuditEntries` powers the /f/functions/audit page.
 *   - The function key + store fields are indexed so future per-function
 *     and per-store audit views stay cheap.
 *
 * Why append-only:
 *   - We want "who toggled the wishlist off at MeanBLVD on 2026-06-02"
 *     to survive even if the operator who did it leaves the team.
 *   - JSONB payload means new action types don't need a migration.
 */

import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export type AuditAction =
  | 'toggle'
  | 'config_update';

export interface LogFunctionAuditInput {
  functionKey: string;
  storeId: string | null;
  actorUserId: string | null;
  action: AuditAction | string;
  payload?: Record<string, unknown>;
}

/** Insert a single audit row. Never throws on payload — JSONB accepts
 *  anything serialisable; the caller is expected to pass plain data. */
export async function logFunctionAudit(input: LogFunctionAuditInput): Promise<void> {
  await db.insert(schema.functionAuditLog).values({
    functionKey: input.functionKey,
    storeId: input.storeId,
    actorUserId: input.actorUserId,
    action: input.action,
    payload: (input.payload ?? null) as never,
  });
}

export interface AuditEntry {
  id: string;
  functionKey: string;
  storeId: string | null;
  storeName: string | null;
  shopDomain: string | null;
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  payload: unknown;
  createdAt: Date;
}

export interface ListAuditEntriesFilter {
  functionKey?: string;
  storeId?: string;
  limit?: number;
}

/** Joins in store + user info so the page can render without a fan-out
 *  per row. Capped at 200 by default — operators paging back further
 *  can refine via filter. */
export async function listAuditEntries(
  filter: ListAuditEntriesFilter = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(500, Math.max(1, filter.limit ?? 200));
  const rows = await db.execute<{
    id: string;
    function_key: string;
    store_id: string | null;
    store_name: string | null;
    shop_domain: string | null;
    action: string;
    actor_user_id: string | null;
    actor_email: string | null;
    payload: unknown;
    created_at: Date;
  }>(sql`
    SELECT a.id, a.function_key,
           a.store_id, s.name AS store_name, s.shop_domain,
           a.action, a.actor_user_id, u.email AS actor_email,
           a.payload, a.created_at
      FROM function_audit_log a
      LEFT JOIN stores s ON s.id = a.store_id
      LEFT JOIN "user" u ON u.id = a.actor_user_id
     WHERE 1=1
       ${filter.functionKey ? sql`AND a.function_key = ${filter.functionKey}` : sql``}
       ${filter.storeId ? sql`AND a.store_id = ${filter.storeId}` : sql``}
     ORDER BY a.created_at DESC
     LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    functionKey: r.function_key,
    storeId: r.store_id,
    storeName: r.store_name,
    shopDomain: r.shop_domain,
    action: r.action,
    actorUserId: r.actor_user_id,
    actorEmail: r.actor_email,
    payload: r.payload,
    createdAt: r.created_at,
  }));
}

// Silence unused warnings — kept for future filtered queries.
void desc; void eq;
