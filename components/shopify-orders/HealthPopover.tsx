'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Activity, Download, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

export type BackfillStatus = 'idle' | 'running' | 'done' | 'failed';

export interface HealthSnapshot {
  /** Pre-formatted "12 min ago" / "—" string from the server. We don't pass
   *  raw timestamps so the popover stays a pure presentational component. */
  lastWebhookAgo: string;
  lastCronAgo: string;
  backfillStatus: BackfillStatus;
  backfillStartedAgo: string;   // "5 min ago" | "—"
  backfillFinishedAgo: string;  // "1 min ago" | "—"
  backfillDurationLabel: string; // "32 s" | "—"
  backfillError: string | null;
  backfillCursor: string | null; // Shopify bulkOperation gid
  ordersInDb: number;            // total orders for this store
  webhooksOk: string;
  webhooksFailed: string;
}

interface HealthPopoverProps {
  storeName: string;
  snapshot: HealthSnapshot;
  /** Server action: start the 12-month backfill for this store. Fire-and-forget. */
  startBackfillAction: () => Promise<void>;
}

/**
 * Small "Sync health" button + modal. The button surfaces a status dot
 * (green/amber/red/grey) for at-a-glance health; the modal shows the
 * full sync state — including live backfill progress and error detail.
 *
 * Backfill state breakdown:
 *   - idle    : never run; "Backfill 12mo" enabled
 *   - running : bulkOperation in flight; show start time + bulk-op gid;
 *               operator can cross-check on Shopify directly if needed
 *   - done    : show duration + orders ingested + "Re-run" affordance
 *   - failed  : red error block + retry button
 */
export function HealthPopover({ storeName, snapshot, startBackfillAction }: HealthPopoverProps) {
  const [open, setOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const tone = pickTone(snapshot);
  const running = snapshot.backfillStatus === 'running';
  const failed = snapshot.backfillStatus === 'failed';
  const done = snapshot.backfillStatus === 'done';

  const handleBackfill = async (): Promise<void> => {
    setBackfilling(true);
    try {
      await startBackfillAction();
    } finally {
      setBackfilling(false);
    }
  };

  const buttonLabel = backfilling
    ? 'Starting…'
    : running
      ? 'Backfilling…'
      : failed
        ? 'Retry backfill'
        : done
          ? 'Re-run backfill'
          : 'Backfill 12mo';

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-2 px-2.5 text-xs"
        title="Sync health"
      >
        <span className={`inline-block size-2 rounded-full ${TONE_CLASSES[tone]}`} aria-hidden />
        Sync health
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Sync health · {storeName}
            </DialogTitle>
            <DialogDescription>
              Webhook freshness, cron heartbeat, and backfill progress for this store.
            </DialogDescription>
          </DialogHeader>

          {/* Webhook + cron */}
          <div className="text-sm space-y-1.5">
            <Row label="Last webhook" value={snapshot.lastWebhookAgo} />
            <Row label="Last cron" value={snapshot.lastCronAgo} />
            <div className="flex justify-between border-t border-border pt-2 mt-2">
              <span className="text-muted-foreground">Webhooks 24h</span>
              <span className="font-mono tabular-nums">
                {snapshot.webhooksOk} ok
                {' · '}
                <span className="text-destructive">{snapshot.webhooksFailed} failed</span>
              </span>
            </div>
          </div>

          {/* Backfill detail block — visible in all states with state-specific colouring */}
          <div className="text-sm border-t border-border pt-3 mt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Backfill</span>
              <StatusBadge status={snapshot.backfillStatus} />
            </div>

            {running && (
              <>
                <Row label="Started" value={snapshot.backfillStartedAgo} />
                {snapshot.backfillCursor && (
                  <Row
                    label="Shopify bulk op"
                    value={snapshot.backfillCursor.replace('gid://shopify/BulkOperation/', '')}
                  />
                )}
                <p className="text-[11px] text-muted-foreground italic">
                  Shopify is preparing the full result file. Orders appear in the dashboard once the stream finishes — for stores with thousands of orders this can take several minutes.
                </p>
              </>
            )}

            {done && (
              <>
                <Row label="Finished" value={snapshot.backfillFinishedAgo} />
                <Row label="Duration" value={snapshot.backfillDurationLabel} />
                <Row label="Orders in DB" value={String(snapshot.ordersInDb)} />
              </>
            )}

            {failed && (
              <>
                <Row label="Failed" value={snapshot.backfillFinishedAgo} />
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 mt-1 text-xs">
                  <div className="flex items-start gap-1.5 text-destructive font-medium mb-1">
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    <span>Backfill error</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-destructive/90">
                    {snapshot.backfillError ?? '(no detail recorded)'}
                  </pre>
                </div>
              </>
            )}

            {snapshot.backfillStatus === 'idle' && (
              <p className="text-[11px] text-muted-foreground italic">
                No backfill yet. Click below to pull the trailing 12 months of orders from Shopify.
              </p>
            )}
          </div>

          <DialogFooter className="flex-row sm:justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant={failed ? 'default' : 'outline'}
              disabled={running || backfilling}
              onClick={handleBackfill}
              className="gap-1.5"
            >
              {backfilling || running ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : failed ? (
                <AlertCircle className="size-3.5" />
              ) : done ? (
                <RefreshCw className="size-3.5" />
              ) : (
                <Download className="size-3.5" />
              )}
              {buttonLabel}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums truncate ml-2 max-w-[55%] text-right">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: BackfillStatus }): React.JSX.Element {
  const labels: Record<BackfillStatus, { text: string; cls: string; icon: React.ReactNode }> = {
    idle:    { text: 'idle',    cls: 'bg-muted text-muted-foreground',          icon: null },
    running: { text: 'running', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', icon: <RefreshCw className="size-3 animate-spin" /> },
    done:    { text: 'done',    cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', icon: <CheckCircle2 className="size-3" /> },
    failed:  { text: 'failed',  cls: 'bg-destructive/15 text-destructive',      icon: <AlertCircle className="size-3" /> },
  };
  const l = labels[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium uppercase tracking-wider ${l.cls}`}>
      {l.icon}
      {l.text}
    </span>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'grey';

const TONE_CLASSES: Record<Tone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-destructive',
  grey: 'bg-muted-foreground/40',
};

function pickTone(s: HealthSnapshot): Tone {
  // Anything red trumps everything.
  if (s.backfillStatus === 'failed') return 'red';
  if (Number(s.webhooksFailed) > 0) return 'red';
  // Active work in progress.
  if (s.backfillStatus === 'running') return 'amber';
  // Brand-new store: no signal yet.
  if (s.lastWebhookAgo === '—' && s.lastCronAgo === '—' && s.backfillStatus === 'idle') return 'grey';
  // Fresh webhook within 10 minutes is healthy.
  const m = /(\d+) min/.exec(s.lastWebhookAgo);
  if (m && Number(m[1]) <= 10) return 'green';
  // Otherwise we have signal but it's stale.
  return 'amber';
}
