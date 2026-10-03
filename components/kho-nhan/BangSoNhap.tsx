'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CircleAlertIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dichNgay } from '@/lib/timezone';
import { NutBoSungFile } from './NutBoSungFile';
import { nhanKho } from '@/features/warehouse/ten-kho';
import { mauKho, mauLoaiNhap } from '@/features/kho-nhan/mau-nhan';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import {
  tachTenBienThe, nhomQc, nhomKho, danhDauNoiTiep, tenBrand,
} from '@/features/kho-nhan/dong-so-nhap';
import { doiChieuNgay } from '@/features/kho-nhan/doi-chieu';
import type { KetQuaDoiChieu } from '@/features/kho-nhan/doi-chieu-logic';
import { coLech } from '@/features/kho-nhan/doi-chieu-logic';
import type { DongSoNhap } from '@/features/kho-nhan/types';
import { LichNgay } from './LichNgay';
import { OAnhLark } from './OAnhLark';
import { COT_SO_NHAP, LUOI_SO_NHAP, RONG_TOI_THIEU } from '@/features/kho-nhan/cot-so-nhap';

const THU = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const GIAI_THICH = 'Sổ ghi mọi chiếc đã nhận, dựng theo đúng hình bảng Lark WH - Inventory. '
  + 'Nút đối chiếu chỉ ĐỌC hai bên và chỉ ra chỗ lệch — không tự sửa bên nào.';

const MAU_QC: Record<string, string> = {
  dat: 'bg-emerald-500', hong: 'bg-red-500', cho: 'bg-amber-500',
  du: 'bg-sky-500', khac: 'bg-muted-foreground',
};
const CHU_QC: Record<string, string> = {
  dat: 'text-foreground', hong: 'text-red-600 dark:text-red-400',
  cho: 'text-amber-600 dark:text-amber-400', du: 'text-sky-600 dark:text-sky-400',
  khac: 'text-muted-foreground',
};
const CHU_KHO: Record<string, string> = {
  luu: 'text-sky-600 dark:text-sky-400', tam: 'text-muted-foreground',
  cho: 'text-amber-600 dark:text-amber-400', tra: 'text-violet-600 dark:text-violet-400',
  khac: 'text-muted-foreground',
};


