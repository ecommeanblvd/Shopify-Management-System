'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { timKiemBienThe, giaiMaQuetTaoDon } from '@/features/kol/tim-kiem';
import { ScanInput } from '@/components/ui/scan-input';
import type { KetQuaBienThe } from '@/features/kol/types';

/** Gõ dưới 2 ký tự không gọi tìm — khớp `DO_DAI_TU_KHOA_TOI_THIEU` phía server. */
const DO_DAI_TU_KHOA_TOI_THIEU = 2;
const DEBOUNCE_MS = 300;

/**
 * Picker "Mã hàng": tìm theo SKU/tên sản phẩm (server-side, có giới hạn) hoặc
 * quét mã `V:`/`L:` — KHÔNG có ô gõ tay nhận thẳng giá trị. Chọn xong hiện lại
 * SKU + tên đã chọn, có nút "Đổi" để mở lại picker.
 */
export function MaHangPicker({
  sku, tenHang, onChon,
}: {
  sku: string;
  tenHang: string;
  onChon: (bt: KetQuaBienThe) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [ketQua, setKetQua] = useState<KetQuaBienThe[]>([]);
  const [dangTim, setDangTim] = useState(false);
  const [loiQuet, setLoiQuet] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Đóng picker VÀ huỷ luôn lượt tìm/quét dở dang — mở lại (đổi mã hàng) là một lượt sạch.
   *  Làm trực tiếp tại nơi đóng (không phải trong effect theo dõi `open`): mọi lượt đóng đều
   *  đi qua đúng hàm này nên không cần đồng bộ ngược lại từ state `open`. */
  function dongPicker() {
    if (debRef.current) clearTimeout(debRef.current);
    setOpen(false);
    setQ('');
    setKetQua([]);
    setDangTim(false);
    setLoiQuet(null);
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) dongPicker();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function onQueryChange(v: string) {
    setQ(v);
    setLoiQuet(null);
    if (debRef.current) clearTimeout(debRef.current);
    const tuKhoa = v.trim();
    if (tuKhoa.length < DO_DAI_TU_KHOA_TOI_THIEU) {
      setKetQua([]);
      setDangTim(false);
      return;
    }
    setDangTim(true);
    debRef.current = setTimeout(() => {
      startTransition(async () => {
        const r = await timKiemBienThe(tuKhoa);
        setKetQua(r);
        setDangTim(false);
      });
    }, DEBOUNCE_MS);
  }

  function pick(bt: KetQuaBienThe) {
    onChon(bt);
    dongPicker();
  }

  function onScan(raw: string) {
    setLoiQuet(null);
    startTransition(async () => {
      const r = await giaiMaQuetTaoDon(raw);
      if (r.ok) pick(r.bienThe);
      else setLoiQuet(r.loi);
    });
  }

  return (
    <div ref={boxRef} className="relative">
      {sku ? (
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-muted/30 px-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{sku}</span>
            {tenHang ? <span className="text-muted-foreground"> — {tenHang}</span> : null}
          </span>
          <button type="button" className="shrink-0 cursor-pointer text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => setOpen(true)}>
            Đổi
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full cursor-pointer items-center rounded-md border border-input bg-background px-2 text-left text-sm text-muted-foreground hover:bg-muted"
        >
          Tìm hoặc quét mã hàng…
        </button>
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-80 max-w-[min(90vw,24rem)] space-y-2 rounded-md border bg-popover p-2 shadow-lg">
          <input
            autoFocus
            className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            placeholder="Gõ để tìm SKU hoặc tên sản phẩm…"
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          <div className="max-h-52 overflow-auto rounded border">
            {dangTim ? (
              <p className="p-2 text-xs text-muted-foreground">Đang tìm…</p>
            ) : q.trim().length < DO_DAI_TU_KHOA_TOI_THIEU ? (
              <p className="p-2 text-xs text-muted-foreground">Gõ ít nhất {DO_DAI_TU_KHOA_TOI_THIEU} ký tự để tìm.</p>
            ) : ketQua.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">Không tìm thấy mã hàng nào khớp &quot;{q.trim()}&quot;.</p>
            ) : (
              ketQua.map((r) => (
                <button
                  key={r.sku}
                  type="button"
                  onClick={() => pick(r)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{r.sku}</span>
                    <span className="text-muted-foreground"> — {r.tenHang}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                      r.ton > 0
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                  >
                    Tồn {r.ton}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t pt-2">
            <p className="mb-1 text-xs text-muted-foreground">Hoặc quét tem kho (V: / L:):</p>
            <ScanInput onQuet={onScan} placeholder="Quét mã…" autoFocus={false} />
            {loiQuet && <p className="mt-1 text-xs font-medium text-amber-600">{loiQuet}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
