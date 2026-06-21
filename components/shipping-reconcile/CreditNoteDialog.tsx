'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { applyCreditNote, type CreditApplyResult } from '@/features/shipments/claim-resolution-actions';

const fmtVnd = (n: number): string =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(n));

/** Dialog upload credit note XML (+ PDF tuỳ chọn) để áp thu hồi cho các đơn đang đòi. */
export function CreditNoteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreditApplyResult | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFiles([]);
    setError(null);
    setResult(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles(picked);
    setError(null);
    setResult(null);
  }

  function handleSubmit() {
    setError(null);
    setResult(null);

    const xmlF = files.find((f) => /\.xml$/i.test(f.name));
    const pdfF = files.find((f) => /\.pdf$/i.test(f.name));

    if (!xmlF) {
      setError('Cần file XML credit note (để khớp). PDF chỉ là bằng chứng.');
      return;
    }

    startTransition(async () => {
      const toUp = async (f: File) => ({
        bytes: new Uint8Array(await f.arrayBuffer()),
        filename: f.name,
        contentType: f.type,
      });

      try {
        const res = await applyCreditNote({
          xml: await toUp(xmlF),
          pdf: pdfF ? await toUp(pdfF) : undefined,
        });
        setResult(res);
        if (res.matched.length > 0) router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lỗi không xác định khi áp credit note.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
        <FilePlus2 className="size-4" /> Upload credit note
      </DialogTrigger>

      <DialogContent className="w-[95vw] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Upload credit note (XML + PDF)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File input */}
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
            <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer">
              <Upload className="size-3.5" />
              <span>Chọn hoặc kéo file XML + PDF</span>
            </label>
            <input
              type="file"
              multiple
              accept=".xml,.pdf"
              className="block w-full text-sm file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-2 file:py-1 file:text-xs"
              onChange={handleFileChange}
            />
            <p className="text-[11px] text-muted-foreground">
              File <span className="font-mono">.xml</span> TT78 là bắt buộc (để khớp tracking). File <span className="font-mono">.pdf</span> tuỳ chọn (bằng chứng).
            </p>
          </div>

          {/* Selected files list */}
          {files.length > 0 && !result && (
            <ul className="rounded-lg border border-border divide-y divide-border text-xs">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="font-mono truncate">{f.name}</span>
                  {/\.xml$/i.test(f.name) && (
                    <span className="shrink-0 rounded bg-sky-500/10 px-1 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">XML (khớp)</span>
                  )}
                  {/\.pdf$/i.test(f.name) && (
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">PDF (proof)</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Pending */}
          {pending && (
            <p className="text-xs text-muted-foreground animate-pulse">Đang xử lý credit note…</p>
          )}

          {/* Error */}
          {error && !pending && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {/* Result */}
          {result && !pending && (
            <div className="space-y-3">
              {result.creditNoteNumber && (
                <p className="text-xs text-muted-foreground">
                  Credit note: <span className="font-mono font-medium text-foreground">{result.creditNoteNumber}</span>
                </p>
              )}

              {/* Matched */}
              {result.matched.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Đã khớp ({result.matched.length} tracking)
                  </div>
                  <div className="max-h-48 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Tracking</th>
                          <th className="px-3 py-1.5 text-right">Số giảm (VND)</th>
                          <th className="px-3 py-1.5 text-center">Kết quả</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {result.matched.map((m, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 font-mono">{m.tracking}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(m.creditVnd)}đ</td>
                            <td className="px-3 py-1.5 text-center">
                              {m.credited
                                ? <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">đã thu hồi đủ</span>
                                : <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">thu hồi 1 phần</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Unmatched */}
              {result.unmatched.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3.5" /> Không khớp ({result.unmatched.length} tracking)
                  </div>
                  <div className="max-h-36 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Tracking</th>
                          <th className="px-3 py-1.5 text-right">Số giảm (VND)</th>
                          <th className="px-3 py-1.5 text-left">Lý do</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {result.unmatched.map((u, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 font-mono">{u.tracking}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(u.creditVnd)}đ</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{u.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.matched.length === 0 && result.unmatched.length === 0 && (
                <p className="text-xs text-muted-foreground">Credit note không có dòng nào để khớp.</p>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
            {!result && (
              <Button
                type="button"
                size="sm"
                disabled={pending || files.length === 0}
                onClick={handleSubmit}
              >
                {pending ? 'Đang áp…' : 'Áp credit note'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