function ngayVn(s: string): string {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function BangSoNhap({
  dong, kho, ngay, homNay, cacNgay, capNhatLuc,
}: {
  dong: DongSoNhap[]; kho: string; ngay: string; homNay: string;
  cacNgay: string[]; capNhatLuc: Date | null;
}) {
  const router = useRouter();
  const [ket, setKet] = useState<KetQuaDoiChieu | null>(null);
  const [dangSoi, setDangSoi] = useState(false);
  const [q, setQ] = useState('');
  const [trangThai, setTrangThai] = useState('tat-ca');
  const [locBbgn, setLocBbgn] = useState(false);
  const [moLich, setMoLich] = useState(false);

  const di = (p: { ngay?: string; kho?: string }) => {
    const sp = new URLSearchParams();
    sp.set('ngay', p.ngay ?? ngay);
    const k = p.kho ?? kho;
    if (k) sp.set('kho', k);
    router.push(`/f/warehouse/dong-bo?${sp.toString()}`);
  };

  /** Danh sách trạng thái xử lý kho dựng TỪ DỮ LIỆU THẬT kèm số đếm — đội kho
   *  thêm lựa chọn mới trên Lark là ô này có ngay, không phải sửa code. */
  const trangThaiCo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of dong) {
      const k = (r.whAction ?? '').trim() || '(chưa có)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [dong]);

  const soThieuBbgn = useMemo(() => dong.filter((r) => !r.coBbBanGiao).length, [dong]);

  const hienThi = useMemo(() => {
    const tu = q.trim().toLowerCase();
    return danhDauNoiTiep(dong.filter((r) => {
      if (locBbgn && r.coBbBanGiao) return false;
      if (trangThai !== 'tat-ca' && ((r.whAction ?? '').trim() || '(chưa có)') !== trangThai) return false;
      if (!tu) return true;
      // Lý do lỗi nằm trong ô tìm (03/10/2026): gõ "bẩn" ra ngay mọi chiếc lỗi bẩn trong ngày.
      return `${r.orderNumber ?? ''}${r.lineitemName ?? ''}${r.sku ?? ''}${r.vendorFinal ?? ''}${r.lyDoFail ?? ''}`
        .toLowerCase().includes(tu);
    }));
  }, [dong, q, trangThai, locBbgn]);

  const soChiec = dong.reduce((s, r) => s + (r.soLuong ?? 1), 0);
  const soDon = new Set(dong.map((r) => r.orderNumber).filter(Boolean)).size;
  const laHomNay = ngay >= homNay;
  const d = new Date(`${ngay}T00:00:00`);

  const soi = async () => {
    setDangSoi(true); setKet(null);
    try {
      const r = await doiChieuNgay(ngay);
      if (!r.ok || !r.ket) { toast.error(r.loi ?? 'Đối chiếu thất bại.', { duration: 10000 }); return; }
      setKet(r.ket);
      if (coLech(r.ket)) toast.error('Hai bên đang lệch — xem chi tiết bên dưới.', { duration: 10000 });
      else toast.success(`Khớp hoàn toàn: ${r.ket.khop} dòng.`, { duration: 3000 });
    } catch (e) {
      console.error('[kho-nhan] đối chiếu lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại.', { duration: 10000 });
    } finally {
      setDangSoi(false);
    }
  };

  const doiNgay = (b: number) => {
    // `dichNgay` là phép cộng lịch THUẦN. Cách cũ dựng Date theo giờ địa phương
    // rồi đọc bằng toISOString() (UTC) nên mất 7 tiếng: lùi từ 29/09 ra thẳng
    // 27/09, và 27/09 + 1 lại ra 27/09 nên nút tiến đứng im (CEO 29/09/2026).
    const s = dichNgay(ngay, b);
    if (s <= homNay) di({ ngay: s });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Sổ nhập kho &amp; đối chiếu Lark</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Lark {capNhatLuc
              ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(capNhatLuc))
              : 'chưa kéo lần nào'}
          </span>
          <span title={GIAI_THICH} aria-label={GIAI_THICH} className="cursor-help text-muted-foreground hover:text-foreground">
            <CircleAlertIcon className="size-4" />
          </span>
          <Button type="button" size="sm" onClick={() => void soi()} disabled={dangSoi}>
            {dangSoi ? 'Đang đối chiếu…' : 'Đối chiếu Lark'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-card px-3 py-2.5">
        <div className="relative flex shrink-0 items-center gap-3">
          <button
            type="button" onClick={() => setMoLich((v) => !v)} title="Chọn ngày"
            className="-m-1 flex cursor-pointer items-center gap-3 rounded-xl p-1 hover:bg-muted"
          >
            <span className={`flex size-12 flex-col items-center justify-center rounded-[10px] ${
              laHomNay ? 'bg-foreground text-background' : 'bg-muted text-foreground'}`}
            >
              <span className="text-[10px] font-semibold leading-none tracking-wider">TH{d.getMonth() + 1}</span>
              <span className="text-[22px] font-bold leading-[1.05] tracking-tight">
                {String(d.getDate()).padStart(2, '0')}
              </span>
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="flex items-center gap-2">
                <span className="whitespace-nowrap text-base font-semibold tracking-tight">
                  {THU[d.getDay()]}, {ngayVn(ngay)}
                </span>
                {laHomNay && (
                  <span className="rounded-[5px] bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400">
                    HÔM NAY
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {soChiec} chiếc · {soDon} đơn
              </span>
            </span>
            <ChevronDownIcon className="mt-2 size-3 self-start text-muted-foreground" />
          </button>

          {moLich && (
            <LichNgay
              ngay={ngay} homNay={homNay} cacNgay={cacNgay}
              onChon={(s) => { setMoLich(false); di({ ngay: s }); }}
              onDong={() => setMoLich(false)}
            />
          )}

          <div className="flex gap-0.5">
            <button
              type="button" onClick={() => doiNgay(-1)} title="Ngày trước"
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] border border-input hover:bg-muted"
            ><ChevronLeftIcon className="size-3.5" /></button>
            <button
              type="button" onClick={() => doiNgay(1)} disabled={laHomNay} title="Ngày sau"
              className="grid size-7 cursor-pointer place-items-center rounded-[7px] border border-input hover:bg-muted disabled:cursor-default disabled:opacity-40"
            ><ChevronRightIcon className="size-3.5" /></button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 basis-[420px] items-center gap-1.5">
          <div className="flex h-8 max-w-[320px] flex-1 basis-[200px] items-center gap-2 rounded-lg border border-input bg-background px-2.5">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm mã đơn, tên, SKU…"
              className="min-w-0 flex-1 border-none bg-transparent text-xs outline-none"
            />
          </div>
          <select
            value={trangThai} onChange={(e) => setTrangThai(e.target.value)}
            aria-label="Lọc theo xử lý kho"
            className={`h-8 shrink-0 cursor-pointer rounded-lg border bg-background px-2 text-xs ${
              trangThai === 'tat-ca' ? 'border-input' : 'border-ring'}`}
          >
            <option value="tat-ca">Tất cả trạng thái · {dong.length}</option>
            {trangThaiCo.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
          </select>
          <button
            type="button" onClick={() => setLocBbgn((v) => !v)}
            className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
              locBbgn ? 'border-ring bg-muted font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
          >
            Chưa BBGN
            <span className="text-[11px] text-muted-foreground">{soThieuBbgn}</span>
          </button>
        </div>

        <select
          value={kho} onChange={(e) => di({ kho: e.target.value })} aria-label="Kho"
          className="ml-auto h-8 shrink-0 cursor-pointer rounded-lg border border-input bg-background px-2 text-xs"
        >
          <option value="">Tất cả kho</option>
          {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>Kho {nhanKho(k)}</option>)}
        </select>
      </div>

      {ket && <KhoiLech ket={ket} />}

      <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-border bg-card">
        <div style={{ minWidth: RONG_TOI_THIEU }}>
          <div
            className="sticky top-0 z-[2] grid h-[34px] items-center gap-3 border-b border-border bg-muted px-3.5 text-[11px] font-medium text-muted-foreground"
            style={{ gridTemplateColumns: LUOI_SO_NHAP }}
          >
            {/* Tiêu đề dựng TỪ `COT_SO_NHAP`, cùng chỗ khai lưới cột — xem `cot-so-nhap.ts`. */}
            {COT_SO_NHAP.map((c) => (
              <span key={c.ten} className={c.giua ? 'text-center' : undefined}>{c.ten}</span>
            ))}
          </div>

          {hienThi.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              Không có dòng nào khớp bộ lọc.
            </p>
          ) : hienThi.map((r) => {
            const { ten, bienThe } = tachTenBienThe(r.lineitemName);
            const mq = nhomQc(r.qcCheck);
            const mk = nhomKho(r.whAction);
            const brand = tenBrand(r.vendorFinal, r.sku);
            return (
              <div
                key={r.recordId}
                className={`grid h-[38px] items-center gap-3 px-3.5 text-[13px] hover:bg-muted/50 ${
                  r.noiTiep ? '' : 'border-t border-border'
                } ${mq === 'hong' ? 'bg-red-500/[0.07]' : ''}`}
                style={{ gridTemplateColumns: LUOI_SO_NHAP }}
              >
                {/* Dòng nối tiếp cùng đơn bỏ trống ô mã đơn và ẩn đường kẻ — mắt
                    đọc ra ngay đây là mấy chiếc của CÙNG một đơn. */}
                <span className="truncate font-mono text-xs">{r.noiTiep ? '' : r.orderNumber ?? '—'}</span>
                {/* Vendor final bên Lark chỉ điền 57% dòng; thiếu thì suy từ
                    tiền tố SKU và hiện MỜ hơn để phân biệt với thứ Lark ghi. */}
                <span className={`truncate text-xs ${brand?.suyRa ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
                  {brand?.ten ?? '—'}
                </span>
                <span className="truncate">
                  {ten || '—'}
                  {bienThe && <span className="text-muted-foreground"> · {bienThe}</span>}
                </span>
                <span className="truncate font-mono text-[11.5px] text-muted-foreground">{r.sku ?? '—'}</span>
                <span className={`text-center ${(r.soLuong ?? 1) > 1 ? 'font-bold' : ''}`}>{r.soLuong ?? 1}</span>
                <span className="truncate text-xs text-muted-foreground">{r.storeFinal ?? '—'}</span>
                {/* Màu theo GIÁ TRỊ để mắt phân biệt khi quét bảng (CEO 28/09/2026); chữ
                    vẫn hiện đủ nên màu chỉ là kênh thứ hai. `title` vì cột hẹp cắt chữ. */}
                <ONhanMau giaTri={r.warehouse} mau={mauKho(r.warehouse)} />
                <ONhanMau giaTri={r.inventoryType} mau={mauLoaiNhap(r.inventoryType)} />
                <span className={`flex items-center gap-1.5 truncate text-xs ${CHU_QC[mq]}`}>
                  <span className={`size-1.5 shrink-0 rounded-full ${MAU_QC[mq]}`} />
                  {(r.qcCheck ?? '').trim() || '—'}
                </span>
                {/* Lý do + ảnh lỗi QC, kẹp giữa QC và Xử lý kho ĐÚNG như thứ tự bên Lark.
                    Cột hẹp nên chữ cụt — `title` để đọc đủ mà không phải mở gì. Giữ nguyên chữ
                    người gõ: "xước chỉ, bẩn", "Ố vàng", "rách vải, bung chỉ". */}
                <span className="truncate text-xs text-muted-foreground" title={r.lyDoFail ?? undefined}>
                  {(r.lyDoFail ?? '').trim() || '—'}
                </span>
                {/* Cùng ô xem ảnh với ảnh hàng đến — KHÔNG có nút bổ sung: ảnh lỗi đi vào hệ
                    thống qua bước QC, thêm một đường tải ảnh thứ hai ở đây là hai nguồn cho
                    một việc. Ô tự hiện gạch ngang khi không có ảnh. */}
                <OAnhLark ds={r.anhLoiQc} nhan={`Ảnh lỗi QC · ${r.orderNumber ?? ''}`} />
                <span className={`truncate text-xs ${CHU_KHO[mk]}`}>{(r.whAction ?? '').trim() || '—'}</span>
                {/* Thiếu file thì cho tải ngay tại dòng, áp cho cả đơn trong ngày
                    (CEO 29/09/2026). Dòng đã có thì giữ nguyên ô xem ảnh. */}
                {r.anhHangDen.length > 0
                  ? <OAnhLark ds={r.anhHangDen} nhan={`Ảnh thực tế · ${r.orderNumber ?? ''}`} />
                  : <NutBoSungFile recordId={r.recordId} loai="hang_den" maDon={r.orderNumber} />}
                {r.bbBanGiao.length > 0
                  ? <OAnhLark ds={r.bbBanGiao} nhan={`Biên bản bàn giao · ${r.orderNumber ?? ''}`} />
                  : <NutBoSungFile recordId={r.recordId} loai="bb_ban_giao" maDon={r.orderNumber} />}
                <span className="truncate font-mono text-[11px] text-muted-foreground">{r.uniqueCode ?? '—'}</span>
                <span className={`justify-self-start whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium ${
                  r.cuaHeThong
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'}`}
                >
                  {r.cuaHeThong ? 'Hệ thống' : 'Lark'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Một ô nhãn có màu theo giá trị. Trống thì gạch ngang, không tô gì. */
function ONhanMau({ giaTri, mau }: { giaTri: string | null; mau: string }) {
  return (
    <span className="truncate text-xs">
      {giaTri
        ? <span title={giaTri} className={`rounded-full px-1.5 py-0.5 text-[11px] ${mau}`}>{giaTri}</span>
        : <span className="text-muted-foreground">—</span>}
    </span>
  );
}

function KhoiLech({ ket }: { ket: KetQuaDoiChieu }) {
  if (!coLech(ket)) {
    return (
      <p className="rounded-lg border border-border px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
        Khớp hoàn toàn — {ket.khop} dòng trùng khít hai bên.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">Kết quả đối chiếu — {ket.khop} dòng khớp</p>
      <Muc ten="Chưa gửi lên Lark" so={ket.chuaGui.length} mau="text-amber-600 dark:text-amber-400"
        y="Bên mình có, Lark chưa biết. Bấm “Bắt đầu QC” ở màn Nhận & Kiểm để gửi."
        dong={ket.chuaGui.map((c) => `${c.unitCode} · ${c.maDon ?? '—'}`)} />
      <Muc ten="Đã gửi nhưng Lark không còn" so={ket.matTrenLark.length} mau="text-red-600 dark:text-red-400"
        y="Loại lệch âm thầm nhất: bên mình ghi là đã gửi, nhưng dòng đó đã biến mất khỏi Lark."
        dong={ket.matTrenLark.map((c) => `${c.unitCode} · ${c.maDon ?? '—'}`)} />
      <Muc ten="Chỉ có trên Lark" so={ket.chiCoTrenLark.length} mau="text-muted-foreground"
        y="Đội kho nhập thẳng lên Lark — bình thường trong giai đoạn chạy song song hai hệ thống."
        dong={ket.chiCoTrenLark.map((x) => `${x.maDon ?? '—'} · ${x.sku ?? '—'}`)} />
    </div>
  );
}

function Muc({ ten, so, mau, y, dong }: {
  ten: string; so: number; mau: string; y: string; dong: string[];
}) {
  if (so === 0) return null;
  return (
    <details className="rounded-lg bg-muted px-3 py-2">
      <summary className={`cursor-pointer ${mau}`}>{ten}: {so}</summary>
      <p className="mt-1 text-xs text-muted-foreground">{y}</p>
      <ul className="mt-1 space-y-0.5 font-mono text-xs">
        {dong.slice(0, 50).map((x) => <li key={x}>{x}</li>)}
      </ul>
      {dong.length > 50 && <p className="mt-1 text-xs text-muted-foreground">… còn {dong.length - 50} dòng nữa</p>}
    </details>
  );
}
