'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { FileLark } from '@/features/kho-nhan/types';

const laAnh = (f: FileLark) => !/\.pdf$/i.test(f.ten);
const duong = (f: FileLark) => `/api/kho-nhan/anh-lark/${f.token}`;

/**
 * Ô đính kèm trên từng dòng Sổ nhập: ảnh nhỏ, bấm mở ảnh to (CEO 26/09).
 *
 * File nằm trên Lark Drive và chỉ tải được kèm token của app, nên ảnh đi vòng
 * qua `/api/kho-nhan/anh-lark` — route đó tự kiểm quyền xem kho.
 */
export function OAnhLark({ ds, nhan }: { ds: FileLark[]; nhan: string }) {
  const [mo, setMo] = useState(false);
  const [i, setI] = useState(0);

  if (ds.length === 0) return <span className="block text-center text-xs text-muted-foreground">—</span>;

  const hien = ds[i] ?? ds[0]!;
  const doi = (b: number) => setI((c) => (c + b + ds.length) % ds.length);

  return (
    <>
      <button
        type="button" onClick={() => { setI(0); setMo(true); }}
        title={`${ds.length} file — bấm để xem to`}
        className="flex cursor-pointer items-center justify-center gap-1"
      >
        {laAnh(ds[0]!) ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua route nội bộ có kiểm quyền, không qua optimiser của Next
          <img src={duong(ds[0]!)} alt={nhan} loading="lazy"
               className="size-7 rounded border border-border object-cover" />
        ) : (
          <span className="grid size-7 place-items-center rounded border border-border text-[9px] text-muted-foreground">PDF</span>
        )}
        {ds.length > 1 && <span className="text-[10px] text-muted-foreground">+{ds.length - 1}</span>}
      </button>

      <Dialog open={mo} onOpenChange={(v) => { if (!v) setMo(false); }}>
        <DialogContent className="flex h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
          <div className="flex shrink-0 items-baseline gap-3 border-b border-border px-5 py-3">
            <DialogTitle className="text-base font-semibold">{nhan}</DialogTitle>
            <span className="text-xs text-muted-foreground">{hien.ten}</span>
            {ds.length > 1 && (
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{i + 1}/{ds.length}</span>
            )}
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted">
            {laAnh(hien) ? (
              // eslint-disable-next-line @next/next/no-img-element -- như trên
              <img src={duong(hien)} alt={hien.ten}
                   className="max-h-full max-w-full object-contain" />
            ) : (
              <a href={duong(hien)} target="_blank" rel="noreferrer"
                 className="text-sm text-primary hover:underline">
                Mở {hien.ten}
              </a>
            )}
            {ds.length > 1 && (
              <>
                <button type="button" onClick={() => doi(-1)} aria-label="File trước"
                  className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background/80 hover:bg-background"
                ><ChevronLeftIcon className="size-5" /></button>
                <button type="button" onClick={() => doi(1)} aria-label="File sau"
                  className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background/80 hover:bg-background"
                ><ChevronRightIcon className="size-5" /></button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
