'use client';

import { useState, useTransition } from 'react';
import { read, utils } from 'xlsx';
import { importShipHoOrders, type ShipHoImportSummary } from '@/features/ship-ho/import-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PartnerOpt { slug: string; name: string }

export function ImportUploader({ partners }: { partners: PartnerOpt[] }) {
  const [pending, start] = useTransition();
  const [partner, setPartner] = useState('');
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<ShipHoImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null); setSummary(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const all = utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
    setRows(all.slice(1)); // bỏ header
  };

  const run = (dryRun: boolean) =>
    start(async () => {
      setErr(null);
      if (!partner) { setErr('Chọn partner'); return; }
      if (rows.length === 0) { setErr('Chưa có dữ liệu'); return; }
      const s = await importShipHoOrders(rows, partner, { dryRun });
      setSummary(s);
    });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <label className="text-sm block">Partner
          <select className="block w-full border rounded px-2 py-1 mt-1" value={partner} onChange={(e) => setPartner(e.target.value)}>
            <option value="">— chọn —</option>
            {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm block">File .xlsx
          <input type="file" accept=".xlsx,.xls" className="block mt-1 text-sm" onChange={onFile} />
        </label>
        {fileName && <p className="text-xs text-muted-foreground">{fileName} · {rows.length} dòng dữ liệu</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => run(true)} disabled={pending || !rows.length}>Xem trước (dry-run)</Button>
          <Button onClick={() => run(false)} disabled={pending || !rows.length}>Import</Button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {summary && (
          <div className="text-sm border-t pt-3 space-y-1">
            <div>{summary.dryRun ? 'Xem trước' : 'Đã import'}: <b>{summary.inserted}</b> tạo mới · <b>{summary.updated}</b> cập nhật · {summary.skippedEmpty} dòng trống · {summary.errors.length} lỗi</div>
            {summary.errors.slice(0, 10).map((e) => <div key={e.rowIndex} className="text-red-600 text-xs">Dòng {e.rowIndex + 2}: {e.reason}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
