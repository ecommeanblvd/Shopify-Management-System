'use server';

import { getShipHoStatement } from './statement-queries';
import type { StatementForExport } from './statement-export-types';

/** Thin server-action wrapper so client components can fetch statement detail for
 *  xlsx export without importing the db-backed query module directly.
 *
 *  The cast is safe: it just re-tags `statement.type` as a real per-branch literal
 *  (see statement-export-types.ts) to match the shapes `getShipHoStatement` actually
 *  constructs for each type — TS just doesn't infer that discriminant on its own. */
export async function fetchStatementForExport(id: string): Promise<StatementForExport | null> {
  const data = await getShipHoStatement(id);
  if (!data) return null;
  return data as StatementForExport;
}
