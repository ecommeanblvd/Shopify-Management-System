'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, AlertTriangle } from 'lucide-react';

export interface GlobalUploadResult {
  inserted: number;
  overwritten: number;
  unmatched: string[];
  errors: Array<{ line: number; message: string }>;
}

interface GlobalInvoiceUploadFormProps {
  uploadAction: (formData: FormData) => Promise<GlobalUploadResult>;
  carriers: Array<{ id: string; name: string }>;
}

export function GlobalInvoiceUploadForm({ uploadAction, carriers }: GlobalInvoiceUploadFormProps) {
  const [result, setResult] = useState<GlobalUploadResult | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (form: FormData): Promise<void> => {
    setBusy(true);
    try {
      setResult(await uploadAction(form));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form action={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Carrier</div>
            <select name="carrierAccountId" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm">
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Period start</div>
            <input type="date" name="periodStart" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm" />
          </label>
          <label className="text-sm space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Period end</div>
            <input type="date" name="periodEnd" required className="w-full h-9 border border-input bg-input/30 rounded-lg px-3 text-sm" />
          </label>
        </div>
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <Button type="submit" size="sm" className="gap-1.5" disabled={busy}>
          <Upload className="size-3.5" />
          {busy ? 'Importing…' : 'Import CSV'}
        </Button>
      </form>

      {result && (
        <div className="text-sm space-y-2 mt-2">
          <div className="flex flex-wrap gap-3">
            <Badge label="Inserted" value={result.inserted} />
            <Badge label="Overwritten" value={result.overwritten} />
            <Badge label="Unmatched" value={result.unmatched.length} tone={result.unmatched.length > 0 ? 'warn' : 'ok'} />
            <Badge label="Errors" value={result.errors.length} tone={result.errors.length > 0 ? 'err' : 'ok'} />
          </div>

          {result.errors.length > 0 && (
            <details className="bg-destructive/5 border border-destructive/30 rounded-md p-3">
              <summary className="text-destructive font-medium cursor-pointer">{result.errors.length} parsing error(s)</summary>
              <ul className="text-xs font-mono mt-2 space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>line {e.line}: {e.message}</li>)}
              </ul>
            </details>
          )}

          {result.unmatched.length > 0 && (
            <details className="bg-amber-500/5 border border-amber-500/30 rounded-md p-3">
              <summary className="text-amber-600 dark:text-amber-400 font-medium cursor-pointer inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                {result.unmatched.length} tracking number(s) not matched to any synced order — skipped
              </summary>
              <ul className="text-xs font-mono mt-2 space-y-0.5 max-h-48 overflow-auto">
                {result.unmatched.map((t) => <li key={t}>{t}</li>)}
              </ul>
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                Re-upload this CSV after the orders for these tracking numbers have been backfilled or synced.
              </p>
            </details>
          )}
        </div>
      )}
    </>
  );
}

function Badge({ label, value, tone = 'ok' }: { label: string; value: number; tone?: 'ok' | 'warn' | 'err' }) {
  const cls = tone === 'err'
    ? 'bg-destructive/10 text-destructive'
    : tone === 'warn'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-muted text-foreground';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs ${cls}`}>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono tabular-nums font-semibold">{value}</span>
    </span>
  );
}
