'use client';

import { useState, useTransition } from 'react';
import { LY_DO_CHAM } from '@/features/shipments/ly-do-cham';
import { datLyDoCham } from '@/features/shipments/ly-do-actions';

/** Ô chọn lý do giao chậm cho một kiện — lưu ngay khi chọn. */
export function LyDoChamSelect({ shipmentId, banDau, sauKhiLuu }: {
  shipmentId: string;
  banDau: string | null;
  /** Gọi sau khi lưu xong — bảng KPI dùng để nạp lại vì đổi lý do có thể đổi cả kết quả chấm. */
  sauKhiLuu?: () => void;
}) {
  const [ma, setMa] = useState(banDau ?? '');
  const [pending, start] = useTransition();
  const [loi, setLoi] = useState(false);

  const doi = (v: string) => {
    setMa(v); setLoi(false);
    start(async () => {
      try { await datLyDoCham({ shipmentId, lyDo: v || null }); sauKhiLuu?.(); }
      catch { setLoi(true); setMa(banDau ?? ''); }
    });
  };

  return (
    <select
      value={ma}
      disabled={pending}
      onChange={(e) => doi(e.target.value)}
      title={loi ? 'Lưu không được — kiểm tra quyền' : 'Lý do giao chậm; lý do thuộc nhóm ngoài tầm kiểm soát sẽ được loại khỏi KPI nhân sự'}
      className={`h-7 max-w-[230px] rounded-md border bg-input/30 px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${loi ? 'border-red-500' : 'border-input'} ${ma ? '' : 'text-muted-foreground'}`}
    >
      <option value="">— chưa gán lý do —</option>
      {LY_DO_CHAM.map((l) => (
        <option key={l.ma} value={l.ma}>{l.loaiTruKpi ? '◦ ' : '• '}{l.ten}</option>
      ))}
    </select>
  );
}
