'use client';

import { useState, useTransition } from 'react';
import { Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileDrop } from '@/components/ui/file-drop';
import { nhapCreditNote, type KetQuaNhapCreditNote } from '@/features/carrier-rates/ap/credit-note-import';
import { NHAN_LOAI } from '@/features/carrier-rates/ap/hoa-don-xml';

const tien = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;

interface Dong extends Partial<KetQuaNhapCreditNote> { tenFile: string; trangThai: 'cho' | 'dang' | 'xong' | 'loi'; loiText?: string }

/**
 * Modal tải hoá đơn điều chỉnh: kéo thả cả loạt file vào một lần. Xử lý tuần tự từng file để kết quả hiện dần và một
 * file hỏng không làm hỏng cả mẻ.
 */
export function CreditNoteUpload() {
  const [open, setOpen] = useState(false);
  const [dong, setDong] = useState<Dong[]>([]);
  const [pending, start] = useTransition();

  const nhan = (files: File[]) => {
    setDong((cu) => [...cu, ...files.map((f) => ({ tenFile: f.name, trangThai: 'cho' as const }))]);
    start(async () => {
      for (const f of files) {
        setDong((cu) => cu.map((d) => (d.tenFile === f.name && d.trangThai === 'cho' ? { ...d, trangThai: 'dang' } : d)));
        try {
          const b64 = Buffer.from(await f.arrayBuffer()).toString('base64');
          const kq = await nhapCreditNote(f.name, b64);
          setDong((cu) => cu.map((d) => (d.tenFile === f.name && d.trangThai === 'dang' ? { ...kq, trangThai: 'xong' } : d)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setDong((cu) => cu.map((d) => (d.tenFile === f.name && d.trangThai === 'dang' ? { ...d, trangThai: 'loi', loiText: msg } : d)));
        }
      }
    });
  };

  const xong = dong.filter((d) => d.trangThai === 'xong');
  const daGhi = xong.filter((d) => d.daGhi).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDong([]); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted">
        <Upload className="size-4" /> Tải hoá đơn điều chỉnh
      </DialogTrigger>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Tải hoá đơn điều chỉnh (credit / billing note)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FileDrop
            accept=".msg,.zip,.xml,.csv"
            disabled={pending}
            onFiles={nhan}
            tieuDe="Kéo thả cả loạt email hoá đơn vào đây"
            goiY={<>
              Nhận thẳng email <b>.msg</b> của carrier (đọc luôn XML và CSV bên trong), hoặc .zip / .xml / .csv rời.
              Bấm để chọn cũng được. Hệ thống tự tách credit note (carrier trả lại) và billing note (mình trả thêm);
              lỡ thả hoá đơn cước kỳ vào thì báo lại chứ không ghi sai chỗ.
            </>}
          />

          {dong.length > 0 && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {pending && <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Đang đọc…</span>}
                <span>{xong.length}/{dong.length} tệp xử lý xong · đã ghi {daGhi}</span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                      <th className="text-left">Tệp</th><th className="text-left">Hoá đơn</th><th className="text-left">Loại</th>
                      <th className="text-right">Ngày</th><th className="text-right">Số tiền</th><th className="text-left">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dong.map((r, i) => (
                      <tr key={`${r.tenFile}-${i}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2 align-top">
                        <td className="max-w-[220px] truncate text-left text-xs" title={r.tenFile}>{r.tenFile}</td>
                        <td className="text-left">{r.hoaDon ? `${r.hoaDon.kyHieu}-${r.hoaDon.soHoaDon}` : '—'}</td>
                        <td className="text-left text-xs" title={r.canCuPhanLoai ?? ''}>
                          {r.loai
                            ? <span className={r.loai === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : r.loai === 'debit' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>{NHAN_LOAI[r.loai]}</span>
                            : '—'}
                        </td>
                        <td className="text-right">{r.hoaDon?.ngay ?? '—'}</td>
                        <td className="text-right font-medium">{r.hoaDon ? tien(Math.abs(r.hoaDon.tongCong)) : '—'}</td>
                        <td className="text-left text-[11px]">
                          {r.trangThai === 'cho' && <span className="text-muted-foreground">Đang chờ</span>}
                          {r.trangThai === 'dang' && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Đang đọc</span>}
                          {r.trangThai === 'loi' && <span className="inline-flex items-start gap-1 text-red-600 dark:text-red-400"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{r.loiText}</span>}
                          {r.trangThai === 'xong' && (
                            r.daGhi
                              ? <span className="inline-flex items-start gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="mt-0.5 size-3 shrink-0" />{r.daCo ? 'Đã có, cập nhật lại' : 'Đã ghi'}{r.soDongChiTiet ? ` · ${r.soDongKhopKien}/${r.soDongChiTiet} khớp kiện` : ''}</span>
                              : <span className="inline-flex items-start gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{(r.canhBao ?? []).join(' ')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDong([])} disabled={pending}>Xoá danh sách</Button>
                <Button size="sm" onClick={() => { setOpen(false); setDong([]); }} disabled={pending}>Xong</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
