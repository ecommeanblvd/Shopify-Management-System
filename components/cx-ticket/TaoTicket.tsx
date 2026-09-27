'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NHOM, BO_PHAN, nhanBoPhan } from '@/features/cx-ticket/phan-loai';
import { timDongDon } from '@/features/cx-ticket/queries';
import { taoTicket } from '@/features/cx-ticket/actions';
import type { DongDonGan } from '@/features/cx-ticket/types';

const TOI_THIEU = 2;
const DEBOUNCE_MS = 250;

/**
 * Form tạo ticket. Gắn dòng đơn là TUỲ CHỌN — đo Lark: 321/675 ticket (48%)
 * không gắn đơn nào, nên bắt buộc gắn là chặn gần nửa số ca thật.
 */
export function TaoTicket({
  boPhanMinh, toanQuyen, onXong,
}: { boPhanMinh: string | null; toanQuyen: boolean; onXong: () => void }) {
  const [tieuDe, setTieuDe] = useState('');
  const [nhom, setNhom] = useState(NHOM[0]!.ma);
  const [loai, setLoai] = useState(NHOM[0]!.loai[0]!.ma);
  const [boPhanNeu, setBoPhanNeu] = useState<string>(boPhanMinh ?? BO_PHAN[0].ma);
  const [nhan, setNhan] = useState<string[]>([]);
  const [ghiChu, setGhiChu] = useState('');
  const [maCs, setMaCs] = useState('');
  const [han, setHan] = useState('');
  const [email, setEmail] = useState('');
  const [dong, setDong] = useState<DongDonGan[]>([]);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const loaiCuaNhom = NHOM.find((n) => n.ma === nhom)?.loai ?? [];

  function toggleNhan(ma: string) {
    setNhan((cu) => (cu.includes(ma) ? cu.filter((x) => x !== ma) : [...cu, ma]));
  }

  function gui() {
    start(async () => {
      setLoi(null);
      const r = await taoTicket({
        tieuDe, nhom, loai, boPhanNeu, boPhanNhan: nhan,
        lineIds: dong.map((d) => d.lineId),
        khachEmail: email.trim() || null,
        maTicketCs: maCs.trim() || null,
        hanXuLy: han || null,
        ghiChuDau: ghiChu.trim() || null,
      });
      if (!r.ok) { setLoi(r.loi ?? 'Tạo ticket thất bại.'); return; }
      toast.success(`Đã tạo ticket ${r.ma}.`, { duration: 3000 });
      onXong();
    });
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Vấn đề là gì</span>
        <input
          value={tieuDe} onChange={(e) => setTieuDe(e.target.value)}
          placeholder="Ví dụ: khách hỏi bao giờ hàng đi, đơn quá 14 ngày chưa sản xuất"
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nhóm vấn đề</span>
          <select
            value={nhom}
            onChange={(e) => {
              const n = e.target.value;
              setNhom(n);
              setLoai(NHOM.find((x) => x.ma === n)!.loai[0]!.ma);
            }}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {NHOM.map((n) => <option key={n.ma} value={n.ma}>{n.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Loại</span>
          <select
            value={loai} onChange={(e) => setLoai(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {loaiCuaNhom.map((l) => <option key={l.ma} value={l.ma}>{l.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Bộ phận nêu</span>
          <select
            value={boPhanNeu} onChange={(e) => setBoPhanNeu(e.target.value)}
            disabled={!toanQuyen}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Hạn xử lý (tuỳ chọn)</span>
          <input
            type="date" value={han} onChange={(e) => setHan(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium">Gửi cho bộ phận</span>
        <div className="flex flex-wrap gap-2">
          {BO_PHAN.map((b) => (
            <button
              key={b.ma} type="button" onClick={() => toggleNhan(b.ma)}
              className={
                'cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors '
                + (nhan.includes(b.ma)
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input hover:bg-muted')
              }
            >
              {b.ten}
            </button>
          ))}
        </div>
      </div>

      <OGanDon dong={dong} onDoi={setDong} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email khách (tuỳ chọn)</span>
          <input
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Tự lấy từ đơn nếu đã gắn dòng đơn"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Số ticket Intercom (tuỳ chọn)</span>
          <input
            value={maCs} onChange={(e) => setMaCs(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Ghi chú mở đầu</span>
        <textarea
          value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={3}
          placeholder="Diễn biến, khách nói gì, cần bộ phận kia làm gì"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      <div className="flex items-center justify-end gap-3">
        {nhan.length > 0 && (
          <span className="text-xs text-muted-foreground">
            gửi cho {nhan.map(nhanBoPhan).join(', ')}
          </span>
        )}
        <Button type="button" size="lg" onClick={gui} disabled={pending}>
          {pending ? 'Đang tạo…' : 'Tạo ticket'}
        </Button>
      </div>
    </div>
  );
}

/** Ô tìm và gắn dòng đơn — nhiều dòng một ticket (62/675 ticket Lark gắn 2–7 dòng). */
function OGanDon({ dong, onDoi }: { dong: DongDonGan[]; onDoi: (d: DongDonGan[]) => void }) {
  const [q, setQ] = useState('');
  const [ds, setDs] = useState<DongDonGan[]>([]);
  const [dangTim, setDangTim] = useState(false);
  const [loiGoi, setLoiGoi] = useState<string | null>(null);
  const luotRef = useRef(0);

  useEffect(() => {
    const ky = q.trim();
    if (ky.length < TOI_THIEU) return;
    const luot = ++luotRef.current;
    const t = setTimeout(async () => {
      setDangTim(true);
      try {
        const r = await timDongDon(ky);
        if (luot !== luotRef.current) return;
        setDs(r);
        setLoiGoi(null);
      } catch (e) {
        if (luot !== luotRef.current) return;
        console.error('[cx-ticket] tìm dòng đơn lỗi:', e);
        setDs([]);
        setLoiGoi('Không gọi được máy chủ để tìm. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.');
      } finally {
        if (luot === luotRef.current) setDangTim(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const ky = q.trim();
  const daGan = new Set(dong.map((d) => d.lineId));
  const hienThi = ky.length < TOI_THIEU ? [] : ds.filter((d) => !daGan.has(d.lineId));

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">
        Đơn liên quan <span className="font-normal text-muted-foreground">— để trống được</span>
      </span>

      {dong.length > 0 && (
        <ul className="mb-2 space-y-1">
          {dong.map((d) => (
            <li key={d.lineId} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {d.maDon} · <span className="font-mono text-xs">{d.sku}</span>
                <span className="text-muted-foreground"> — {d.tenSanPham}{d.bienThe && ` / ${d.bienThe}`}</span>
              </span>
              <button
                type="button"
                onClick={() => onDoi(dong.filter((x) => x.lineId !== d.lineId))}
                className="shrink-0 cursor-pointer text-xs underline"
              >
                bỏ
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        value={q} onChange={(e) => { setQ(e.target.value); setLoiGoi(null); }}
        placeholder="Mã đơn, SKU, tên sản phẩm, email khách"
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
      />

      {loiGoi && <p className="mt-1 text-sm text-destructive">{loiGoi}</p>}

      {ky.length >= TOI_THIEU && !loiGoi && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border">
          {dangTim && hienThi.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Đang tìm…</p>
          ) : hienThi.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Không có dòng đơn nào khớp “{ky}”.</p>
          ) : (
            <ul>
              {hienThi.map((d) => (
                <li key={d.lineId} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => { onDoi([...dong, d]); setQ(''); setDs([]); }}
                    className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="block truncate">
                      {d.tenSanPham ?? d.sku}
                      {d.bienThe && <span className="text-muted-foreground"> — {d.bienThe}</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {d.maDon} · <span className="font-mono">{d.sku}</span>
                      {d.khachEmail && ` · ${d.khachEmail}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
