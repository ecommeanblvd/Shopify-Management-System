'use server';

import { getShipHoStatement } from './statement-queries';

/** Thin server-action wrapper so client components can fetch statement detail
 *  for xlsx export without importing the db-backed query module directly. */
export async function fetchStatementForExport(id: string) {
  return getShipHoStatement(id);
}
