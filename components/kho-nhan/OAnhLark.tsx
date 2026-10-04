'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { FileLark } from '@/features/kho-nhan/types';

const laAnh = (f: FileLark) => !/\.pdf$/i.test(f.ten);
const duong = (f: FileLark) => `/api/kho-nhan/anh-lark/${f.token}`;
/** Ô trên bảng chỉ cần 56px (28px ở màn hình 2×) — kéo bản gốc 2MB là phí. */
const duongNho = (f: FileLark) => `${duong(f)}?w=56`;

/**
 * Ô đính kèm trên từng dòng Sổ nhập: ảnh nhỏ, bấm mở ảnh to (CEO 26/09).
 *
 * File nằm trên Lark Drive và chỉ tải được kèm token của app, nên ảnh đi vòng
 * qua `/api/kho-nhan/anh-lark` — route đó tự kiểm quyền xem kho.
 *
 * Nhiều file thì xếp CHỒNG chứ không bày "+2" cạnh ảnh (CEO 04/10/2026): chữ nằm cạnh làm ô
 * rộng hơn ô một ảnh, nên cả cột lệch theo từng dòng. Số file vẫn đọc được ở `title` và nhãn
 * trợ năng — thông tin không mất, chỉ thôi chiếm chỗ.
 */
/**
 * Một tấm 26px trong chồng ảnh.
 *
 * `sau` = tấm nằm phía sau: `aria-hidden` và `alt` rỗng, vì nó chỉ là dấu hiệu "còn nữa" —
 * trình đọc màn hình đọc lại tên nhóm ba lần thì chỉ gây nhiễu, số file đã nằm ở nhãn của nút.
 *
 * PDF không có ảnh xem trước nên vẽ ô chữ; ở lớp sau thì bỏ cả chữ, 26px không đọc nổi.
 */
function Tam({ f, lop, nhan, sau }: { f: FileLark; lop: string; nhan?: string; sau?: boolean }) {
  const chung = `absolute ${lop} size-[26px] rounded-[3px] border border-border`;
  if (!laAnh(f)) {
    return (
      <span aria-hidden={sau} className={`${chung} grid place-items-center bg-background text-[9px] text-muted-foreground`}>
        {sau ? '' : 'PDF'}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua route nội bộ có kiểm quyền, không qua optimiser của Next
    <img src={duongNho(f)} alt={sau ? '' : nhan} aria-hidden={sau} loading="lazy"
         className={`${chung} bg-background object-cover`} />
  );
}

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
        aria-label={`${nhan} — ${ds.length} file`}
        className="mx-auto block cursor-pointer"
      >
        {/* Nhiều file thì xếp CHỒNG, mép tấm sau hé ra phía trên-phải (CEO 04/10/2026).
            Trước đó là ảnh + chữ "+2" nằm cạnh, làm ô rộng hơn các ô một ảnh nên cả cột lệch.
            Khung ngoài LUÔN 32px dù một hay năm file, nên mọi dòng thẳng hàng tuyệt đối. */}
        <span className="relative block size-8">
          {/* Tấm sau là ẢNH THẬT, không phải ô xám (CEO 04/10/2026) — nhìn chồng ảnh là đoán
              được bên trong có gì. Thứ tự vẽ: xa nhất trước, tấm đầu đè lên trên cùng. */}
          {ds[2] && <Tam f={ds[2]} lop="right-0 top-0" sau />}
          {ds[1] && <Tam f={ds[1]} lop="right-[3px] top-[3px]" sau />}
          <Tam f={ds[0]!} lop="bottom-0 left-0" nhan={nhan} />
        </span>
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
