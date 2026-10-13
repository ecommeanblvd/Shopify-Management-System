'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Copy, RotateCcw, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { layKhoiVanDon, verifyDiaChiKien } from '@/features/dong-hang/actions';
import {
  cauDaCopy, copyCaMuc, coTheCopy, khoaO, oChiDoc, tienDo, tienDoKhoi,
  type Khoi, type MauKhoi, type O,
} from '@/features/dong-hang/van-don';
import { HopThoaiXacNhanVanDon } from './HopThoaiXacNhanVanDon';

/**
 * Hộp thoại LÊN VẬN ĐƠN: gom đủ thông tin để dán sang form của hãng, theo bộ bàn giao thiết
 * kế 13/10/2026 (`~/Downloads/design_handoff_shipping_label_modal`).
 *
 * Hệ thống KHÔNG tạo nhãn (D-691 giữ việc đó ở Ops) — hộp thoại này chỉ-đọc, mọi luật nằm ở
 * `features/dong-hang/van-don.ts` (thuần, có test) nên ở đây chỉ còn việc vẽ.
 *
 * Hai chủ đích của thiết kế, giữ nguyên khi chuyển sang stack của repo:
 *   1. ÍT PHẢI CUỘN — hộp thoại rộng 1180px, hai cột, mỗi mục một hình riêng.
 *   2. KHÔNG COPY LẪN Ô — bốn mục bốn sắc, ô đã copy đổi nền và đổi dấu sang dấu tích.
 *
 * Màu: bộ bàn giao cho sẵn thang `oklch` của GIAO DIỆN TỐI. Repo này chạy cả sáng lẫn tối nên
 * dịch sang thang màu Tailwind có biến thể `dark:` (lam/hổ phách/lục/tím — đúng bốn sắc của
 * thiết kế) chứ không dán nguyên số oklch: dán nguyên là mục nào cũng tối đen giữa giao diện
 * sáng, chữ chìm vào nền.
 */

/** Lớp CSS theo sắc của khối. Phải khai bằng chuỗi HẰNG (không ghép `bg-${mau}-50`): Tailwind
 *  quét mã nguồn để sinh CSS, tên lớp ghép lúc chạy không có trong bản dựng. */
const MAU: Record<MauKhoi, {
  the: string; dau: string; huy: string; nhan: string; nut: string;
  hang: string; daCopy: string; vienO: string; dauTich: string;
}> = {
  lam: {
    the: 'border-blue-300 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/40',
    dau: 'bg-blue-100/80 dark:bg-blue-900/40',
    huy: 'bg-blue-600 text-white dark:bg-blue-400 dark:text-blue-950',
    nhan: 'text-blue-700 dark:text-blue-300',
    nut: 'border-blue-400 text-blue-800 hover:bg-blue-200/70 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900/70',
    hang: 'hover:bg-blue-100 dark:hover:bg-blue-900/50 focus-visible:ring-blue-500/60',
    daCopy: 'bg-blue-200/60 dark:bg-blue-900/60',
    vienO: 'border-blue-200 dark:border-blue-900',
    dauTich: 'text-blue-700 dark:text-blue-300',
  },
  hoPhach: {
    the: 'border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/40',
    dau: 'bg-amber-100/80 dark:bg-amber-900/40',
    huy: 'bg-amber-600 text-white dark:bg-amber-400 dark:text-amber-950',
    nhan: 'text-amber-800 dark:text-amber-300',
    nut: 'border-amber-400 text-amber-900 hover:bg-amber-200/70 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/70',
    hang: 'hover:bg-amber-100 dark:hover:bg-amber-900/50 focus-visible:ring-amber-500/60',
    daCopy: 'bg-amber-200/60 dark:bg-amber-900/60',
    vienO: 'border-amber-200 dark:border-amber-900',
    dauTich: 'text-amber-800 dark:text-amber-300',
  },
  luc: {
    the: 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/40',
    dau: 'bg-emerald-100/80 dark:bg-emerald-900/40',
    huy: 'bg-emerald-600 text-white dark:bg-emerald-400 dark:text-emerald-950',
    nhan: 'text-emerald-800 dark:text-emerald-300',
    nut: 'border-emerald-400 text-emerald-900 hover:bg-emerald-200/70 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/70',
    hang: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/50 focus-visible:ring-emerald-500/60',
    daCopy: 'bg-emerald-200/60 dark:bg-emerald-900/60',
    vienO: 'border-emerald-200 dark:border-emerald-900',
    dauTich: 'text-emerald-800 dark:text-emerald-300',
  },
  tim: {
    the: 'border-violet-300 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/40',
    dau: 'bg-violet-100/80 dark:bg-violet-900/40',
    huy: 'bg-violet-600 text-white dark:bg-violet-400 dark:text-violet-950',
    nhan: 'text-violet-800 dark:text-violet-300',
    nut: 'border-violet-400 text-violet-900 hover:bg-violet-200/70 dark:border-violet-700 dark:text-violet-200 dark:hover:bg-violet-900/70',
    hang: 'hover:bg-violet-100 dark:hover:bg-violet-900/50 focus-visible:ring-violet-500/60',
    daCopy: 'bg-violet-200/60 dark:bg-violet-900/60',
    vienO: 'border-violet-200 dark:border-violet-900',
    dauTich: 'text-violet-800 dark:text-violet-300',
  },
};

