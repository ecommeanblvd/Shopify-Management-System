'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { doiKetQuaQc } from '@/features/kho-nhan/qc-actions';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import { nhanKho } from '@/features/warehouse/ten-kho';
import type { DongSoNhap } from '@/features/kho-nhan/types';

/**
 * Ô QC SỬA ĐƯỢC TẠI CHỖ trên Sổ nhập & đối chiếu — CEO 14/10/2026: quản lý
 * (Operation Coordinator) đổi thẳng trạng thái ở cột QC, không thêm nút, không mở màn khác.
 *
 * Người không có quyền `sua_ket_qua_qc` thấy đúng chữ như cũ (`OChiDoc`), không thấy ô chọn.
 *
 * Vì sao đổi xong còn một bước xác nhận nhỏ chứ không áp ngay: đổi sang ĐẠT thì PHẢI biết
 * nhập vào kho nào (không có kho thì hàng vào tồn mà không ai cấp phát được), và cả hai chiều
 * đều phải ghi LÝ DO vào nhật ký — đây là sửa lại kết luận của người khác trên hàng thật.
 * Bước xác nhận bung ngay dưới ô, không nhảy sang hộp thoại nào.
 */
export function OSuaQc({
  dong, suaDuocQc, chuQc, mauQc, children,
}: {
  dong: DongSoNhap; suaDuocQc: boolean; chuQc: string; mauQc: string;
  /** Phần hiển thị chỉ-đọc dùng chung với người không có quyền. */
  children: React.ReactNode;
}) {
  const [den, setDen] = useState<'pass' | 'fail' | ''>('');
  const [kho, setKho] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const qc = dong.qcHeThong;
  const suaDuoc = suaDuocQc && dong.chiecId != null && (qc === 'pass' || qc === 'fail');
  if (!suaDuoc) return <>{children}</>;

  // Đoán trước điều máy chủ sẽ từ chối, để không mời người ta bấm một thứ chắc chắn hỏng.
  // Luật thật nằm ở `doiDuocKetQuaQc` và máy chủ vẫn kiểm lại.
  const daDi = dong.trangThaiKho === 'shipped' || dong.trangThaiDong === 'shipped';
  const dangGiuChoDon = dong.trangThaiKho === 'allocated' || dong.trangThaiKho === 'staging';
  const chanSangFail = qc === 'pass'
    ? (daDi ? 'Đã gửi đi — không đổi sang KHÔNG ĐẠT được.'
      : dangGiuChoDon ? 'Đang giữ cho một đơn — gỡ khỏi đơn trước đã.' : null)
    : null;

  const gui = () => start(async () => {
    setLoi(null);
    const r = await doiKetQuaQc(dong.chiecId!, den as 'pass' | 'fail', den === 'pass' ? kho : null, ghiChu);
    if (!r.ok) { setLoi(r.loi ?? 'Không đổi được.'); return; }
    setDen(''); setKho(''); setGhiChu('');
    router.refresh();
  });

  return (
    <span className="relative flex min-w-0 items-center gap-1.5">
      <span className={`size-1.5 shrink-0 rounded-full ${mauQc}`} />
      <select
        value={den === '' ? (qc ?? '') : den}
        onChange={(e) => { setDen(e.target.value as 'pass' | 'fail'); setLoi(null); }}
        aria-label={`Đổi kết quả QC — ${dong.sku ?? dong.uniqueCode ?? ''}`}
        className={`h-6 min-w-0 max-w-full cursor-pointer truncate rounded border border-transparent bg-transparent px-1 text-xs hover:border-input focus-visible:border-input focus-visible:outline-none ${chuQc}`}
      >
        <option value="pass">QC Pass</option>
        <option value="fail">QC Failed</option>
      </select>

      {den !== '' && den !== qc && (
        /* Bung ngay dưới ô, nổi lên trên các dòng khác — bảng có hàng cao cố định 38px nên
           xác nhận chen vào trong dòng sẽ phá cả lưới. */
        <span
          className="absolute left-0 top-7 z-30 flex w-[420px] max-w-[80vw] flex-col gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {chanSangFail && den === 'fail' ? (
            <span className="text-[11.5px] text-muted-foreground">{chanSangFail}</span>
          ) : (
            <>
              <span className="flex flex-wrap items-end gap-1.5">
                {den === 'pass' && (
                  <select
                    value={kho} onChange={(e) => setKho(e.target.value)} aria-label="Nhập vào kho"
                    className="h-7 cursor-pointer rounded border border-input bg-background px-1 text-xs"
                  >
                    <option value="">— chọn kho —</option>
                    {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{nhanKho(k)}</option>)}
                  </select>
                )}
                <input
                  value={ghiChu} onChange={(e) => setGhiChu(e.target.value)}
                  placeholder={den === 'pass' ? 'Lý do: kiểm lại thấy vẫn dùng được…' : 'Lý do: bấm nhầm…'}
                  aria-label="Lý do đổi kết quả QC"
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs"
                />
                <button
                  type="button" onClick={gui}
                  disabled={pending || ghiChu.trim().length < 3 || (den === 'pass' && kho === '')}
                  className="h-7 cursor-pointer rounded border border-border px-2 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? 'Đang đổi…' : 'Đổi'}
                </button>
                <button
                  type="button" onClick={() => { setDen(''); setLoi(null); }}
                  className="h-7 cursor-pointer rounded px-2 text-xs text-muted-foreground hover:bg-muted"
                >
                  Huỷ
                </button>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {den === 'pass'
                  ? 'Ảnh và lý do lỗi cũ GIỮ NGUYÊN để đối chiếu sau.'
                  : 'Chiếc sẽ bị rút khỏi tồn và chuyển sang hàng trả brand.'}
              </span>
            </>
          )}
          {loi && <span className="text-[11.5px] text-destructive">{loi}</span>}
        </span>
      )}
    </span>
  );
}
