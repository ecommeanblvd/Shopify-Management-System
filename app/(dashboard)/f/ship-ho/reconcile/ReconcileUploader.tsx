'use client';

import { useState, useTransition } from 'react';
import { read, utils } from 'xlsx';
import { importCarrierInvoice, type ReconcileSummary } from '@/features/ship-ho/reconcile-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ReconcileUploader() {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<ReconcileSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null); setSummary(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const all = utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
      setRows(all.slice(1));
    } catch {
      setErr('File không đọc được — kiểm tra định dạng .xlsx/.csv'); setRows([]);
    }
  };

  const run = (dryRun: boolean) =>
    start(async () => {
      setErr(null);
      if (rows.length === 0) { setErr('Chưa có dữ liệu'); return; }
      setSummary(await importCarrierInvoice(rows, { dryRun }));
    });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <input type="file" accept=".xlsx,.xls,.csv" className="block text-sm" onChange={onFile} />
        {fileName && <p className="text-xs text-muted-foreground">{fileName} · {rows.length} dòng</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => run(true)} disabled={pending || !rows.length}>Xem trước</Button>
          <Button onClick={() => run(false)} disabled={pending || !rows.length}>Đối soát</Button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {summary && (
          <div className="text-sm border-t pt-3 space-y-1">
            <div>{summary.dryRun ? 'Xem trước' : 'Đã đối soát'}: <b>{summary.matched}</b> khớp · {summary.unmatched} không khớp tracking · {summary.skippedEmpty} trống · {summary.errors.length} lỗi</div>
            {summary.errors.slice(0, 10).map((e) => <div key={e.rowIndex} className="text-red-600 text-xs">Dòng {e.rowIndex + 2}: {e.reason}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
