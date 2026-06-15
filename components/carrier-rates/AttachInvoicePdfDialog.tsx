'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { AttachPdfResult } from '@/features/carrier-rates/ap/bills-actions';

interface Props {
  attachAction: (fd: FormData) => Promise<AttachPdfResult>;
}

/** Nút "Đính PDF hoá đơn" → chọn nhiều PDF → khớp vào bill theo SỐ HOÁ ĐƠN
 *  (đọc trong nội dung PDF). Báo khớp/không khớp. */
export function AttachInvoicePdfDialog({ attachAction }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<AttachPdfResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() { setFiles([]); setResult(null); setProgress(null); setError(null); }

  // Upload TỪNG file (mỗi request 1 PDF) → bền, không vượt body limit, có tiến độ.
  function doAttach() {
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      const acc: AttachPdfResult = { attached: [], unmatched: [], totalBills: 0 };
      try {
        for (let i = 0; i < files.length; i++) {
          setProgress({ done: i, total: files.length });
          const fd = new FormData();
          fd.append('files', files[i]);
          const r = await attachAction(fd);
          acc.attached.push(...r.attached);
          acc.unmatched.push(...r.unmatched);
          acc.totalBills = r.totalBills;
          setResult({ ...acc });
        }
        setProgress({ done: files.length, total: files.length });
        router.refresh();
      } catch (e) { setError(`${(e as Error).message} (đã đính ${acc.attached.length} bill trước khi dừng)`); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
        <FileText className="size-4" /> Đính PDF hoá đơn
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Đính PDF hoá đơn FedEx vào bill</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
            <Label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Upload className="size-3.5" /> PDF hoá đơn (chọn nhiều)
            </Label>
            <Input
              type="file" accept=".pdf" multiple
              onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResult(null); setError(null); }}
            />
            <p className="text-[11px] text-muted-foreground">
              Hệ thống đọc SỐ HOÁ ĐƠN bên trong từng PDF rồi đính vào đúng bill (kể cả file đặt tên PART_1, PART_2…). Đính lại cập nhật file, không trùng.
            </p>
            {files.length > 0 && <p className="text-[11px] text-muted-foreground">Đã chọn {files.length} file.</p>}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-4 shrink-0" />
                Đã đính vào {result.attached.length} bill theo số hoá đơn (1 PDF có thể gom nhiều hoá đơn).
              </div>
              {result.attached.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-lg border border-border text-sm">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr><th className="px-3 py-1.5 text-left">Số hoá đơn</th><th className="px-3 py-1.5 text-left">File</th></tr>
                    </thead>
                    <tbody>
                      {result.attached.map((a, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-1.5 font-mono text-xs">{a.invoice}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground truncate">{a.filename}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.unmatched.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  <div className="font-medium">{result.unmatched.length} PDF chưa khớp:</div>
                  {result.unmatched.slice(0, 10).map((u, i) => (
                    <div key={i} className="font-mono">{u.filename} — {u.reason}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Đóng</Button>
            {(!result || pending) && (
              <Button type="button" size="sm" disabled={files.length === 0 || pending} onClick={doAttach}>
                {pending
                  ? `Đang đính… (${progress?.done ?? 0}/${progress?.total ?? files.length})`
                  : `Đính ${files.length || ''} PDF`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
