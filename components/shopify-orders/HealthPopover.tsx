'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Activity, Download, RefreshCw } from 'lucide-react';

export interface HealthSnapshot {
  /** Pre-formatted "12 min ago" / "—" string from the server. We don't pass
   *  raw timestamps so the popover stays a pure presentational component. */
  lastWebhookAgo: string;
  lastCronAgo: string;
  backfillStatus: string;
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
 * Small "Sync health" button + modal that replaces the always-visible
 * health card. Click → see the same data plus a one-click backfill trigger.
 *
 * The button surfaces a status dot so the operator can tell at a glance
 * whether sync is healthy without opening the modal:
 *   - green  : webhook delivered within the last 10 minutes
 *   - amber  : older than 10 minutes (cron is the only freshness signal)
 *   - red    : at least one failed webhook in the last 24 h
 *   - grey   : no signal yet (newly-connected store)
 */
export function HealthPopover({ storeName, snapshot, startBackfillAction }: HealthPopoverProps) {
  const [open, setOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const tone = pickTone(snapshot);
  const running = snapshot.backfillStatus === 'running';

  const handleBackfill = async (): Promise<void> => {
    setBackfilling(true);
    try {
      await startBackfillAction();
    } finally {
      setBackfilling(false);
    }
  };

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
              Webhook freshness, cron heartbeat, and backfill state for this store.
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm space-y-1.5">
            <Row label="Last webhook" value={snapshot.lastWebhookAgo} />
            <Row label="Last cron" value={snapshot.lastCronAgo} />
            <Row label="Backfill" value={snapshot.backfillStatus} />
            <div className="flex justify-between border-t border-border pt-2 mt-2">
              <span className="text-muted-foreground">Webhooks 24h</span>
              <span className="font-mono tabular-nums">
                {snapshot.webhooksOk} ok
                {' · '}
                <span className="text-destructive">{snapshot.webhooksFailed} failed</span>
              </span>
            </div>
          </div>

          <DialogFooter className="flex-row sm:justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={running || backfilling}
              onClick={handleBackfill}
              className="gap-1.5"
            >
              {backfilling || running ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {running ? 'Backfilling…' : backfilling ? 'Starting…' : 'Backfill 12mo'}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
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
  if (Number(s.webhooksFailed) > 0) return 'red';
  if (s.lastWebhookAgo === '—' && s.lastCronAgo === '—') return 'grey';
  // We only know minutes from the formatted string, so a cheap parse is
  // enough — anything <10 min counts as fresh.
  const m = /(\d+) min/.exec(s.lastWebhookAgo);
  if (m && Number(m[1]) <= 10) return 'green';
  return 'amber';
}
