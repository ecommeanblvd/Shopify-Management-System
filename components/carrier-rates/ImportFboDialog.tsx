'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { FboPreview, FboApplyResult } from '@/features/carrier-rates/ap/fbo-import-actions';

interface Props {
  currency: string;
  previewAction: (fd: FormData) => Promise<FboPreview>;
  applyAction: (fd: FormData) => Promise<FboApplyResult>;
}

/** Nút "Import FedEx FBO" → modal: chọn Excel → xem trước (parse + thống kê)
 *  → áp dụng (tạo bill AP + cập nhật billed đối soát). Idempotent. */
export function ImportFboDialog({ currency, previewAction, applyAction }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FboPreview | null>(null);
  const [result, setResult] = useState<FboApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fmt = (v: number) => `${Math.round(v).toLocaleString('vi-VN')} ${currency}`;

  function reset() {
    setFile(null); setPreview(null); setResult(null); setError(null);
  }

  function fd(): FormData {
    const f = new FormData();
    if (file) f.set('file', file);
    return f;
  }

  function doPreview() {
    if (!file) return;
    setError(null); setResult(null);
    startTransition(async () => {
      try { setPreview(await previewAction(fd())); }
      catch (e) { setError((e as Error).message); }
    });
  }

  function doApply() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await applyAction(fd());
        setResult(r);
        router.refresh();
      } catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
        <FileSpreadsheet className="size-4" /> Import FedEx FBO
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Import FedEx Billing Online (FBO)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
            <Label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Upload className="size-3.5" /> File FBO (.xlsx)
            </Label>
            <Input
              type="file" accept=".xlsx,.xls"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(null); }}
            />
            <p className="text-[11px] text-muted-foreground">
              Gom theo Số hoá đơn FedEx → tạo bill AP + dòng phí từng vận đơn, đồng thời cập nhật billed cho đối soát (khớp theo AWB). Re-upload an toàn (cập nhật chồng theo số hoá đơn).
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {(preview || result) && (
            <PreviewView data={result ?? preview!} fmt={fmt} applied={!!result} />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
            {!result && (
              <>
                <Button type="button" variant="outline" size="sm" disabled={!file || pending} onClick={doPreview}>
                  {pending && !preview ? 'Đang đọc…' : 'Xem trước'}
                </Button>
                <Button type="button" size="sm" disabled={!preview || pending} onClick={doApply}>
                  {pending && preview ? 'Đang áp dụng…' : 'Áp dụng'}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewView({ data, fmt, applied }: { data: FboPreview | FboApplyResult; fmt: (v: number) => string; applied: boolean }) {
  const r = data as FboApplyResult;
  return (
    <div className="space-y-3">
      {applied && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          Đã áp dụng: tạo {r.billsCreated} · cập nhật {r.billsUpdated} hoá đơn · {r.chargesUpserted} billed đối soát.
        </div>
      )}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Hoá đơn" value={String(data.bills.length)} />
        <Stat label="Tổng tiền" value={fmt(data.grandTotal)} />
        <Stat label="AWB khớp đơn" value={`${data.matchedAwb}/${data.totalAwb}`} />
        <Stat label="Không khớp" value={String(data.unmatchedAwb)} tone={data.unmatchedAwb > 0 ? 'warn' : undefined} />
      </div>

      <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Số hoá đơn</th>
              <th className="px-3 py-1.5 text-left">Kỳ</th>
              <th className="px-3 py-1.5 text-right">Vận đơn</th>
              <th className="px-3 py-1.5 text-right">Số tiền</th>
            </tr>
          </thead>
          <tbody>
            {data.bills.map((b, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1.5 font-mono text-xs">{b.billNumber ?? '(không số)'}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{b.periodStart ?? '—'}{b.periodEnd && b.periodEnd !== b.periodStart ? ` → ${b.periodEnd}` : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{b.lineCount}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.unmatchedSample.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          AWB không khớp đơn (mẫu): <span className="font-mono">{data.unmatchedSample.join(', ')}</span>… — vẫn tạo bill AP, nhưng không cập nhật billed đối soát (đơn không có trong hệ thống).
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
    </div>
  );
}
