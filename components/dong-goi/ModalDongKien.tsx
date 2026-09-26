'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { chiecCuaDon, vatTuDongGoi } from '@/features/dong-goi/queries';
import { dongKien, themAnhKien, xoaAnhKien, anhCuaKien, type AnhKien } from '@/features/dong-goi/actions';
import { chapNhanKieu, tenFileDan } from '@/features/kho-nhan/dan-anh';
import type { ChiecTrongDon, DonChoDong } from '@/features/dong-goi/queries';
import type { VatTuDongGoi } from '@/features/dong-goi/logic';

const so = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Đóng kiện cho MỘT đơn, hai bước:
 *  1. chọn chiếc, cân, kích thước, hộp → tạo kiện;
 *  2. kiện đã có → chụp/dán ảnh kiện đã đóng.
 *
 * Tách hai bước vì ảnh phải gắn vào MỘT kiện có thật; và đúng trình tự người
 * làm: đóng xong, dán băng, rồi mới chụp.
 */
export function ModalDongKien({ don, onDong, onXong }: {
  don: DonChoDong | null; onDong: () => void; onXong: () => void;
}) {
  return (
    <Dialog open={don !== null} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        {don && <NoiDung key={don.orderId} don={don} onXong={onXong} onDong={onDong} />}
      </DialogContent>
    </Dialog>
  );
}

