import type { getShipHoStatement } from './statement-queries';

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
 *  after `if (isDutyStatementExport(data))`. Plain module (no `'use server'`) so it can
 *  export a sync function and be imported from the client component too. */
export function isDutyStatementExport(data: StatementForExport): data is DutyStatementForExport {
  return data.statement.type === 'duty';
}
