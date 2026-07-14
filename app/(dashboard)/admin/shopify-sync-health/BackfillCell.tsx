/**
 * Renders the live state of a store's order backfill for the sync-health table.
 * Server component (the page is force-dynamic and re-renders on auto-refresh),
 * so relative times are computed fresh each render.
 *
 * Phases (backfill_phase within status='running'):
 *   submitting → exporting (Shopify writes JSONL, objectCount grows) →
 *   ingesting (we upsert, ingested/total grows) → done.
 */

const STALE_MS = 3 * 60 * 1000; // no heartbeat for 3 min ⇒ likely a dead run

export interface BackfillCellProps {
  status: string;
  phase: string | null;
  objectCount: number | null;
  total: number | null;
  ingested: number | null;
  progressAt: Date | string | null;
  error: string | null;
}

function Bar({ pct }: { pct: number }): React.ReactElement {
  return (
    <div className="h-1.5 w-40 max-w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-emerald-500 transition-all"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function BackfillCell(props: BackfillCellProps): React.ReactElement {
  const { status, phase, objectCount, total, ingested, progressAt, error } = props;
  const nf = (n: number) => n.toLocaleString('en-US');

  if (status === 'done') {
    return <span className="text-emerald-600 dark:text-emerald-400">✓ Xong · {nf(total ?? ingested ?? 0)} đơn</span>;
  }

  if (status === 'failed') {
    return (
      <span className="text-destructive" title={error ?? undefined}>
        ✗ Lỗi{error ? ` · ${error.slice(0, 40)}${error.length > 40 ? '…' : ''}` : ''}
      </span>
    );
  }

  if (status !== 'running') {
    return <span className="text-muted-foreground">idle</span>;
  }

  // running — figure out the sub-phase + staleness.
  const ageMs = progressAt ? Date.now() - new Date(progressAt).getTime() : null;
  const stale = ageMs != null && ageMs > STALE_MS;

  let body: React.ReactElement;
  if (phase === 'ingesting') {
    const t = total ?? 0;
    const done = ingested ?? 0;
    const pct = t > 0 ? Math.round((done / t) * 100) : 0;
    body = (
      <div className="space-y-1">
        <div className="tabular-nums">Đang nạp · {nf(done)}/{nf(t)} đơn ({pct}%)</div>
        <Bar pct={pct} />
      </div>
    );
  } else if (phase === 'exporting') {
    body = (
      <div className="space-y-1">
        <div className="tabular-nums">Shopify đang export · {nf(objectCount ?? 0)} objects</div>
        <div className="h-1.5 w-40 max-w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-emerald-500/70 animate-pulse" />
        </div>
      </div>
    );
  } else {
    body = <div>Đang khởi tạo…</div>;
  }

  return (
    <div className="space-y-1">
      {body}
      {stale ? (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          ⚠ {Math.round((ageMs ?? 0) / 60000)}p không tiến triển — có thể đã dừng, thử Backfill lại
        </div>
      ) : ageMs != null ? (
        <div className="text-xs text-muted-foreground">cập nhật {Math.round(ageMs / 1000)}s trước</div>
      ) : null}
    </div>
  );
}
