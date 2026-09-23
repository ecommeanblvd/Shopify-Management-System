'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { timKiemBienThe, giaiMaQuetTaoDon } from '@/features/kol/tim-kiem';
import { ScanInput } from '@/components/ui/scan-input';
import type { KetQuaBienThe } from '@/features/kol/types';

/** Gõ dưới 2 ký tự không gọi tìm — khớp `DO_DAI_TU_KHOA_TOI_THIEU` phía server. */
const DO_DAI_TU_KHOA_TOI_THIEU = 2;
const DEBOUNCE_MS = 300;

/** Khoảng cách giữa dropdown và ô neo, và lề an toàn với mép viewport (px). */
const KHOANG_CACH_NEO = 4;
const LE_VIEWPORT = 8;
/** Rộng tối thiểu của dropdown — đủ chỗ cho "SKU — tên sản phẩm dài" + badge tồn. */
const RONG_TOI_THIEU = 320;
/** Cao tối thiểu dropdown được phép co lại còn — dưới mức này thà đổi hướng còn hơn co thêm. */
const CAO_TOI_THIEU = 140;

/**
 * Đặt lại vị trí `dd` (dropdown đã portal ra `document.body`) neo theo `anchor`
 * (ô input/nút "Mã hàng"), bằng `position: fixed` tính theo toạ độ VIEWPORT —
 * đúng đơn vị `getBoundingClientRect()` trả về, nên không cần cộng trừ theo
 * từng vùng cuộn cha. Ưu tiên mở XUỐNG dưới; hết chỗ (dòng hàng nằm cuối một
 * form dài trong dialog `overflow-y-auto`, hoặc viewport thấp) thì lật lên TRÊN
 * và luôn kẹp chiều cao vào đúng khoảng trống thật còn lại — dropdown không
 * bao giờ tự vẽ tràn ra ngoài màn hình, và không bị cha `overflow` nào cắt vì
 * nó không còn là con cháu DOM của cha đó nữa (đã portal ra `<body>`).
 */
function dinhViDropdown(anchor: HTMLElement, dd: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const khongGianDuoi = window.innerHeight - r.bottom - KHOANG_CACH_NEO - LE_VIEWPORT;
  const khongGianTren = r.top - KHOANG_CACH_NEO - LE_VIEWPORT;
  // Ưu tiên dưới trừ khi dưới không đủ CAO_TOI_THIEU mà trên rộng hơn hẳn.
  const moXuong = khongGianDuoi >= CAO_TOI_THIEU || khongGianDuoi >= khongGianTren;
  const caoToiDa = Math.max(CAO_TOI_THIEU, moXuong ? khongGianDuoi : khongGianTren);
  const rong = Math.max(r.width, RONG_TOI_THIEU);
  const trai = Math.min(Math.max(LE_VIEWPORT, r.left), window.innerWidth - rong - LE_VIEWPORT);

  dd.style.position = 'fixed';
  dd.style.left = `${trai}px`;
  dd.style.width = `${rong}px`;
  dd.style.maxHeight = `${caoToiDa}px`;
  if (moXuong) {
    dd.style.top = `${r.bottom + KHOANG_CACH_NEO}px`;
    dd.style.bottom = 'auto';
  } else {
    dd.style.top = 'auto';
    dd.style.bottom = `${window.innerHeight - r.top + KHOANG_CACH_NEO}px`;
  }
}

/**
 * Picker "Mã hàng": tìm theo SKU/tên sản phẩm (server-side, có giới hạn) hoặc
 * quét mã `V:`/`L:` — KHÔNG có ô gõ tay nhận thẳng giá trị. Chọn xong hiện lại
 * SKU + tên đã chọn, có nút "Đổi" để mở lại picker.
 *
 * Dropdown kết quả PORTAL ra `document.body` (không nằm lồng trong
 * `DialogContent`), neo bằng toạ độ tính tay theo `anchor` — modal
 * `ModalTaoDon` cuộn (`overflow-y-auto`) nên một dropdown nằm YÊN trong cây
 * DOM của dialog sẽ bị vùng cuộn đó cắt mất phần tràn ra ngoài khung nhìn của
 * nó khi dòng hàng nằm gần cuối form dài. Portal thoát khỏi vùng cắt đó hoàn
 * toàn; `dinhViDropdown` lo phần còn lại (lật hướng + kẹp chiều cao).
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
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  // Click ra ngoài đóng picker — "ngoài" nghĩa là ngoài CẢ ô neo LẪN dropdown đã portal
  // (dropdown không còn là con cháu DOM của boxRef nữa nên phải kiểm cả hai ref).
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      dongPicker();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Neo lại dropdown khi mở, và mỗi khi cuộn (kể cả cuộn vùng overflow-y-auto của dialog —
  // `capture: true` bắt sự kiện scroll của MỌI vùng cuộn cha, không chỉ window) hoặc đổi cỡ
  // viewport (xoay điện thoại, thu nhỏ cửa sổ). Không dùng setState: viết thẳng vào style của
  // node qua ref, tránh render lại trên mỗi lần cuộn. `useLayoutEffect` (không phải
  // `useEffect`): đặt vị trí TRƯỚC khi trình duyệt vẽ khung hình đầu, để dropdown không loé
  // lên một khung hình ở vị trí mặc định (đầu `document.body`) rồi mới nhảy vào đúng chỗ. An
  // toàn với SSR: nhánh này chỉ chạy khi `open === true`, mà `open` luôn `false` ở lần render
  // đầu (server lẫn client) — effect không bao giờ chạy trong lúc render trên server.
  useLayoutEffect(() => {
    if (!open) return;
    function capNhat() {
      if (boxRef.current && dropdownRef.current) dinhViDropdown(boxRef.current, dropdownRef.current);
    }
    capNhat();
    window.addEventListener('scroll', capNhat, true);
    window.addEventListener('resize', capNhat);
    return () => {
      window.removeEventListener('scroll', capNhat, true);
      window.removeEventListener('resize', capNhat);
    };
  }, [open]);

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

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="z-[60] flex flex-col space-y-2 overflow-y-auto rounded-md border bg-popover p-2 shadow-lg"
        >
          <input
            autoFocus
            className="block h-9 w-full shrink-0 rounded-md border border-input bg-background px-2 text-sm"
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
          <div className="shrink-0 border-t pt-2">
            <p className="mb-1 text-xs text-muted-foreground">Hoặc quét tem kho (V: / L:):</p>
            <ScanInput onQuet={onScan} placeholder="Quét mã…" autoFocus={false} />
            {loiQuet && <p className="mt-1 text-xs font-medium text-amber-600">{loiQuet}</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
