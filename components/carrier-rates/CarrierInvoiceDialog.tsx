'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, Upload, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { InvoicePreview, InvoiceImportResult } from '@/features/carrier-rates/ap/invoice-upload';

interface Props {
  carrierKey: 'fedex' | 'dhl';
  currency: string;
  previewAction: (fd: FormData) => Promise<{ ok: true; preview: InvoicePreview } | { ok: false; message: string }>;
  importAction: (fd: FormData) => Promise<InvoiceImportResult[]>;
}

/** Dialog gộp: 1 file → xem trước (chỉ-đọc) + Lưu; nhiều file → Import hàng loạt. */
export function CarrierInvoiceDialog({ carrierKey, currency, previewAction, importAction }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [results, setResults] = useState<InvoiceImportResult[] | null>(null);
  const [pending, startTransition] = useTransition();

  const fmt = (v: number | null) =>
    v == null ? '—' : `${Math.round(v).toLocaleString('vi-VN')} ${currency}`;

  function reset() {
    setFiles([]);
    setPreview(null);
    setPreviewErr(null);
    setResults(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles(picked);
    setPreview(null);
    setPreviewErr(null);
    setResults(null);

    if (picked.length === 1) {
      const fd = new FormData();
      fd.set('file', picked[0]);
      startTransition(async () => {
        const res = await previewAction(fd);
        if (res.ok) {
          setPreview(res.preview);
          setPreviewErr(null);
        } else {
          setPreview(null);
          setPreviewErr(res.message);
        }
      });
    }
  }

  function doSingle() {
    if (!files[0]) return;
    const fd = new FormData();
    fd.append('files', files[0]);
    startTransition(async () => {
      const res = await importAction(fd);
      setResults(res);
      if (res.some((r) => r.ok)) router.refresh();
    });
  }

  function doBatch() {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    startTransition(async () => {
      const res = await importAction(fd);
      setResults(res);
      if (res.some((r) => r.ok)) router.refresh();
    });
  }

  const isSingle = files.length === 1;
  const isMulti = files.length > 1;
  const carrierLabel = carrierKey === 'fedex' ? 'FedEx' : 'DHL';

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
        <FilePlus2 className="size-4" /> Thêm hoá đơn carrier
      </DialogTrigger>

      <DialogContent className="w-[95vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Thêm hoá đơn {carrierLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File drop / input */}
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
            <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer">
              <Upload className="size-3.5" />
              <span>Chọn hoặc kéo file</span>
            </label>
            <input
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,.pdf"
              className="block w-full text-sm file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-2 file:py-1 file:text-xs"
              onChange={handleFileChange}
            />
            <p className="text-[11px] text-muted-foreground">
              Kéo file hoá đơn (DHL CSV / FedEx XLSX / PDF hoá đơn) — 1 hoặc nhiều
            </p>
          </div>

          {/* Pending indicator */}
          {pending && (
            <p className="text-xs text-muted-foreground animate-pulse">Đang xử lý…</p>
          )}

          {/* Preview error (1 file, parse failed) */}
          {previewErr && !pending && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {previewErr}
            </div>
          )}

          {/* Single-file: read-only preview */}
          {isSingle && preview && !pending && !results && (
            <div className="space-y-3">
              <PreviewBlock preview={preview} fmt={fmt} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
                <Button type="button" size="sm" disabled={pending} onClick={doSingle}>
                  Lưu
                </Button>
              </div>
            </div>
          )}

          {/* Multi-file: list + batch button */}
          {isMulti && !results && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{files.length} file được chọn:</p>
              <ul className="max-h-36 overflow-auto rounded-lg border border-border divide-y divide-border text-xs">
                {files.map((f, i) => (
                  <li key={i} className="px-3 py-1.5 font-mono truncate">{f.name}</li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
                <Button type="button" size="sm" disabled={pending} onClick={doBatch}>
                  {pending ? 'Đang import…' : 'Import hàng loạt'}
                </Button>
              </div>
            </div>
          )}

          {/* Results table */}
          {results && (
            <div className="space-y-2">
              <ResultsTable results={results} fmt={fmt} />
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
              </div>
            </div>
          )}

          {/* Footer buttons when no special state */}
          {!isSingle && !isMulti && !results && (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBlock({ preview, fmt }: { preview: InvoicePreview; fmt: (v: number | null) => string }) {
  if (preview.format === 'invoice_pdf') {
    return (
      <div className="space-y-2">
        <div className="space-y-1 text-sm">
          <div className="font-medium">PDF hoá đơn</div>
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-muted-foreground text-xs">{w}</p>
          ))}
        </div>
      </div>
    );
  }

  const rows: { label: string; value: string }[] = [
    { label: 'Carrier', value: preview.carrier === 'fedex' ? 'FedEx' : 'DHL' },
    { label: 'Số hoá đơn', value: preview.billNumber ?? '—' },
    { label: 'Số tiền', value: fmt(preview.amount) },
    { label: 'Kỳ', value: preview.periodStart ? `${preview.periodStart}${preview.periodEnd && preview.periodEnd !== preview.periodStart ? ` → ${preview.periodEnd}` : ''}` : '—' },
    { label: 'Ngày phát hành', value: preview.issueDate ?? '—' },
    { label: 'Ngày đến hạn', value: preview.dueDate ?? '—' },
    { label: 'Số dòng', value: String(preview.lineCount) },
  ];

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border divide-y divide-border text-sm">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex px-3 py-1.5 gap-3">
            <span className="w-36 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground self-center">{label}</span>
            <span className="font-mono text-xs">{value}</span>
          </div>
        ))}
      </div>

      {preview.warnings.length > 0 && (
        <div className="space-y-1">
          {preview.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3.5 mt-0.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultsTable({ results, fmt }: { results: InvoiceImportResult[]; fmt: (v: number | null) => string }) {
  const allOk = results.every((r) => r.ok);
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${allOk ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
        {allOk
          ? <><CheckCircle2 className="size-4 shrink-0" /> Import thành công {results.length} file.</>
          : <><AlertTriangle className="size-4 shrink-0" /> Hoàn thành với {results.filter((r) => !r.ok).length} lỗi.</>}
      </div>

      <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">File</th>
              <th className="px-3 py-1.5 text-center">Trạng thái</th>
              <th className="px-3 py-1.5 text-left">Số hoá đơn</th>
              <th className="px-3 py-1.5 text-right">Số tiền</th>
              <th className="px-3 py-1.5 text-right">Khớp/Tổng</th>
              <th className="px-3 py-1.5 text-left">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const isSkip = !r.ok && r.message?.includes('bỏ qua');
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono max-w-[180px] truncate">{r.filename}</td>
                  <td className="px-3 py-1.5 text-center">
                    {r.ok
                      ? <CheckCircle2 className="size-3.5 text-emerald-600 inline" />
                      : isSkip
                        ? <AlertTriangle className="size-3.5 text-amber-500 inline" />
                        : <XCircle className="size-3.5 text-destructive inline" />}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{r.billNumber ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.matched != null && r.freight != null ? `${r.matched}/${r.freight}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate">{r.message ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
