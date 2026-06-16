'use client';

import { useState } from 'react';
import { Upload, FileStack, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { BatchImportResult } from '@/features/carrier-rates/ap/bills-actions';

interface Props {
  importAction: (formData: FormData) => Promise<BatchImportResult[]>;
  currency: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Upload NHIỀU file CSV hoá đơn DHL 1 lượt → mỗi file 1 hoá đơn + đối soát cước. */
export function BatchBillUpload({ importAction, currency }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<BatchImportResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() { setFiles([]); setResults(null); setErr(null); }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      setResults(await importAction(fd));
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const skipCount = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
        <FileStack className="size-4" /> Upload nhiều CSV
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[88vh] overflow-auto">
        <DialogHeader><DialogTitle className="text-sm">Upload nhiều hoá đơn DHL (CSV)</DialogTitle></DialogHeader>

        <p className="text-[11px] text-muted-foreground">
          Chọn nhiều file CSV cùng lúc — mỗi file tạo 1 hoá đơn (tự điền + breakdown) và đẩy cước vào đối soát.
          File trùng mã hoặc sai định dạng sẽ bị bỏ qua.
        </p>

        {err && <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{err}</div>}

        {!results && (
          <div className="space-y-3">
            <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Upload className="size-3.5" /> Chọn nhiều file CSV
            </label>
            <input type="file" multiple accept=".csv" onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm" />
            {files.length > 0 && <p className="text-[11px] text-muted-foreground">Đã chọn {files.length} file.</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Huỷ</Button>
              <Button type="button" size="sm" disabled={busy || files.length === 0} onClick={submit}>
                {busy ? `Đang xử lý ${files.length} file…` : `Xử lý ${files.length} file`}
              </Button>
            </div>
          </div>
        )}

        {results && (
          <div className="space-y-3">
            <div className="text-sm"><b className="text-emerald-600 dark:text-emerald-400">{okCount} tạo mới</b> · {skipCount} bỏ qua/lỗi</div>
            <div className="rounded-lg border border-border divide-y divide-border max-h-[50vh] overflow-auto">
              {results.map((r, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                  {r.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.filename}</div>
                    {r.ok ? (
                      <div className="text-muted-foreground">{r.billNumber} · {r.amount != null ? `${fmt(r.amount)} ${currency}` : ''}{r.freight ? ` · đối soát ${r.matched}/${r.freight} cước` : ''}</div>
                    ) : (
                      <div className="text-amber-600 dark:text-amber-400">{r.message}{r.billNumber ? ` (${r.billNumber})` : ''}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end"><Button type="button" size="sm" onClick={() => { setOpen(false); reset(); }}>Đóng</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
