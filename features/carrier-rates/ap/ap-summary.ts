/**
 * Pure accounts-payable summariser for carrier bills. No I/O — the DB layer
 * passes in bills + payments, this computes per-bill status and the account
 * roll-up. Money is VND integers; a 0.5đ epsilon absorbs rounding so a bill
 * paid to the đồng counts as fully paid.
 */

export type BillStatus = 'unpaid' | 'partial' | 'paid';

export interface BillInput {
  id: string;
  amount: number;
  currency: string;
  /** ISO 'YYYY-MM-DD' or null. */
  dueDate?: string | null;
}

export interface PaymentInput {
  billId: string;
  amount: number;
}

export interface BillSummary {
  id: string;
  amount: number;
  paid: number;
  outstanding: number;
  status: BillStatus;
  overdue: boolean;
}

export interface ApSummary {
  bills: BillSummary[];
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  overdueCount: number;
  overdueAmount: number;
}

const EPS = 0.5;

export function summariseBill(bill: BillInput, payments: PaymentInput[], today: string): BillSummary {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, bill.amount - paid);
  const status: BillStatus = outstanding <= EPS ? 'paid' : paid <= EPS ? 'unpaid' : 'partial';
  const overdue = !!bill.dueDate && bill.dueDate < today && outstanding > EPS;
  return { id: bill.id, amount: bill.amount, paid, outstanding, status, overdue };
}

export function summariseAp(bills: BillInput[], payments: PaymentInput[], today: string): ApSummary {
  const byBill = new Map<string, PaymentInput[]>();
  for (const p of payments) {
    const list = byBill.get(p.billId) ?? [];
    list.push(p);
    byBill.set(p.billId, list);
  }
  const summaries = bills.map((b) => summariseBill(b, byBill.get(b.id) ?? [], today));
  return {
    bills: summaries,
    totalBilled: summaries.reduce((s, b) => s + b.amount, 0),
    totalPaid: summaries.reduce((s, b) => s + b.paid, 0),
    totalOutstanding: summaries.reduce((s, b) => s + b.outstanding, 0),
    overdueCount: summaries.filter((b) => b.overdue).length,
    overdueAmount: summaries.filter((b) => b.overdue).reduce((s, b) => s + b.outstanding, 0),
  };
}
