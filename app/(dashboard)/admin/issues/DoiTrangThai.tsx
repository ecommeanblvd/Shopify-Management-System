'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { doiTrangThaiBaoLoi } from '@/features/issue-report/actions';
import { TRANG_THAI } from '@/features/issue-report/phan-loai';

export function DoiTrangThai({ id, hienTai }: { id: string; hienTai: string }) {
  const [dang, bat] = useTransition();
  return (
    <select
      value={hienTai}
      disabled={dang}
      aria-label="Đổi trạng thái"
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
      onChange={(e) => bat(async () => {
        try {
          const kq = await doiTrangThaiBaoLoi(id, e.target.value);
          if (!kq.ok) toast.error(kq.loi ?? 'Không đổi được.');
        } catch {
          toast.error('Không đổi được trạng thái.');
        }
      })}
    >
      {TRANG_THAI.map((t) => <option key={t.ma} value={t.ma}>{t.nhan}</option>)}
    </select>
  );
}
