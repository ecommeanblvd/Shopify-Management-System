'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { StagedRateCard } from '@/features/carrier-rates/rate-card-upload-actions';

export function RateCardUpload({
  stageAction,
  commitAction,
}: {
  stageAction: (formData: FormData) => Promise<StagedRateCard>;
  commitAction: (input: { pdfKey: string; filename: string; effectiveFrom: string; effectiveTo: string | null }) => Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [staged, setStaged] = useState<StagedRateCard | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onStage(formData: FormData) {
    setError(null);
    try {
      const s = await stageAction(formData);
      setStaged(s);
      setFrom(s.effectiveFromGuess ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onCommit() {
    if (!staged) return;
    setError(null);
    start(async () => {
      try {
        await commitAction({ pdfKey: staged.pdfKey, filename: staged.filename, effectiveFrom: from, effectiveTo: to.trim() || null });
        setStaged(null); setFrom(''); setTo('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const blocked = !!staged?.preview && !staged.preview.selfCheckOk;

  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <form action={onStage} className="flex items-end gap-3">
        <input type="file" name="file" accept="application/pdf" required className="text-sm" />
        <Button type="submit" variant="outline">Upload &amp; preview</Button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {staged && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="text-sm font-medium">{staged.filename}</div>
          {staged.note && <p className="text-xs text-amber-600">{staged.note}</p>}
          {staged.preview && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>{staged.preview.parserLabel} — Package {staged.preview.packageCells}, Pak {staged.preview.pakCells}, zones {staged.preview.zonesCovered}</div>
              <div>Spot-checks: {staged.preview.spotChecks.filter((s) => s.ok).length}/{staged.preview.spotChecks.length} ✓</div>
              <table className="mt-2 border-collapse text-[11px]">
                <tbody>
                  {staged.preview.heavy.map((h) => (
                    <tr key={h.band}>
                      <td className="pr-3 font-mono">{h.band}</td>
                      <td className="font-mono">{h.rates.map((r) => `${r.zone}:${r.perKg.toLocaleString()}`).join('  ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-end gap-3">
            <label className="text-xs space-y-1">
              <span className="block text-muted-foreground uppercase tracking-wider">Effective from</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required className="block rounded-md border border-border bg-card px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs space-y-1">
              <span className="block text-muted-foreground uppercase tracking-wider">Effective to (blank = open)</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block rounded-md border border-border bg-card px-2 py-1.5 text-sm" />
            </label>
            <Button onClick={onCommit} disabled={pending || blocked || !from}>
              {pending ? 'Importing…' : 'Create card & import'}
            </Button>
          </div>
          {blocked && <p className="text-xs text-red-600">Self-check failed — fix the sheet before importing.</p>}
        </div>
      )}
    </div>
  );
}
