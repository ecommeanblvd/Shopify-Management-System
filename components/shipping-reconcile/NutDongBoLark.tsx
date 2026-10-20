'use client';

import { useTransition, useState } from 'react';
import { syncLarkPacksAction } from '@/features/lark/actions';

/**
 * Nút "Đồng bộ Lark" — tách khỏi `ReconcileTable` để lên hàng header cùng mấy nút kia
 * (CEO 20/10/2026: hàng nút riêng dưới bộ lọc là một hàng thừa, đẩy bảng xuống sâu hơn).
 *
 * Có `useTransition` RIÊNG, không dùng chung với bộ lọc của bảng nữa: trước đây nút bị
 * `disabled` cả khi người ta chỉ đang gõ ô tìm kiếm (cùng một transition), còn giờ nó chỉ
 * khoá đúng lúc đang kích hoạt đồng bộ — đó mới là lý do duy nhất phải khoá.
 */
export function NutDongBoLark() {
  const [dangChay, start] = useTransition();
  const [ketQua, setKetQua] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={dangChay}
        onClick={() => {
          setKetQua(null);
          start(async () => {
            try {
              const r = await syncLarkPacksAction();
              setKetQua(
                r.alreadyRunning
                  ? 'Đang chạy rồi — chờ chút.'
                  : 'Đã bắt đầu đồng bộ ở nền — bấm "Tính lại" sau ít phút để xem kết quả ở banner Lark.',
              );
            } catch (err) {
              setKetQua(err instanceof Error ? err.message : 'Lỗi đồng bộ');
            }
          });
        }}
        className="h-9 rounded border border-border px-3 text-sm hover:bg-muted disabled:opacity-40"
      >
        {dangChay ? 'Đang kích hoạt…' : 'Đồng bộ Lark'}
      </button>
      {/* `basis-full` → câu trả lời xuống DÒNG RIÊNG trong hàng header, chỉ khi có. Để nó
          nằm cạnh nút thì một câu dài sẽ bóp hết nhóm nút, mà câu này phải đọc được: nó là
          chỗ duy nhất nói "đã bắt đầu" hay "đang chạy rồi". */}
      {ketQua !== null && (
        <span className="basis-full text-left text-xs text-muted-foreground sm:text-right">{ketQua}</span>
      )}
    </>
  );
}
