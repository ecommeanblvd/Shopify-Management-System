'use client';

import { useState } from 'react';
import { confirmIssueReport, type IssueReportRecord } from '@/features/shipments/issue-report-actions';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

export interface OpenIssue {
  groupKey: string;
  carrierKey: string | null;
  label: string;
  action: string;
  count: number;
  sumDelta: number;
  samples: string[];
}

interface Props {
  openIssues: OpenIssue[];
  reports: IssueReportRecord[];
}

/**
 * "Vấn đề & Report" — opened from a button on the reconcile page. Open
 * issues (live-computed from pending mismatches) become persistent
 * REPORTS only after a Logistics staffer confirms what was fixed.
 */
export function ReconcileIssuesModal({ openIssues, reports }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'issues' | 'reports'>('issues');
  const reportedKeys = new Set(reports.map((r) => r.issueKey));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
      >
        Vấn đề &amp; Report
        {openIssues.length > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            {openIssues.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:p-10" onClick={() => setOpen(false)}>
          <div
            className="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-5 py-3">
              <div className="flex items-center gap-1 text-sm">
                <TabButton active={tab === 'issues'} onClick={() => setTab('issues')}>
                  Vấn đề đang mở ({openIssues.length})
                </TabButton>
                <TabButton active={tab === 'reports'} onClick={() => setTab('reports')}>
                  Report đã lưu ({reports.length})
                </TabButton>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-muted-foreground hover:bg-muted">✕</button>
            </div>

            {tab === 'issues' ? (
              <div className="divide-y divide-border">
                {openIssues.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">Không còn vấn đề nào đang mở 🎉</p>
                )}
                {openIssues.map((g) => (
                  <OpenIssueItem key={g.groupKey} issue={g} alreadyReported={reportedKeys.has(g.groupKey)} />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {reports.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">Chưa có report nào được lưu.</p>
                )}
                {reports.map((r) => (
                  <div key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{r.description}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.orderCount} đơn · Σ lệch {fmtVnd(r.sumDeltaVnd)} đ
                      </span>
                    </div>
                    <p className="mt-1 text-emerald-600 dark:text-emerald-400">✓ {r.resolutionNote}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.confirmedByName ?? 'Logistics'} · {new Date(r.confirmedAt).toLocaleString('vi-VN')}
                      {r.sampleOrders.length > 0 ? ` · vd: ${r.sampleOrders.join(', ')}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 font-medium ${active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
    >
      {children}
    </button>
  );
}

function OpenIssueItem({ issue, alreadyReported }: { issue: OpenIssue; alreadyReported: boolean }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function confirm() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await confirmIssueReport({
        issueKey: issue.groupKey,
        carrierKey: issue.carrierKey,
        description: issue.action,
        orderCount: issue.count,
        sumDeltaVnd: issue.sumDelta,
        sampleOrders: issue.samples,
        resolutionNote: note,
      });
      setConfirming(false);
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">{issue.count} đơn</span>
        <span className="min-w-0 flex-1">{issue.action}</span>
        {alreadyReported && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400" title="Đã có report cho vấn đề này — các đơn liên quan vẫn chờ đối soát từng dòng">
            đã có report
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
        Σ lệch {fmtVnd(issue.sumDelta)} đ · vd: {issue.samples.join(', ')}
      </p>
      {confirming ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Đã xử lý thế nào? VD: Gọi FedEx 2026-06-10, xác nhận MC thuộc Zone M từ card 2026 — đã sửa zone mapping."
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={confirm}
              className="rounded border border-emerald-500/50 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ✓ Xác nhận đã sửa → lưu report
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
              Hủy
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
        >
          Xác nhận đã sửa…
        </button>
      )}
    </div>
  );
}
