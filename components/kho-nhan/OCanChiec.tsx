'use client';

import { useState, useTransition } from 'react';
import { datCanChiec } from '@/features/kho-nhan/qc-actions';

/**
 * Ô cân sửa tại chỗ trên bảng "Nhận hôm nay" (CEO 01/10/2026).
 *
 * CEO chốt: cân điền SAU khi kiểm, không bắt buộc lúc đó, bổ sung được sau ngay tại bảng này.
 * Nên ô phải luôn gõ được, không phụ thuộc đã kiểm hay chưa.
 *
 * Lưu khi RỜI Ô hoặc Enter, không lưu theo từng phím: mỗi lần gõ một chữ số mà bắn một lượt ghi
 * thì "1" trên đường tới "1.5" cũng thành một lần lưu, và số trung gian đó là số không ai cân.
 *
 * Gõ sai thì GIỮ NGUYÊN chữ người ta vừa gõ và hiện lỗi cạnh ô — không tự xoá về số cũ. Xoá hộ
 * là làm mất thứ người dùng vừa nhập mà họ không kịp thấy mình sai ở đâu.
 */
export function OCanChiec({ itemId, canKg }: { itemId: string; canKg: string | null }) {
  const goc = canKg == null ? '' : String(Number(canKg));
  const [gt, setGt] = useState(goc);
  const [loi, setLoi] = useState<string | null>(null);
  const [xong, setXong] = useState(false);
  const [dangLuu, start] = useTransition();

  const luu = () => {
    if (gt.trim() === goc.trim()) { setLoi(null); return; } // không đổi thì không ghi
    start(async () => {
      const r = await datCanChiec(itemId, gt);
      if (r.ok) { setLoi(null); setXong(true); setTimeout(() => setXong(false), 1200); }
      else setLoi(r.loi ?? 'Không lưu được');
    });
  };

  return (
    <div className="flex items-center gap-1">
      <input
        value={gt}
        onChange={(e) => { setGt(e.target.value); setLoi(null); }}
        onBlur={luu}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        disabled={dangLuu}
        inputMode="decimal"
        placeholder="—"
        aria-label="Cân (kg)"
        aria-invalid={loi != null}
        className={`w-16 rounded border bg-transparent px-1.5 py-0.5 text-right text-xs tabular-nums outline-none
          focus:border-ring ${loi ? 'border-red-500' : 'border-border'} ${dangLuu ? 'opacity-60' : ''}`}
      />
      <span className="text-[11px] text-muted-foreground">kg</span>
      {xong && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">đã lưu</span>}
      {loi && <span className="max-w-[160px] text-[11px] leading-tight text-red-600 dark:text-red-400">{loi}</span>}
    </div>
  );
}