/**
 * Ghi vào bảng nhớ tạm. `navigator.clipboard` hỏng (http không phải localhost, quyền bị
 * chặn) thì rơi về `execCommand('copy')` — mất đường copy là hộp thoại này mất lý do tồn tại.
 */
async function ghiBangNho(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const VIEN_NUT = 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

/** Dấu bên phải mỗi ô: dấu tích khi đã copy, hình hai tờ giấy khi chưa. */
function DauCopy({ daCopy, mau, mo }: { daCopy: boolean; mau: MauKhoi; mo: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
        daCopy ? MAU[mau].daCopy : 'bg-foreground/5'
      } ${MAU[mau].dauTich} ${mo ? 'opacity-30' : ''}`}
    >
      {daCopy ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </span>
  );
}

/** Một hàng nhãn–giá trị (mục 1). Cả hàng là nút: thiết kế cho bấm ở bất kỳ đâu trên hàng. */
function HangO({
  o, mau, daCopy, tat, onCopy,
}: { o: O; mau: MauKhoi; daCopy: boolean; tat: boolean; onCopy: () => void }) {
  const trong = !coTheCopy(o);
  const noiDung = (
    <>
      <span className={`text-left text-[11.5px] ${MAU[mau].nhan}`}>{o.nhanNgan ?? o.nhan}</span>
      <span className="flex min-w-0 flex-col gap-px text-left">
        <span className={`text-[13.5px] font-medium break-words ${
          trong ? 'text-muted-foreground' : daCopy ? 'opacity-70' : ''
        } ${o.donCach ? 'font-mono' : ''}`}>
          {o.giaTri ?? '—'}
        </span>
        {o.vi && <span className="text-[11px] leading-snug text-muted-foreground">{o.vi}</span>}
      </span>
      <DauCopy daCopy={daCopy} mau={mau} mo={trong} />
    </>
  );
  const khung = 'grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1 min-h-9';
  if (trong || tat) {
    return <div className={`${khung} ${trong ? '' : 'opacity-60'}`}>{noiDung}</div>;
  }
  return (
    <button
      type="button" onClick={onCopy} aria-pressed={daCopy}
      title={`Copy ${o.nhan}`}
      className={`${khung} ${VIEN_NUT} transition ${MAU[mau].hang} ${daCopy ? MAU[mau].daCopy : ''}`}
    >
      {noiDung}
    </button>
  );
}

/** Một ô vuông (mục 2) — nhãn nhỏ phía trên, số to phía dưới, dấu copy ở góc. */
function OVuong({
  o, mau, daCopy, tat, onCopy,
}: { o: O; mau: MauKhoi; daCopy: boolean; tat: boolean; onCopy: () => void }) {
  const trong = !coTheCopy(o);
  const noiDung = (
    <>
      <span className={`truncate text-left text-[11px] ${MAU[mau].nhan}`}>{o.nhanNgan ?? o.nhan}</span>
      <span className={`text-left text-[15px] font-semibold ${
        trong ? 'text-muted-foreground' : daCopy ? 'opacity-70' : ''
      }`}>
        {o.giaTri ?? '—'}
      </span>
      <span className="absolute right-1.5 bottom-1.5">
        <DauCopy daCopy={daCopy} mau={mau} mo={trong} />
      </span>
    </>
  );
  const khung = `relative flex min-h-[58px] flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 pr-8 ${MAU[mau].vienO}`;
  if (trong || tat) {
    return <div className={`${khung} ${trong ? '' : 'opacity-60'}`}>{noiDung}</div>;
  }
  return (
    <button
      type="button" onClick={onCopy} aria-pressed={daCopy}
      title={`Copy ${o.nhan}`}
      className={`${khung} ${VIEN_NUT} transition ${MAU[mau].hang} ${daCopy ? MAU[mau].daCopy : ''}`}
    >
      {noiDung}
    </button>
  );
}

/** Băng cảnh báo của khối (địa chỉ cờ đỏ, đơn nhiều kiện). */
function BangCanhBao({
  canhBao, daXacNhan, doiXacNhan,
}: {
  canhBao: NonNullable<Khoi['canhBao']>;
  daXacNhan: boolean; doiXacNhan: (v: boolean) => void;
}) {
  if (!canhBao.cau) return null;
  return (
    <div className={`mx-2 flex items-start gap-2 rounded-md p-2 text-[11.5px] ${
      canhBao.muc === 'do'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
    }`}>
      {canhBao.muc === 'do'
        ? <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
      <div className="space-y-1">
        <p>{canhBao.cau}</p>
        {canhBao.batXacNhan && (
          <label className="flex cursor-pointer items-center gap-1.5 font-medium">
            <input
              type="checkbox" checked={daXacNhan}
              onChange={(e) => doiXacNhan(e.target.checked)}
              className="cursor-pointer"
            />
            Tôi đã kiểm và vẫn lên vận đơn
          </label>
        )}
      </div>
    </div>
  );
}

/** Một mục của hộp thoại — tiêu đề có số + sắc riêng, thân vẽ theo `khoi.hinh`. */
function MucVanDon({
  khoi, daCopy, tat, onCopyO, onCopyMuc, canhBaoSlot,
}: {
  khoi: Khoi; daCopy: ReadonlySet<string>; tat: boolean;
  onCopyO: (o: O) => void; onCopyMuc: () => void; canhBaoSlot?: React.ReactNode;
}) {
  const m = MAU[khoi.mau];
  const td = tienDoKhoi(khoi, daCopy);
  const chiDoc = oChiDoc(khoi);
  const daKhoa = (o: O) => daCopy.has(khoaO(khoi.ten, o.nhan));

  return (
    <section className={`flex flex-col overflow-hidden rounded-xl border ${m.the} ${
      khoi.hinh === 'mon' ? 'flex-1' : ''
    }`}>
      <div className={`flex flex-wrap items-center gap-2 px-3 py-2 ${m.dau}`}>
        <span className={`flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${m.huy}`}>
          {khoi.so}
        </span>
        <h3 className={`text-[13px] font-semibold ${m.nhan}`}>{khoi.ten}</h3>
        <span className="text-[11px] text-muted-foreground">
          {khoi.hinh === 'chi-doc' ? 'gõ tay bên cổng hãng' : `${td.xong}/${td.tong}`}
        </span>
        {td.tong > 0 && (
          <button
            type="button" onClick={onCopyMuc} disabled={tat}
            className={`ml-auto h-6 rounded-md border px-2 text-[11px] font-medium transition ${m.nut} ${VIEN_NUT}`}
          >
            Copy cả mục
          </button>
        )}
      </div>

      {canhBaoSlot}
      {khoi.chanCopy && khoi.lyDoChan && (
        <p className="mx-2 mt-2 rounded-md bg-muted px-2 py-1.5 text-[11.5px]">{khoi.lyDoChan}</p>
      )}

      {khoi.hinh === 'dong' && (
        <div className="flex flex-col p-1.5">
          {khoi.o.map((o) => (
            <HangO
              key={o.nhan} o={o} mau={khoi.mau} daCopy={daKhoa(o)} tat={tat}
              onCopy={() => onCopyO(o)}
            />
          ))}
        </div>
      )}

      {khoi.hinh === 'o-vuong' && (
        <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-5">
          {khoi.o.filter((o) => o.chiDeXem !== true).map((o) => (
            <OVuong
              key={o.nhan} o={o} mau={khoi.mau} daCopy={daKhoa(o)} tat={tat}
              onCopy={() => onCopyO(o)}
            />
          ))}
        </div>
      )}

      {khoi.hinh === 'mon' && (
        <div className="flex flex-col gap-1.5 p-2">
          {khoi.mon?.map((mon) => (
            <div key={mon.thuTu} className={`grid grid-cols-[22px_minmax(0,1fr)] gap-2 rounded-lg border p-1 ${MAU[khoi.mau].vienO}`}>
              <span className={`mt-1.5 flex size-[22px] items-center justify-center rounded-full border text-[11px] font-semibold ${MAU[khoi.mau].vienO} ${m.nhan}`}>
                {mon.thuTu}
              </span>
              <div className="flex min-w-0 flex-col">
                {mon.o.map((o) => (
                  <HangO
                    key={o.nhan} o={o} mau={khoi.mau} daCopy={daKhoa(o)} tat={tat}
                    onCopy={() => onCopyO(o)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {khoi.hinh === 'chi-doc' && (
        <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-5">
          {khoi.o.map((o) => (
            <div key={o.nhan} className={`flex flex-col gap-0.5 rounded-lg border border-dashed px-2.5 py-1.5 ${MAU[khoi.mau].vienO}`}>
              <span className={`text-[11px] ${m.nhan}`}>{o.nhan}</span>
              <span className="text-[13px] text-muted-foreground">{o.giaTri ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Dòng chỉ-đọc dưới thân khối (cân quy đổi) — KHÔNG copy được, chỉ để đối chiếu. */}
      {khoi.hinh !== 'chi-doc' && chiDoc.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 pb-2.5 text-[11.5px] text-muted-foreground">
          {chiDoc.map((o) => (
            <span key={o.nhan}>
              {o.nhan} <span className={`text-[12.5px] font-semibold ${m.nhan}`}>{o.giaTri ?? '—'}</span>
              {o.vi ? ` · ${o.vi}` : ''}
            </span>
          ))}
        </div>
      )}
    </section>
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
  shipmentId, maKien, coQuyenChon, coQuyenDong,
}: {
  shipmentId: string; maKien: string | null; coQuyenChon: boolean; coQuyenDong: boolean;
}) {
  const [mo, setMo] = useState(false);
  const [khoi, setKhoi] = useState<Khoi[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [daXacNhan, setDaXacNhan] = useState(false);
  const [daCopy, setDaCopy] = useState<ReadonlySet<string>>(new Set());
  const [moXacNhan, setMoXacNhan] = useState(false);
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

  /** Đánh dấu "đã copy" CHỈ KHI bảng nhớ tạm nhận thật: đánh dấu trước rồi copy hỏng là dấu
   *  tích nói dối, và người lên vận đơn bỏ qua ô đó tưởng đã dán xong. */
  const copy = (text: string, khoa: string[], cau: string) => {
    void ghiBangNho(text).then((ok) => {
      if (!ok) { toast.error('Trình duyệt không cho copy — bôi đen rồi copy tay.', { duration: 8000 }); return; }
      setDaCopy((truoc) => new Set([...truoc, ...khoa]));
      toast.success(cau, { duration: 1400 });
    });
  };

  const td = khoi ? tienDo(khoi, daCopy) : { xong: 0, tong: 0, phanTram: 0 };

  return (
    <>
      <Dialog
        open={mo}
        onOpenChange={(o) => {
          setMo(o);
          if (o) nap();
          // Đóng là hết một phiên: dấu "đã copy" và dấu xác nhận cảnh báo của kiện này không
          // được dính sang lượt mở sau (có thể là kiện khác).
          else { setDaXacNhan(false); setDaCopy(new Set()); }
        }}
      >
        <DialogTrigger className={`whitespace-nowrap rounded-lg border border-border px-3 py-2 text-[13px] font-medium transition hover:border-foreground/40 ${VIEN_NUT} focus-visible:ring-ring/60`}>
          Lên vận đơn
        </DialogTrigger>
        <DialogContent
          showCloseButton={false}
          className="top-8 flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]"
        >
          <DialogHeader className="flex shrink-0 flex-row flex-wrap items-center gap-3 border-b border-border px-5 pt-4 pb-3.5">
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
              <DialogTitle className="text-[15px] font-semibold">
                Lên vận đơn{maKien ? ` · ${maKien}` : ''}
              </DialogTitle>
              <DialogDescription className="text-[11.5px]">
                Copy từng ô sang form của hãng. Hệ thống không tạo nhãn — nhãn vẫn lên ở cổng hãng như cũ.
              </DialogDescription>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="flex flex-col items-end gap-1">
                <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">
                  Đã copy <span className="font-semibold text-foreground">{td.xong}</span>/{td.tong} ô
                </span>
                <div className="h-1 w-32 overflow-hidden rounded-full bg-foreground/15">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all dark:bg-emerald-400"
                    style={{ width: `${td.phanTram}%` }}
                  />
                </div>
              </div>
              <button
                type="button" onClick={() => setDaCopy(new Set())} disabled={td.xong === 0}
                className={`flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11.5px] transition hover:bg-muted ${VIEN_NUT} focus-visible:ring-ring/60`}
              >
                <RotateCcw className="size-3" /> Làm lại
              </button>
              <DialogClose
                aria-label="Đóng"
                className={`flex size-7 items-center justify-center rounded-lg border border-border transition hover:bg-muted ${VIEN_NUT} focus-visible:ring-ring/60`}
              >
                <X className="size-3.5" />
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
            {loi && <p className="text-sm text-destructive">{loi}</p>}
            {!khoi && !loi && <p className="animate-pulse text-xs text-muted-foreground">Đang lấy thông tin…</p>}
            {khoi && pending && <p className="mb-2 animate-pulse text-xs text-muted-foreground">Đang cập nhật…</p>}

            {khoi && (
              <div className="grid gap-3.5 lg:grid-cols-2">
                {/* Cột phải gộp mục 2 + mục 3 để hai cột kết thúc ngang nhau (thiết kế). */}
                {[0, 1].map((cot) => (
                  <div key={cot} className="flex min-w-0 flex-col gap-3.5">
                    {(cot === 0 ? khoi.slice(0, 1) : khoi.slice(1, 3)).map((b) => {
                      const chanDo = b.canhBao?.batXacNhan === true && !daXacNhan;
                      const tat = b.chanCopy || chanDo;
                      return (
                        <MucVanDon
                          key={b.ten} khoi={b} daCopy={daCopy} tat={tat}
                          onCopyO={(o) => copy(o.giaTri ?? '', [khoaO(b.ten, o.nhan)], cauDaCopy(o))}
                          onCopyMuc={() => {
                            const { text, khoa } = copyCaMuc(b);
                            copy(text, khoa, `${b.ten}: ${khoa.length} ô`);
                          }}
                          canhBaoSlot={
                            <>
                              {b.canhBao && (
                                <BangCanhBao
                                  canhBao={b.canhBao} daXacNhan={daXacNhan} doiXacNhan={setDaXacNhan}
                                />
                              )}
                              {b.chanCopy && b.ten === 'Người nhận' && coQuyenChon && (
                                <div className="mx-2 mt-2">
                                  <button
                                    type="button" onClick={verify} disabled={pending}
                                    className={`rounded-md bg-amber-500 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 transition hover:bg-amber-400 ${VIEN_NUT} focus-visible:ring-amber-600/60`}
                                  >
                                    {pending ? 'Đang verify…' : 'Verify ngay'}
                                  </button>
                                </div>
                              )}
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                ))}

                {/* Mục 4 chạy hết chiều ngang: năm ô đều phải gõ tay nên quét một lượt là xong. */}
                <div className="lg:col-span-2">
                  {khoi[3] && (
                    <MucVanDon
                      khoi={khoi[3]} daCopy={daCopy} tat
                      onCopyO={() => undefined} onCopyMuc={() => undefined}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Thanh nút NỔI: dính đáy hộp thoại, nền mờ để không che mất hàng cuối đang cuộn. */}
          <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-popover/95 px-5 py-3 backdrop-blur">
            <DialogClose
              className={`rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium transition hover:bg-muted ${VIEN_NUT} focus-visible:ring-ring/60`}
            >
              Đóng/Huỷ
            </DialogClose>
            <button
              type="button"
              disabled={!coQuyenDong}
              title={coQuyenDong ? undefined : 'Cần quyền quản lý đóng hàng để nhập mã vận đơn'}
              onClick={() => { setMo(false); setMoXacNhan(true); }}
              className={`rounded-lg bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-500 ${VIEN_NUT} focus-visible:ring-emerald-500/60 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400`}
            >
              Tạo vận đơn thành công
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hộp thoại THỨ HAI, dựng SONG SONG chứ không lồng trong hộp thoại trên: lồng vào thì
          nó rụng theo lúc hộp thoại cha đóng, mang theo cả bảng xem trước đang hiện. */}
      <HopThoaiXacNhanVanDon shipmentId={shipmentId} maKien={maKien} mo={moXacNhan} doiMo={setMoXacNhan} />
    </>
  );
}
