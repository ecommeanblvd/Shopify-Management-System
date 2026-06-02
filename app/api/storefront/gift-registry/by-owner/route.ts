/**
 * GET /api/storefront/gift-registry/by-owner?shop=…&email=…
 *   → { registries: { shareToken, eventName, eventDate, itemCount }[] }
 *
 * Used by the PDP embed: when a shopper clicks "Add to gift registry",
 * we look up which registries they already own at this store so they
 * can pick one (or create new).
 *
 * Trust model for internal use: anyone with `email` + `shop` can see
 * the matching registries. A future PR can wire signed magic-link
 * verification once email infra ships.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db, schema } from '@/db/client';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from '../_shared';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, 'inactive_store', 'Gift Registry is not active for this shop', 404);
  const rawEmail = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return errorResponse(req, 'bad_email', 'Valid email required');
  }
  const rows = await db.execute<{
    share_token: string; event_name: string; event_date: string | null; item_count: string;
  }>(sql`
    SELECT r.share_token, r.event_name, r.event_date::text,
           COALESCE(i.cnt, 0)::text AS item_count
      FROM gift_registries r
      LEFT JOIN (
        SELECT registry_id, COUNT(*) AS cnt FROM gift_registry_items GROUP BY registry_id
      ) i ON i.registry_id = r.id
     WHERE r.store_id = ${store.storeId}
       AND r.owner_email = ${rawEmail}
     ORDER BY r.created_at DESC;
  `);
  return jsonResponse(req, {
    registries: rows.rows.map((r) => ({
      shareToken: r.share_token,
      eventName: r.event_name,
      eventDate: r.event_date,
      itemCount: Number(r.item_count),
    })),
  });
}

// Silence unused warnings for helpers kept available to extend later.
void and; void eq;

export const OPTIONS = handleOptions;
