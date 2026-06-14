import { describe, it, expect } from 'vitest';
import { summariseBill, summariseAp, type BillInput, type PaymentInput } from './ap-summary';

const bill = (over: Partial<BillInput> = {}): BillInput => ({
  id: 'b1', amount: 1_000_000, currency: 'VND', dueDate: null, ...over,
});
const pay = (amount: number): PaymentInput => ({ billId: 'b1', amount });

describe('summariseBill', () => {
  it('unpaid when no payments', () => {
    const r = summariseBill(bill(), [], '2026-06-14');
    expect(r).toMatchObject({ paid: 0, outstanding: 1_000_000, status: 'unpaid', overdue: false });
  });

  it('partial when some paid', () => {
    const r = summariseBill(bill(), [pay(400_000)], '2026-06-14');
    expect(r).toMatchObject({ paid: 400_000, outstanding: 600_000, status: 'partial' });
  });

  it('paid when fully covered (within 0.5đ epsilon)', () => {
    const r = summariseBill(bill(), [pay(600_000), pay(400_000)], '2026-06-14');
    expect(r).toMatchObject({ paid: 1_000_000, outstanding: 0, status: 'paid', overdue: false });
  });

  it('overpaid still counts as paid, outstanding floored at 0', () => {
    const r = summariseBill(bill(), [pay(1_200_000)], '2026-06-14');
    expect(r.status).toBe('paid');
    expect(r.outstanding).toBe(0);
  });

  it('overdue when due_date passed and still owing', () => {
    const r = summariseBill(bill({ dueDate: '2026-06-01' }), [pay(400_000)], '2026-06-14');
    expect(r.overdue).toBe(true);
  });

  it('not overdue when paid in full even past due date', () => {
    const r = summariseBill(bill({ dueDate: '2026-06-01' }), [pay(1_000_000)], '2026-06-14');
    expect(r.overdue).toBe(false);
  });

  it('not overdue when due_date is null', () => {
    const r = summariseBill(bill({ dueDate: null }), [], '2026-06-14');
    expect(r.overdue).toBe(false);
  });
});

describe('summariseAp roll-up', () => {
  it('aggregates totals + overdue across bills', () => {
    const bills: BillInput[] = [
      { id: 'b1', amount: 1_000_000, currency: 'VND', dueDate: '2026-06-01' }, // overdue, 600k owing
      { id: 'b2', amount: 500_000, currency: 'VND', dueDate: '2026-12-01' },   // 500k owing, not overdue
      { id: 'b3', amount: 300_000, currency: 'VND', dueDate: null },           // paid
    ];
    const payments: PaymentInput[] = [
      { billId: 'b1', amount: 400_000 },
      { billId: 'b3', amount: 300_000 },
    ];
    const r = summariseAp(bills, payments, '2026-06-14');
    expect(r.totalBilled).toBe(1_800_000);
    expect(r.totalPaid).toBe(700_000);
    expect(r.totalOutstanding).toBe(1_100_000);
    expect(r.overdueCount).toBe(1);
    expect(r.overdueAmount).toBe(600_000);
    expect(r.bills.find((b) => b.id === 'b3')!.status).toBe('paid');
  });
});
