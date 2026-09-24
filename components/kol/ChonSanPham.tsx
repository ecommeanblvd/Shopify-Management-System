'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { timKiemBienThe, giaiMaQuetTaoDon } from '@/features/kol/tim-kiem';
import { soIdShopify } from '@/features/receiving/ma-tem';
import type { KetQuaBienThe } from '@/features/kol/types';

const DO_DAI_TOI_THIEU = 2;
const DEBOUNCE_MS = 200;

function tienVnd(v: number, tienTe: string | null): string {
  const so = new Intl.NumberFormat('vi-VN').format(Math.round(v));
  return tienTe && tienTe !== 'VND' ? `${so} ${tienTe}` : `${so} ₫`;
}

/**
 * Popup tìm sản phẩm cho modal tạo đơn xuất hàng (bản thiết kế 24/09).
 *
 * Nằm PHỦ LÊN modal (absolute inset-0) chứ không phải dropdown neo theo ô —
 * nhờ vậy không còn bài toán lật hướng / bị vùng cuộn của dialog cắt mất, thứ
 * mà bản dropdown cũ phải portal ra `document.body` mới giải được.
 *
 * Hai đường vào một kết quả: GÕ để tìm (bỏ dấu, khớp sku/tên/biến thể) và QUÉT
 * tem `V:`/`L:`. Máy quét hoạt động như bàn phím rồi gửi Enter, nên Enter phải
 * thử giải mã quét TRƯỚC khi lấy dòng đang chọn — quét là thêm luôn, không cần
 * bấm gì thêm. Hệ thống KHÔNG lưu mã vạch của brand nên ở đây không có dòng
 * barcode của brand; "barcode" ở đây là ID BIẾN THỂ Shopify — chính thứ tem `V:`
 * mã hoá, và là khoá định danh hệ thống đang chuyển sang dùng thay SKU vì SKU
 * của brand đổi liên tục (CEO 24/09). Gõ tay số đó cũng tìm ra, không chỉ quét.
 */
export function ChonSanPham({
  che_do, onChon, onDong,
}: {
  /** 'them' = thêm dòng mới · lineKey = thay sản phẩm cho đúng dòng đó. */
  che_do: 'them' | string;
  onChon: (bt: KetQuaBienThe) => void;
  onDong: () => void;
}) {
  const [q, setQ] = useState('');
  const [ds, setDs] = useState<KetQuaBienThe[]>([]);
  const [dangTim, setDangTim] = useState(false);
  const [iActive, setIActive] = useState(0);
  const [loiQuet, setLoiQuet] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Chặn kết quả của lượt gõ CŨ ghi đè lượt mới — gõ nhanh thì request về không theo thứ tự. */
  const luotRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const ky = q.trim();
    // Từ khoá quá ngắn: KHÔNG setState ở đây (gọi đồng bộ trong effect gây
    // render dây chuyền). Danh sách hiển thị là giá trị SUY RA bên dưới, nên
    // chỉ cần không gọi tìm là đủ.
    if (ky.length < DO_DAI_TOI_THIEU) return;
    const luot = ++luotRef.current;
    const t = setTimeout(async () => {
      setDangTim(true);
      try {
        const r = await timKiemBienThe(ky);
        if (luot !== luotRef.current) return;
        setDs(r); setIActive(0);
      } finally {
        if (luot === luotRef.current) setDangTim(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Cuộn dòng đang chọn vào tầm nhìn khi đi bằng phím.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${iActive}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [iActive]);

  const ky = q.trim();
  // SUY RA, không lưu: từ khoá ngắn lại thì kết quả cũ không được phép còn hiện.
  // Lưu vào state rồi xoá bằng setState trong effect sẽ gây render dây chuyền.
  const hienThi = ky.length < DO_DAI_TOI_THIEU ? [] : ds;

  const chon = useCallback((bt: KetQuaBienThe) => { onChon(bt); onDong(); }, [onChon, onDong]);

  async function onEnter() {
    setLoiQuet(null);
    const raw = q.trim();
    // Thử QUÉT trước: máy quét gõ mã rồi gửi Enter vào đúng ô này.
    if (raw) {
      const r = await giaiMaQuetTaoDon(raw);
      if (r.ok) { chon(r.bienThe); return; }
      // Chuỗi trông như tem mà giải không ra thì phải NÓI, không im lặng rơi
      // về dòng đang chọn — quét nhầm mà thêm đại là sai hàng.
      if (/^[A-Za-z]:/.test(raw) || /^WH-/i.test(raw)) { setLoiQuet(r.loi); return; }
    }
    const bt = hienThi[iActive];
    if (bt) chon(bt);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIActive((i) => Math.min(i + 1, Math.max(0, hienThi.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); void onEnter(); }
    else if (e.key === 'Escape') { e.preventDefault(); onDong(); }
  }

  return (
    <div
      className="absolute inset-0 z-20 rounded-2xl bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onDong(); }}
      role="presentation"
    >
      <div
        className="mx-auto mt-16 w-[640px] max-w-[calc(100%-48px)] overflow-hidden rounded-[14px] border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-label="Tìm sản phẩm"
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setLoiQuet(null); }}
            onKeyDown={onKeyDown}
            placeholder="Tên, SKU, ID sản phẩm — hoặc quét bằng máy"
            aria-label="Tìm sản phẩm theo tên, SKU, ID sản phẩm hoặc quét mã"
            className="h-[34px] min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </div>

        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5">
          {loiQuet && (
            <p className="px-3 py-2 text-[13px] text-danger">{loiQuet}</p>
          )}
          {ky.length < DO_DAI_TOI_THIEU ? (
            <p className="px-3 py-7 text-center text-[13px] text-muted">Gõ ít nhất {DO_DAI_TOI_THIEU} ký tự để tìm</p>
          ) : dangTim && hienThi.length === 0 ? (
            <p className="px-3 py-7 text-center text-[13px] text-muted">Đang tìm…</p>
          ) : hienThi.length === 0 ? (
            <p className="px-3 py-7 text-center text-[13px] text-muted">Không có sản phẩm khớp “{ky}”</p>
          ) : (
            hienThi.map((bt, i) => (
              <button
                key={bt.sku}
                type="button"
                data-i={i}
                onMouseEnter={() => setIActive(i)}
                onClick={() => chon(bt)}
                className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg px-3 py-2.5 text-left ${
                  i === iActive ? 'bg-primary/15' : ''
                }`}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[13px] font-semibold">{bt.sku}</span>
                  <span className="truncate text-[13px] text-muted">{bt.tenHang}</span>
                </span>
                <span className="shrink-0 text-right text-[12px] tabular-nums text-muted">
                  {bt.tonTheoKho.map((t) => `${t.kho} ${t.ton}`).join(' · ')}
                </span>
                <span className="col-span-2 flex items-baseline justify-between gap-3 text-[11px] text-muted">
                  <span className="truncate font-mono">{soIdShopify(bt.shopifyVariantId ?? '') ?? '—'}</span>
                  <span className="shrink-0">
                    {bt.giaVon == null ? 'Chưa có giá vốn' : `Giá vốn ${tienVnd(bt.giaVon, bt.giaVonTienTe)}`}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted">
          <span>↑↓ chọn · Enter thêm · Esc đóng</span>
          <span>{che_do === 'them' ? 'Thêm dòng mới' : 'Đang thay sản phẩm cho dòng này'}</span>
        </div>
      </div>
    </div>
  );
}
