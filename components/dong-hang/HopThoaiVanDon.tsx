'use client';

import { useState, useTransition } from 'react';
import { Copy, Check, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { layKhoiVanDon, verifyDiaChiKien } from '@/features/dong-hang/actions';
import { vanBanKhoi, type Khoi, type O } from '@/features/dong-hang/van-don';

/**
 * Hộp thoại LÊN VẬN ĐƠN: gom đủ thông tin để dán sang form của hãng.
 *
 * Hệ thống KHÔNG tạo nhãn (D-691 giữ việc đó ở Ops) — hộp thoại này chỉ-đọc, mọi luật nằm ở
 * `features/dong-hang/van-don.ts` (thuần, có test) nên ở đây chỉ còn việc vẽ.
 */

/** Nút copy một ô hoặc cả khối. Đổi sang dấu tích 1,5 giây để người dùng biết đã copy. */
function NutCopy({ text, nhan, tat }: { text: string; nhan: string; tat: boolean }) {
  const [xong, setXong] = useState(false);
  return (
    <button
      type="button" disabled={tat || text === '' || text === '—'}
      aria-label={`Copy ${nhan}`}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setXong(true);
          setTimeout(() => setXong(false), 1500);
        }).catch(() => undefined);
      }}
      className="shrink-0 cursor-pointer rounded border border-border p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {xong ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function DongO({ o, tat }: { o: O; tat: boolean }) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-0">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{o.nhan}</span>
      <span className="min-w-0 flex-1 break-words text-[13px] font-medium">
        {o.giaTri ?? <span className="font-normal text-muted-foreground">—</span>}
        {o.vi && <span className="mt-0.5 block text-[11px] font-normal leading-snug text-muted-foreground">{o.vi}</span>}
      </span>
      {!o.chiDeXem && <NutCopy text={o.giaTri ?? ''} nhan={o.nhan} tat={tat} />}
    </div>
  );
}

/**
 * Hộp thoại TỰ GIỮ nút mở và tự nạp dữ liệu lúc bấm.
 *
 * Nạp trong HÀM XỬ LÝ SỰ KIỆN chứ không trong `useEffect`: React 19 chặn đặt state từ effect
 * (`react-hooks/set-state-in-effect`), và quan trọng hơn — lượt nạp này gọi Shopify, nên nó
 * phải xảy ra vì người dùng BẤM, không vì component vừa dựng xong.
 */
export function HopThoaiVanDon({
  shipmentId, maKien, coQuyenChon,
}: {
  shipmentId: string; maKien: string | null; coQuyenChon: boolean;
}) {
  const [mo, setMo] = useState(false);
  const [khoi, setKhoi] = useState<Khoi[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [daXacNhan, setDaXacNhan] = useState(false);
  const [pending, start] = useTransition();

  const nap = () => start(async () => {
    setLoi(null);
    const r = await layKhoiVanDon(shipmentId);
    if (r.ok) setKhoi(r.khoi); else setLoi(r.loi);
  });

  const verify = () => start(async () => {
    const r = await verifyDiaChiKien(shipmentId);
    if (!r.ok) { setLoi(r.loi ?? 'Verify thất bại'); return; }
    const lai = await layKhoiVanDon(shipmentId);
    if (lai.ok) setKhoi(lai.khoi);
  });

  return (
    <Dialog
      open={mo}
      onOpenChange={(o) => {
        setMo(o);
        if (o) nap(); else setDaXacNhan(false);
      }}
    >
      <DialogTrigger className="cursor-pointer whitespace-nowrap rounded-lg border border-border px-3 py-2 text-[13px] font-medium transition hover:border-foreground/40">
        Lên vận đơn
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] w-[95vw] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Lên vận đơn{maKien ? ` · ${maKien}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Copy từng ô sang form của hãng. Hệ thống không tạo nhãn — nhãn vẫn lên ở cổng hãng như cũ.
          </p>

          {loi && <p className="text-sm text-destructive">{loi}</p>}
          {!khoi && !loi && <p className="animate-pulse text-xs text-muted-foreground">Đang lấy thông tin…</p>}
          {khoi && pending && <p className="animate-pulse text-xs text-muted-foreground">Đang cập nhật…</p>}

          {khoi?.map((b) => {
            const chanDo = b.canhBao?.batXacNhan === true && !daXacNhan;
            const tat = b.chanCopy || chanDo;
            return (
              <section key={b.ten} className="space-y-1 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{b.ten}</h3>
                  <NutCopy text={vanBanKhoi(b)} nhan={`cả khối ${b.ten}`} tat={tat} />
                </div>

                {b.canhBao?.cau && (
                  <div className={`flex items-start gap-2 rounded-md p-2 text-xs ${
                    b.canhBao.muc === 'do'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  }`}>
                    {b.canhBao.muc === 'do'
                      ? <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                      : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
                    <div className="space-y-1">
                      <p>{b.canhBao.cau}</p>
                      {b.canhBao.batXacNhan && (
                        <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                          <input type="checkbox" checked={daXacNhan} onChange={(e) => setDaXacNhan(e.target.checked)} />
                          Tôi đã kiểm và vẫn lên vận đơn
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {b.chanCopy && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-2 text-xs">
                    <span>{b.lyDoChan}</span>
                    {b.ten === 'Người nhận' && coQuyenChon && (
                      <button
                        type="button" onClick={verify} disabled={pending}
                        className="shrink-0 cursor-pointer rounded-md bg-amber-500 px-2.5 py-1 font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-60"
                      >
                        {pending ? 'Đang verify…' : 'Verify ngay'}
                      </button>
                    )}
                  </div>
                )}

                <div>{b.o.map((o) => <DongO key={o.nhan} o={o} tat={tat} />)}</div>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