function NoiDung({ don, onXong, onDong }: {
  don: DonChoDong; onXong: () => void; onDong: () => void;
}) {
  const [chiec, setChiec] = useState<ChiecTrongDon[] | null>(null);
  const [vatTu, setVatTu] = useState<VatTuDongGoi[]>([]);
  const [chon, setChon] = useState<Record<string, boolean>>({});
  const [can, setCan] = useState('');
  const [dai, setDai] = useState(''); const [rong, setRong] = useState(''); const [cao, setCao] = useState('');
  const [hop, setHop] = useState('');
  const [dangLuu, setDangLuu] = useState(false);
  const [kienId, setKienId] = useState<string | null>(null);
  const [anh, setAnh] = useState<AnhKien[]>([]);
  const [dangTai, setDangTai] = useState(false);
  const vung = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let huy = false;
    void (async () => {
      const [c, v] = await Promise.all([chiecCuaDon(don.orderId), vatTuDongGoi(don.kho ?? undefined)]);
      if (huy) return;
      setChiec(c);
      setVatTu(v);
      // Mặc định tick HẾT: đóng cả đơn là việc thường, bỏ bớt mới là ngoại lệ.
      setChon(Object.fromEntries(c.map((x) => [x.lineId, true])));
    })();
    return () => { huy = true; };
  }, [don.orderId, don.kho]);

  const daChon = Object.entries(chon).filter(([, v]) => v).map(([k]) => k);

  const luu = async () => {
    setDangLuu(true);
    try {
      const r = await dongKien({
        orderId: don.orderId, lineIds: daChon,
        canKg: so(can), daiCm: so(dai), rongCm: so(rong), caoCm: so(cao),
        hopRecordId: hop || null,
        hopTen: vatTu.find((v) => v.recordId === hop)?.dinhDanh ?? null,
      });
      if (!r.ok || !r.kienId) { toast.error(r.loi ?? 'Đóng kiện thất bại.', { duration: 10000 }); return; }
      setKienId(r.kienId);
      toast.success(`Đã đóng kiện ${daChon.length} chiếc.`, { duration: 3000 });
      onXong();
    } catch (e) {
      console.error('[dong-goi] đóng kiện lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại.', { duration: 10000 });
    } finally {
      setDangLuu(false);
    }
  };

  const taiAnh = async (ds: File[]) => {
    if (!kienId || ds.length === 0) return;
    setDangTai(true);
    try {
      for (const f of ds) {
        const fd = new FormData();
        fd.set('kienId', kienId); fd.set('file', f);
        const r = await themAnhKien(fd);
        if (!r.ok) toast.error(`${f.name}: ${r.loi ?? 'lỗi'}`, { duration: 10000 });
      }
      setAnh(await anhCuaKien(kienId));
    } catch (e) {
      console.error('[dong-goi] tải ảnh kiện lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại.', { duration: 10000 });
    } finally {
      setDangTai(false);
    }
  };

  const dan = (e: React.ClipboardEvent) => {
    const tho = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file').map((i) => i.getAsFile())
      .filter((f): f is File => f !== null && chapNhanKieu(f.type));
    if (tho.length === 0) return;
    e.preventDefault();
    const luc = new Date();
    void taiAnh(tho.map((f, i) => new File([f], tenFileDan('kien', f.type, luc, i + 1), { type: f.type })));
  };

  const go = async (a: AnhKien) => {
    const r = await xoaAnhKien(a.id);
    if (!r.ok) { toast.error(r.loi ?? 'Gỡ ảnh thất bại.', { duration: 10000 }); return; }
    if (kienId) setAnh(await anhCuaKien(kienId));
  };

  return (
    <>
      <div className="flex shrink-0 items-baseline gap-3 border-b border-border px-5 py-3">
        <DialogTitle className="text-base font-semibold">Đóng kiện</DialogTitle>
        <span className="font-mono text-xs text-muted-foreground">{don.maDon}</span>
        <span className="text-xs text-muted-foreground">
          {don.store} · {don.nuoc ?? '—'} · kho {don.kho ?? '—'}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {kienId ? (
          <>
            <p className="rounded-lg border border-border px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              Đã đóng kiện. Giờ chụp hoặc dán ảnh kiện đã đóng.
            </p>
            <div
              ref={vung} tabIndex={0} autoFocus onPaste={dan}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const ds = Array.from(e.dataTransfer?.files ?? []).filter((f) => chapNhanKieu(f.type));
                if (ds.length === 0) return;
                e.preventDefault(); void taiAnh(ds);
              }}
              onClick={() => vung.current?.focus()}
              className="cursor-pointer rounded-lg border border-dashed border-border p-6 text-center focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-sm">
                Dán ảnh bằng <kbd className="rounded border border-border px-1">Ctrl/Cmd+V</kbd> — hoặc kéo thả file
              </p>
              <label className="mt-3 inline-block">
                <span className="sr-only">Chọn ảnh kiện</span>
                <input
                  type="file" multiple accept="image/*,.pdf" disabled={dangTai}
                  onChange={(e) => { const f = e.target.files; if (f?.length) void taiAnh(Array.from(f)); e.target.value = ''; }}
                  onClick={(e) => e.stopPropagation()}
                  className="block cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
                />
              </label>
            </div>
            {dangTai && <p className="text-sm text-muted-foreground">Đang tải…</p>}
            {anh.length > 0 && (
              <div className="grid grid-cols-4 gap-3">
                {anh.map((a) => (
                  <div key={a.id} className="space-y-1">
                    <a href={a.url ?? '#'} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh S3 ký hạn ngắn */}
                      <img src={a.url ?? ''} alt={a.tenFile ?? ''}
                           className="aspect-square w-full rounded-lg border border-border object-cover" />
                    </a>
                    <button type="button" onClick={() => void go(a)}
                      className="cursor-pointer text-xs text-muted-foreground hover:text-destructive">gỡ</button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <p className="mb-1.5 text-sm font-medium">Chiếc vào kiện</p>
              {chiec === null ? (
                <p className="text-sm text-muted-foreground">Đang tải…</p>
              ) : chiec.length === 0 ? (
                <p className="text-sm text-muted-foreground">Đơn này không còn chiếc nào sẵn sàng.</p>
              ) : (
                <ul className="space-y-1 rounded-lg border border-border p-2">
                  {chiec.map((c) => (
                    <li key={c.lineId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox" checked={!!chon[c.lineId]}
                        onChange={(e) => setChon((s) => ({ ...s, [c.lineId]: e.target.checked }))}
                        className="cursor-pointer"
                      />
                      <span className="flex-1 truncate">
                        {c.tenSanPham ?? c.sku}
                        {c.bienThe && <span className="text-muted-foreground"> · {c.bienThe}</span>}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{c.unitCode ?? ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Cân nặng (kg) *</span>
                <input value={can} onChange={(e) => setCan(e.target.value)} inputMode="decimal"
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
              </label>
              {([['Dài', dai, setDai], ['Rộng', rong, setRong], ['Cao', cao, setCao]] as const).map(([ten, v, set]) => (
                <label key={ten} className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{ten} (cm)</span>
                  <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal"
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
                </label>
              ))}
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Hộp / vật tư đóng gói</span>
              <select value={hop} onChange={(e) => setHop(e.target.value)}
                className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm">
                <option value="">— chưa chọn —</option>
                {vatTu.map((v) => <option key={v.recordId} value={v.recordId}>{v.dinhDanh}</option>)}
              </select>
              {vatTu.length === 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  Kho này chưa có vật tư đóng gói nào trong sổ Lark.
                </span>
              )}
            </label>
          </>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-3 border-t border-border p-4">
        {kienId ? (
          <Button type="button" size="lg" onClick={onDong}>Xong</Button>
        ) : (
          <>
            <Button type="button" variant="outline" size="lg" onClick={onDong}>Huỷ</Button>
            <Button type="button" size="lg" disabled={dangLuu || daChon.length === 0}
              onClick={() => void luu()}>
              {dangLuu ? 'Đang đóng…' : `Đóng kiện (${daChon.length} chiếc)`}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
