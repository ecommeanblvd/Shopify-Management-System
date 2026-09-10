'use client';

import { useRef, useState, useTransition } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nhapCreditNote, type KetQuaNhapCreditNote } from '@/features/carrier-rates/ap/credit-note-import';
import { NHAN_LOAI } from '@/features/carrier-rates/ap/hoa-don-xml';

const tien = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;

/**
 * Kéo thẳng email hoá đơn điện tử (.msg) của carrier vào đây. Hệ thống đọc XML lấy số/ngày/tiền và đọc CSV để biết
 * đợt điều chỉnh đụng những đơn nào. Cũng nhận .zip / .xml / .csv rời.
 */
export function CreditNoteUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [kq, setKq] = useState<KetQuaNhapCreditNote[]>([]);
  const [loi, setLoi] = useState<string | null>(null);

  const chon = (files: FileList | null) => {
    if (!files?.length) return;
    setLoi(null);
    start(async () => {
      const out: KetQuaNhapCreditNote[] = [];
      for (const f of Array.from(files)) {
        try {
          const b64 = Buffer.from(await f.arrayBuffer()).toString('base64');
          out.push(await nhapCreditNote(f.name, b64));
        } catch (e) {
          setLoi(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setKq(out);
      if (inputRef.current) inputRef.current.value = '';
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={inputRef} type="file" multiple accept=".msg,.zip,.xml,.csv"
          onChange={(e) => chon(e.target.files)} className="hidden" id="cn-file" />
        <Button variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="mr-1.5 size-4" /> Chọn tệp credit note
        </Button>
        {pending && <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Đang đọc…</span>}
        <span className="text-xs text-muted-foreground">
          Nhận email .msg của carrier (đọc luôn XML + CSV bên trong), hoặc .zip / .xml / .csv rời. Chọn nhiều tệp một lần được.
          Hệ thống tự phân loại credit note (carrier trả lại) hay billing note (mình trả thêm) theo dấu tổng tiền trên hoá đơn.
        </span>
      </div>

      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      {kq.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Tệp</th><th className="text-left">Hoá đơn</th><th className="text-left">Loại</th><th className="text-right">Ngày</th>
                <th className="text-right">Số tiền</th><th className="text-right">Chi tiết kiện</th><th className="text-left">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {kq.map((r, i) => (
                <tr key={`${r.tenFile}-${i}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2 align-top">
                  <td className="text-left text-xs">{r.tenFile}</td>
                  <td className="text-left">{r.hoaDon ? `${r.hoaDon.kyHieu}-${r.hoaDon.soHoaDon}` : '—'}</td>
                  <td className="text-left text-xs" title={r.canCuPhanLoai ?? ''}>
                    {r.loai ? <span className={r.loai === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{NHAN_LOAI[r.loai]}</span> : '—'}
                  </td>
                  <td className="text-right">{r.hoaDon?.ngay ?? '—'}</td>
                  <td className={`text-right font-medium ${(r.hoaDon?.tongCong ?? 0) < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                    {r.hoaDon ? tien(Math.abs(r.hoaDon.tongCong)) : '—'}
                  </td>
                  <td className="text-right text-muted-foreground">{r.soDongChiTiet ? `${r.soDongKhopKien}/${r.soDongChiTiet} khớp kiện` : '—'}</td>
                  <td className="text-left text-[11px] text-muted-foreground">
                    {r.daCo ? 'Đã có, đã cập nhật lại. ' : ''}{r.canhBao.join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
