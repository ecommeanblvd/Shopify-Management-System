'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

const ROUTE = '/f/shipping-reconcile';

async function requireUser(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    throw new Error('Forbidden');
  }
  return session.user.id;
}

export interface ConfirmIssueReportInput {
  issueKey: string;
  carrierKey: string | null;
  description: string;
  orderCount: number;
  sumDeltaVnd: number;
  sampleOrders: string[];
  /** Required — what was fixed / what the carrier confirmed. */
  resolutionNote: string;
}

/** Logistics staff confirms an issue was handled → persists as a report. */
export async function confirmIssueReport(input: ConfirmIssueReportInput): Promise<void> {
  const userId = await requireUser();
  const note = input.resolutionNote.trim();
  if (!note) throw new Error('Cần ghi rõ nội dung đã xử lý / xác nhận');
  await db.insert(schema.reconcileIssueReports).values({
    issueKey: input.issueKey,
    carrierKey: input.carrierKey,
    description: input.description,
    orderCount: input.orderCount,
    sumDeltaVnd: input.sumDeltaVnd.toFixed(2),
    sampleOrders: input.sampleOrders,
    resolutionNote: note,
    confirmedBy: userId,
  });
  revalidatePath(ROUTE);
}

export interface IssueReportRecord {
  id: string;
  issueKey: string;
  carrierKey: string | null;
  description: string;
  orderCount: number;
  sumDeltaVnd: number | null;
  sampleOrders: string[];
  resolutionNote: string;
  confirmedByName: string | null;
  confirmedAt: Date;
}

/** Full report history, newest first — the single place reports live. */
export async function listIssueReports(): Promise<IssueReportRecord[]> {
  await requireUser();
  const rows = await db
    .select({
      id: schema.reconcileIssueReports.id,
      issueKey: schema.reconcileIssueReports.issueKey,
      carrierKey: schema.reconcileIssueReports.carrierKey,
      description: schema.reconcileIssueReports.description,
      orderCount: schema.reconcileIssueReports.orderCount,
      sumDeltaVnd: schema.reconcileIssueReports.sumDeltaVnd,
      sampleOrders: schema.reconcileIssueReports.sampleOrders,
      resolutionNote: schema.reconcileIssueReports.resolutionNote,
      confirmedByName: schema.user.name,
      confirmedAt: schema.reconcileIssueReports.confirmedAt,
    })
    .from(schema.reconcileIssueReports)
    .leftJoin(schema.user, eq(schema.user.id, schema.reconcileIssueReports.confirmedBy))
    .orderBy(desc(schema.reconcileIssueReports.confirmedAt));
  return rows.map((r) => ({
    ...r,
    sumDeltaVnd: r.sumDeltaVnd !== null ? Number(r.sumDeltaVnd) : null,
    sampleOrders: Array.isArray(r.sampleOrders) ? (r.sampleOrders as string[]) : [],
  }));
}
