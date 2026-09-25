'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { themAnhNhan, xoaAnhNhan } from '@/features/kho-nhan/anh-nhan';
import type { AnhNhan, LoaiAnhNhan } from '@/features/kho-nhan/types';

const NHAN: Record<LoaiAnhNhan, { ten: string; y: string }> = {
  hang_den: { ten: 'Ảnh hàng đến', y: 'Chụp thấy ĐỦ SỐ LƯỢNG lô hàng vừa nhận' },
  bb_ban_giao: { ten: 'Biên bản bàn giao', y: 'Biên bản brand đưa lúc giao hàng' },
};

/**
 * Tải ảnh lúc nhận hàng, gắn theo PHIẾU NHẬN (CEO 25/09).
 *
 * Đây là hai cột đính kèm "Ảnh Thực Tế SP" và "BB Giao Nhận" bên Lark. Một lô
 * cần nhiều ảnh mới thấy hết số lượng, và biên bản có thể nhiều trang, nên mỗi
 * loại nhận NHIỀU file chứ không phải một.
 */
export function KhoiAnhNhan({
  receiptId, vendor, anh, coStorage, onXong,
}: {
  receiptId: string; vendor: string | null; anh: AnhNhan[];
  coStorage: boolean; onXong: () => void;
}) {
  const [dangTai, setDangTai] = useState<LoaiAnhNhan | null>(null);

  if (!coStorage) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Chưa cấu hình kho lưu file — không tải được ảnh hàng đến và biên bản.
      </p>
    );
  }

  const tai = async (loai: LoaiAnhNhan, files: FileList) => {
    setDangTai(loai);
    try {
      let hong = 0;
      // Tuần tự chứ không song song: tải 10 ảnh cùng lúc từ điện thoại kho là
      // nghẽn mạng và Next từ chối bớt lượt, người dùng chỉ thấy "thất bại".
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.set('receiptId', receiptId); fd.set('loai', loai); fd.set('file', f);
        const r = await themAnhNhan(fd);
        if (!r.ok) { hong += 1; toast.error(`${f.name}: ${r.loi ?? 'lỗi'}`, { duration: 10000 }); }
      }
      const xong = files.length - hong;
      if (xong > 0) toast.success(`Đã tải ${xong} file.`, { duration: 3000 });
      onXong();
    } catch (e) {
      console.error('[kho-nhan] tải ảnh nhận lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại.', { duration: 10000 });
    } finally {
      setDangTai(null);
    }
  };

  const go = async (a: AnhNhan) => {
    const r = await xoaAnhNhan(a.id);
    if (!r.ok) { toast.error(r.loi ?? 'Gỡ ảnh thất bại.', { duration: 10000 }); return; }
    toast.success('Đã gỡ file.', { duration: 3000 });
    onXong();
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(Object.keys(NHAN) as LoaiAnhNhan[]).map((loai) => {
        const cua = anh.filter((a) => a.loai === loai);
        return (
          <div key={loai} className="rounded-lg border border-border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{NHAN[loai].ten}</span>
              <span className={`text-xs ${cua.length ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
                {cua.length ? `${cua.length} file` : 'chưa có'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{NHAN[loai].y}</p>

            <ul className="mt-2 space-y-1">
              {cua.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer"
                       className="flex-1 truncate text-primary hover:underline">
                      {a.tenFile ?? a.s3Key}
                    </a>
                  ) : (
                    <span className="flex-1 truncate text-muted-foreground">{a.tenFile ?? a.s3Key}</span>
                  )}
                  <button
                    type="button" onClick={() => void go(a)}
                    className="cursor-pointer text-muted-foreground hover:text-destructive"
                  >gỡ</button>
                </li>
              ))}
            </ul>

            <label className="mt-2 block">
              <span className="sr-only">Tải {NHAN[loai].ten} cho phiếu {vendor ?? ''}</span>
              <input
                type="file" multiple accept="image/*,.pdf"
                disabled={dangTai !== null}
                onChange={(e) => {
                  const f = e.target.files;
                  if (f && f.length) void tai(loai, f);
                  e.target.value = '';
                }}
                className="block w-full cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
              />
            </label>
            {dangTai === loai && <p className="mt-1 text-xs text-muted-foreground">Đang tải…</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Nhãn nhắc phiếu còn thiếu đính kèm — hiện cạnh tên brand. */
export function NhanThieuAnh({ du }: { du: boolean }) {
  if (du) return null;
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
      thiếu ảnh / biên bản
    </span>
  );
}

export { NHAN as NHAN_ANH_NHAN };
export type { AnhNhan };
