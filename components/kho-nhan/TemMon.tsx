'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
// Subpath 'bwip-js/browser' (không phải '.') — export gốc chỉ khai 'types' dưới điều kiện
// 'browser', mà tsc không tự bật điều kiện đó nên "." không tra được kiểu (build 23/09/2026).
import bwipjs from 'bwip-js/browser';
import { danhDauDaInTem } from '@/features/kho-nhan/tem-actions';

export interface MonTem {
  dinhDanh: string;
  /**
   * Mã in vào mã vạch — null khi món CHƯA nối được với dòng đơn Shopify (không có mã kho tự
   * cấp lẫn dòng đơn để dùng — xem `features/kho-nhan/noi-mon-dong-don.ts`). KHÔNG được bịa
   * mã: món này bị loại khỏi lượt in bên dưới, nhưng liệt kê rõ để kho biết đang thiếu tem.
   */
  maTem: string | null;
  sku: string | null;
  ten: string | null;
}

type MonInDuoc = MonTem & { maTem: string };

/**
 * Lưới tem cho món của một đơn (spec §5 "In tem"): mỗi tem = mã vạch (QR, vẽ bằng canvas phía
 * trình duyệt — trang in không gọi API) + phần chữ người đọc được, để mã mờ hay mất mạng thì
 * mắt người vẫn đọc ra đúng món. `.khong-in` ẩn mọi thứ ngoài tem khi in (window.print()).
 */
export function TemMon({ donTran, kho, mon, soHuyBoQua }: {
  /** Mã đơn người đọc (không có '#'), in đậm trên mỗi tem. */
  donTran: string;
  /** Kho đang chọn trên màn Nhận & KCS lúc mở trang in — không có nguồn nào khác lưu theo món. */
  kho: string;
  mon: MonTem[];
  /** Số món đã huỷ bị loại khỏi lượt in (đã huỷ thì không nhận vào kho, không cần tem). */
  soHuyBoQua: number;
}) {
  const inDuoc = mon.filter((m): m is MonInDuoc => !!m.maTem);
  const khongMa = mon.filter((m) => !m.maTem);

  const [dangGui, batDau] = useTransition();
  const [ketQua, setKetQua] = useState<{ da: number } | { loi: string } | null>(null);

  function danhDauDaXong() {
    setKetQua(null);
    batDau(async () => {
      try {
        setKetQua(await danhDauDaInTem(inDuoc.map((m) => m.dinhDanh)));
      } catch {
        setKetQua({ loi: 'Không đánh dấu được — kiểm mạng rồi bấm lại.' });
      }
    });
  }

  return (
    <div>
      <style>{`
        @media print { .khong-in { display: none !important; } }
        @page { size: 50mm 30mm; margin: 0; }
        .tem-grid { display: block; padding: 0; margin: 0; }
        .tem {
          width: 50mm; height: 30mm; padding: 2mm; box-sizing: border-box;
          display: flex; gap: 2mm; align-items: center; overflow: hidden;
          border: 0.2mm dashed #bbb; page-break-after: always;
        }
        .tem:last-child { page-break-after: auto; }
        .tem canvas { width: 22mm !important; height: 22mm !important; flex: none; }
        .tem .chu { min-width: 0; }
        .tem .don { font: 700 9pt/1.2 system-ui, sans-serif; }
        .tem .sku { font: 600 8pt/1.25 ui-monospace, monospace; }
        .tem .ten {
          font: 400 7.5pt/1.25 system-ui, sans-serif; margin-top: 0.5mm;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .tem .kho { font: 400 7pt/1.2 system-ui, sans-serif; color: #555; margin-top: 0.5mm; }
      `}</style>

      <div className="khong-in flex flex-wrap items-center gap-3 p-4">
        <button
          type="button" onClick={() => window.print()} disabled={inDuoc.length === 0}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          In {inDuoc.length} tem
        </button>
        <button
          type="button" onClick={danhDauDaXong} disabled={dangGui || inDuoc.length === 0}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-40"
        >
          {dangGui ? 'Đang đánh dấu…' : 'Xong — đã dán tem'}
        </button>
        {ketQua && 'da' in ketQua && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">Đã đánh dấu {ketQua.da} món là đã in tem.</span>
        )}
        {ketQua && 'loi' in ketQua && <span className="text-sm text-red-600 dark:text-red-400">{ketQua.loi}</span>}
      </div>

      {(khongMa.length > 0 || soHuyBoQua > 0) && (
        <div className="khong-in mx-4 mb-4 space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {khongMa.length > 0 && (
            <div>
              <p>{khongMa.length} món CHƯA có mã tem (chưa nối được với dòng đơn Shopify) — không in được, không nằm trong lượt in này:</p>
              <ul className="ml-4 list-disc">
                {khongMa.map((m) => <li key={m.dinhDanh}>{m.sku ?? '—'} — {m.ten ?? '—'}</li>)}
              </ul>
            </div>
          )}
          {soHuyBoQua > 0 && <p>{soHuyBoQua} món đã huỷ không in tem.</p>}
          {inDuoc.length === 0 && khongMa.length === 0 && <p>Không có món nào để in.</p>}
        </div>
      )}

      <div className="tem-grid">
        {inDuoc.map((m) => <MotTem key={m.dinhDanh} m={m} donTran={donTran} kho={kho} />)}
      </div>
    </div>
  );
}

function MotTem({ m, donTran, kho }: { m: MonInDuoc; donTran: string; kho: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      bwipjs.toCanvas(canvasRef.current, { bcid: 'qrcode', text: m.maTem, scale: 3, includetext: false });
    } catch {
      // Vẽ hỏng thì để canvas trống — phần chữ bên phải vẫn đọc được bằng mắt (spec §5).
    }
  }, [m.maTem]);
  return (
    <div className="tem">
      <canvas ref={canvasRef} aria-label={m.maTem} />
      <div className="chu">
        <div className="don">#{donTran}</div>
        <div className="sku">{m.sku ?? '—'}</div>
        <div className="ten">{m.ten ?? '—'}</div>
        <div className="kho">{kho}</div>
      </div>
    </div>
  );
}
