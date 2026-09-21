'use server';

import { getShipHoStatement } from './statement-queries';

type StatementDetail = NonNullable<Awaited<ReturnType<typeof getShipHoStatement>>>;
type StatementRow = StatementDetail['statement'];

export interface DutyOrderRow {
  code: string; brandReference: string | null; trackingNumber: string | null; shippedAt: string | null;
  dutyVnd: string; billNumber: string | null; issueDate: string | null; giaThuVnd: number;
}
export interface FreightOrderRow {
  code: string; brandReference: string | null; trackingNumber: string | null; shippedAt: string | null; country: string;
  chargedVnd: string | null; actualChargedVnd: string | null; reconcileStatus: string | null;
  actualCarrierCostVnd: string | null; marginVnd: string | null; actualDutyVnd: string | null;
  giaThuVnd: number | null; theoBill: boolean;
}
export interface ChoHoaDonRow { code: string; brandReference: string | null; shippedAt: string | null; chargedVnd: string | null }

export type DutyStatementForExport = { statement: StatementRow & { type: 'duty' }; orders: DutyOrderRow[]; choHoaDon: [] };
export type FreightStatementForExport = { statement: StatementRow & { type: 'freight' }; orders: FreightOrderRow[]; choHoaDon: ChoHoaDonRow[] };
export type StatementForExport = DutyStatementForExport | FreightStatementForExport;

/** TS can't narrow a union on a NESTED discriminant (`data.statement.type`) — only on a
 *  property directly on the value being checked. A type-guard function sidesteps that:
 *  the predicate applies to `data` itself, so `data.orders`/`choHoaDon` narrow correctly
 *  after `if (isDutyStatementExport(data))`. */
export function isDutyStatementExport(data: StatementForExport): data is DutyStatementForExport {
  return data.statement.type === 'duty';
}

/** Thin server-action wrapper so client components can fetch statement detail
 *  for xlsx export without importing the db-backed query module directly.
 *
 *  `getShipHoStatement` narrows `orders`/`choHoaDon` per branch internally, but the
 *  inferred return type keeps `statement.type` widened to `'freight' | 'duty'` on
 *  BOTH union members (it comes from the same `select()` row in both branches), so
 *  callers can't discriminate on `statement.type` alone. Re-tag it here into a real
 *  discriminated union — the cast is safe because it mirrors exactly the shapes
 *  `getShipHoStatement` constructs for each `type` (see statement-queries.ts). */
export async function fetchStatementForExport(id: string): Promise<StatementForExport | null> {
  const data = await getShipHoStatement(id);
  if (!data) return null;
  return data as StatementForExport;
}
