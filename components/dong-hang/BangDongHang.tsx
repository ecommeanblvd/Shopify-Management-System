'use client';

import { Fragment, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { baoGiaKien, chonHangChoDon } from '@/features/dong-hang/actions';
import { canQuyDoi, conChonDuoc, laNgayTuongLai, nhomTheoNgayVaBase, trangThaiKien } from '@/features/dong-hang/logic';
import { BO_LOC, type BaoGiaKien, type BoLocDongHang, type KienChoKhop, type KienDongHang } from '@/features/dong-hang/types';
import { chiTietCuoc, dichGhiChu } from '@/features/carrier-rates/compare/chi-tiet-cuoc';
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type KetQuaChon = Awaited<ReturnType<typeof chonHangChoDon>>;

const num = (n: number) => Math.round(n).toLocaleString('vi-VN');
const vnd = (n?: number | null) => (typeof n === 'number' ? `${num(n)}₫` : '—');
/** Cân nặng kiểu Việt: dấu phẩy thập phân, tối đa 3 số lẻ (1,966 kg). */
const soKg = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const soNgay = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

const gioVn = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 'YYYY-MM-DD' (đã theo giờ VN từ nhomTheoNgay) → 'dd/mm/yyyy'. */
const hienNgayNhom = (ngay: string) => ngay.split('-').reverse().join('/');

const THU = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
/** Thứ trong tuần của một ngày-lịch VN — đọc nhanh hơn dãy số ngày tháng. */
const thuTrongTuan = (ngay: string) => THU[new Date(`${ngay}T00:00:00Z`).getUTCDay()];

const NHAN_LOC: Record<BoLocDongHang, string> = {
  cho_chon_line: 'Chờ chọn line',
  hom_nay: 'Hôm nay',
  du_kien_di: 'Dự kiến đi',
  '7_ngay': '7 ngày',
  tat_ca: 'Tất cả',
};

/** Cờ + mã nước cho dễ nhìn nhanh. */
const coNuoc = (iso: string | null) => {
  if (!iso || iso.length !== 2) return iso ?? '—';
  const cc = iso.toUpperCase();
  const co = String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  return `${co} ${cc}`;
};

/** MỘT khai báo lưới dùng cho cả hàng tiêu đề lẫn mọi dòng — cột thẳng hàng toàn trang. */
const LUOI =
  'grid grid-cols-[minmax(150px,1.1fr)_minmax(104px,0.7fr)_minmax(0,2fr)_minmax(150px,1.1fr)_minmax(132px,auto)_minmax(186px,1.2fr)]';

export function BangDongHang({
  kien, choKhop, loc, q, coQuyenChon, gioiHan, soKienChuaCan,
}: {
  kien: KienDongHang[];
  choKhop: KienChoKhop[];
  loc: BoLocDongHang;
  q: string;
  coQuyenChon: boolean;
  gioiHan: number;
  soKienChuaCan: number;
}) {
  const [bao, setBao] = useState<Map<string, BaoGiaKien>>(new Map());
  const [dangBao, setDangBao] = useState<Set<string>>(new Set());
  const [chonCucBo, setChonCucBo] = useState<Map<string, string>>(new Map());
  const [ketQua, setKetQua] = useState<Map<string, KetQuaChon>>(new Map());
  // Cặp `orderId|carrierKey` đang gửi — Map để nhiều đơn chọn song song không xoá cờ của nhau.
  const [dangChon, setDangChon] = useState<Map<string, string>>(new Map());
  const [kienMo, setKienMo] = useState<KienDongHang | null>(null);
  const [thongBao, setThongBao] = useState('');
  const [, batDauBao] = useTransition();
  const [, batDauChon] = useTransition();

  const loiBaoGia = (): BaoGiaKien => ({
    rows: [], reNhatKey: null, thoiGian: {}, theoDuKien: false,
    error: 'Không báo giá được, thử lại', luc: new Date().toISOString(),
  });

  const soCuoc = (shipmentId: string) => {
    setDangBao((s) => new Set(s).add(shipmentId));
    batDauBao(async () => {
      try {
        const r = await baoGiaKien(shipmentId);
        setBao((m) => new Map(m).set(shipmentId, r));
      } catch {
        setBao((m) => new Map(m).set(shipmentId, loiBaoGia()));
      } finally {
        setDangBao((s) => { const n = new Set(s); n.delete(shipmentId); return n; });
      }
    });
  };

  const chonHang = (orderId: string, carrierKey: string, dongModal = false) => {
    setDangChon((m) => new Map(m).set(orderId, carrierKey));
    batDauChon(async () => {
      try {
        const r = await chonHangChoDon(orderId, carrierKey);
        if (r.ok) {
          setChonCucBo((m) => new Map(m).set(orderId, carrierKey));
          setThongBao(r.lark?.ok
            ? `Đã chốt ${carrierKey} · ghi "${r.lark.ten}" lên cột Couriers của Lark (${r.lark.daGhi} dòng)`
            : `Đã chốt ${carrierKey} — Lark chưa nhận: ${r.lark?.error ?? 'không rõ'}`);
          if (dongModal) setKienMo(null);
        }
        setKetQua((m) => new Map(m).set(orderId, r));
      } catch {
        setKetQua((m) => new Map(m).set(orderId, { ok: false, error: 'Không chọn được hãng, thử lại' }));
      } finally {
        setDangChon((m) => { const n = new Map(m); n.delete(orderId); return n; });
      }
    });
  };

  // Thông báo tự tắt — chốt line xong không phải bấm gì thêm.
  useEffect(() => {
    if (!thongBao) return;
    const t = setTimeout(() => setThongBao(''), 6000);
    return () => clearTimeout(t);
  }, [thongBao]);

  const nhom = nhomTheoNgayVaBase(kien);
  const chamTran = kien.length >= gioiHan;
  const soDaChon = kien.filter((k) => chonCucBo.get(k.orderId) ?? k.selectedCarrierKey).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Đóng hàng</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Kiện từ Lark về đây ngay khi đóng xong. Chọn line ship trước để đóng đúng chuẩn bao bì của hãng; hãng đã chọn được ghi lên cột Couriers của Lark.
          </p>
        </div>
        <div className="flex gap-2.5">
          <ONhin nhan="CHỜ CHỌN LINE" so={kien.length - soDaChon} noiBat />
          <ONhin nhan="ĐÃ CHỌN LINE" so={soDaChon} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {BO_LOC.map((l) => (
          <Link
            key={l}
            href={`/f/dong-hang?loc=${l}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={`rounded-lg border px-4 py-2 text-[13px] transition ${
              l === loc
                ? 'border-foreground bg-foreground font-medium text-background'
                : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
            }`}
          >
            {NHAN_LOC[l]}
          </Link>
        ))}

        <span className="mx-1.5 h-6 w-px bg-border" aria-hidden />

        <form method="get" action="/f/dong-hang" className="flex items-stretch overflow-hidden rounded-lg border border-border bg-muted/40">
          <input type="hidden" name="loc" value={loc} />
          <input
            name="q" defaultValue={q} placeholder="Mã đơn / PK-…"
            className="w-52 bg-transparent px-3.5 py-2 text-[13px] outline-none"
          />
          <button type="submit" className="border-l border-border bg-muted px-4 text-[13px] font-medium transition hover:bg-muted/70">
            Tìm
          </button>
        </form>

        <span className="ml-auto text-[13px] text-muted-foreground">
          {kien.length} kiện
          {loc === 'cho_chon_line' && soKienChuaCan > 0 && ` · ${soKienChuaCan} kiện chưa đóng — so cước theo cân dự kiến Shopify`}
        </span>
      </div>

      {choKhop.length > 0 && (
        <section className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <h2 className="text-xs font-semibold uppercase tracking-wider">Không khớp đơn SMS ({choKhop.length})</h2>
          <ul className="mt-1 space-y-0.5">
            {choKhop.map((c) => (
              <li key={c.recordId} className="text-[11px] leading-snug">
                {[
                  c.logUniqueCode, c.orderNumber,
                  c.weightKg != null ? `${soKg(c.weightKg)} kg` : null,
                  c.dims, c.hop, c.lyDo, gioVn(c.nhanLuc),
                ].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {chamTran && (
        <p className="text-[11px] text-muted-foreground">
          Chỉ hiện {gioiHan} kiện mới nhất — thu hẹp bộ lọc hoặc tìm theo mã đơn.
        </p>
      )}

      {kien.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Không có kiện nào theo bộ lọc này.
        </p>
      ) : (
        <div className="space-y-4 overflow-x-auto">
          {/* Hàng tiêu đề đứng yên khi cuộn — luôn biết cột nào là cột nào. */}
          <div className={`sticky top-0 z-20 min-w-[980px] rounded-lg border border-border bg-muted/90 px-[18px] py-2.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground backdrop-blur ${LUOI}`}>
            <span className="pr-4">Đơn</span>
            <span className="pr-4">Cân cước</span>
            <span className="pr-6">Hộp / SKU</span>
            <span className="pr-4">Line ship</span>
            <span className="pr-4">Thao tác</span>
            <span>Trạng thái</span>
          </div>

          {nhom.map((g) => (
            <section key={g.ngay} className="min-w-[980px] overflow-hidden rounded-xl border border-border">
              <header className="flex flex-wrap items-baseline gap-3 border-b border-border bg-muted/60 px-[18px] py-3.5">
                <span className="text-base font-semibold tracking-tight">
                  {thuTrongTuan(g.ngay)}, {hienNgayNhom(g.ngay)}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {g.theoBase.reduce((n, b) => n + b.kien.length, 0)} kiện
                </span>
                {laNgayTuongLai(g.ngay) && (
                  <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400">
                    Lark hẹn đi ngày này
                  </span>
                )}
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {g.theoBase.map((b) => (
                    <span
                      key={b.base ?? 'khong-ro'}
                      className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-amber-700 dark:text-amber-400"
                    >
                      {b.base ?? 'chưa rõ kho'} {b.kien.length}
                    </span>
                  ))}
                </span>
              </header>

              {g.theoBase.map((b) => (
                <Fragment key={b.base ?? 'khong-ro'}>
                  {g.theoBase.length > 1 && (
                    <div className="border-b border-border/60 bg-muted/25 px-[18px] py-1 text-[11px] font-medium text-muted-foreground">
                      Kho {b.base ?? 'chưa rõ'} · {b.kien.length} kiện
                    </div>
                  )}
                  {b.kien.map((k) => (
                    <DongKien
                      key={k.shipmentId}
                      k={k}
                      bao={bao.get(k.shipmentId)}
                      coQuyenChon={coQuyenChon}
                      chonCucBo={chonCucBo.get(k.orderId)}
                      ketQua={ketQua.get(k.orderId)}
                      dangChonHang={dangChon.get(k.orderId)}
                      moSoCuoc={() => setKienMo(k)}
                    />
                  ))}
                </Fragment>
              ))}
            </section>
          ))}
        </div>
      )}

      {kienMo && (
        <ModalSoCuoc
          k={kienMo}
          bao={bao.get(kienMo.shipmentId)}
          dangBao={dangBao.has(kienMo.shipmentId)}
          soCuoc={soCuoc}
          coQuyenChon={coQuyenChon}
          daChon={chonCucBo.get(kienMo.orderId) ?? kienMo.selectedCarrierKey}
          ketQua={ketQua.get(kienMo.orderId)}
          dangChonHang={dangChon.get(kienMo.orderId)}
          chonHang={chonHang}
          dong={() => setKienMo(null)}
        />
      )}

      {thongBao && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-emerald-500/40 bg-background px-4 py-2.5 text-[13px] shadow-lg"
        >
          {thongBao}
        </div>
      )}
    </div>
  );
}

/** Ô đếm đầu trang: nhìn một cái biết còn bao nhiêu việc. */
function ONhin({ nhan, so, noiBat }: { nhan: string; so: number; noiBat?: boolean }) {
  return (
    <div className={`min-w-[132px] rounded-xl border px-4 py-2.5 ${noiBat ? 'border-amber-500/35 bg-amber-500/10' : 'border-border bg-muted/40'}`}>
      <div className={`text-[10px] tracking-[0.1em] ${noiBat ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{nhan}</div>
      <div className={`text-[22px] font-semibold tabular-nums ${noiBat ? 'text-amber-800 dark:text-amber-300' : ''}`}>{so}</div>
    </div>
  );
}

function DongKien({
  k, bao, coQuyenChon, chonCucBo, ketQua, dangChonHang, moSoCuoc,
}: {
  k: KienDongHang;
  bao: BaoGiaKien | undefined;
  coQuyenChon: boolean;
  chonCucBo: string | undefined;
  ketQua: KetQuaChon | undefined;
  dangChonHang: string | undefined;
  moSoCuoc: () => void;
}) {
  const daChon = chonCucBo ?? k.selectedCarrierKey;
  const tt = trangThaiKien({ ...k, selectedCarrierKey: daChon });
  // Chưa đóng thì cân cước tạm tính theo cân dự kiến Shopify (chọn line trước, đóng sau).
  const can = k.weightKg != null ? canQuyDoi(k.weightKg, k.dims) : canQuyDoi(k.canDuKienKg, null);
  const chuaDong = k.weightKg == null;
  const khongDiHang = k.huy.loai === 'toan_bo' || k.larkMatDong;
  const giaDaChon = daChon ? bao?.rows.find((r) => r.carrierKey === daChon)?.vndCost : null;
  const soHangCoCuoc = bao?.rows.filter((r) => r.ok && conChonDuoc(r)).length;

  return (
    <div className={`items-center border-b border-border/50 px-[18px] py-3.5 transition last:border-b-0 hover:bg-muted/30 ${LUOI}`}>
      <div className="min-w-0 pr-4">
        <div className="truncate text-sm font-medium" title={k.orderNumber}>{k.orderNumber}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{k.storeName}</span>
          <span className="shrink-0 rounded border border-border px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">
            {coNuoc(k.country)}
          </span>
        </div>
        {k.donDiChung.length > 0 && (
          <div className="mt-0.5 truncate text-[11px] text-sky-700 dark:text-sky-400" title="Lark gộp các đơn này vào cùng một kiện">
            đi chung: {k.donDiChung.join(', ')}
          </div>
        )}
      </div>

      <div className="min-w-0 pr-4">
        <div className="text-[15px] font-semibold tabular-nums">{can.tinhCuoc != null ? `${soKg(can.tinhCuoc)} kg` : '—'}</div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          {chuaDong
            ? k.canDuKienKg != null ? `dự kiến ${soKg(k.canDuKienKg)} · chưa đóng` : 'chưa có cân'
            : [
                `thực ${soKg(k.weightKg!)}`,
                k.dims ? `${k.dims.l}×${k.dims.w}${k.dims.h != null ? `×${k.dims.h}` : ''}` : null,
                can.theo === 'quy_doi' ? 'theo kích thước' : null,
              ].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div className="min-w-0 pr-6">
        <div className="truncate text-xs" title={k.hop ?? undefined}>{k.hop ?? '—'}</div>
        <div className="truncate text-[11px] leading-tight text-muted-foreground" title={k.skuText ?? undefined}>
          {[k.skuText, k.pieces != null ? `${k.pieces} món` : null].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      <div className="min-w-0 pr-4">
        {daChon ? (
          <>
            <div className="truncate text-sm font-medium">{daChon}</div>
            <div className="flex items-center gap-2 text-[11px]">
              {giaDaChon != null && <span className="text-emerald-700 dark:text-emerald-400">{vnd(giaDaChon)}</span>}
              {bao?.thoiGian[daChon] && <span className="text-muted-foreground">{soNgay(bao.thoiGian[daChon].ngayTb)} ngày</span>}
            </div>
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">
            {soHangCoCuoc != null ? `${soHangCoCuoc} hãng có cước` : 'chưa so cước'}
          </span>
        )}
      </div>

      <div className="pr-4">
        {khongDiHang ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <button
            type="button" onClick={moSoCuoc}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-[13px] transition ${
              daChon
                ? 'border border-border font-medium hover:border-foreground/40'
                : 'bg-amber-500 font-semibold text-amber-950 hover:bg-amber-400'
            }`}
          >
            {daChon ? 'Xem / đổi line' : coQuyenChon ? 'So cước & chọn' : 'So cước'}
          </button>
        )}
      </div>

      <div className="min-w-0 space-y-1">
        {k.huy.loai === 'toan_bo' ? (
          <Chip mau="do" cham>Đã huỷ{k.huy.lyDo ? ` · ${k.huy.lyDo}` : ''}</Chip>
        ) : k.larkMatDong ? (
          <Chip mau="xam">Lark đã xoá dòng</Chip>
        ) : tt.ma === 'da_len_nhan' ? (
          <Chip mau="xam">Đã lên nhãn</Chip>
        ) : daChon ? (
          <Chip mau="xanh" cham>Đã chọn line</Chip>
        ) : (
          <Chip mau="vang" cham>Chờ chọn line</Chip>
        )}

        {k.huy.loai === 'mot_phan' && <Chip mau="vang">Đơn huỷ {k.huy.soHuy}/{k.huy.tong} món</Chip>}

        <div className="truncate text-[11px] leading-snug text-muted-foreground">
          {dangChonHang
            ? `đang ghi ${dangChonHang}…`
            : ketQua && !ketQua.ok
              ? ketQua.error
              : tt.ma === 'da_chon'
                ? [tt.nguoi, tt.luc ? gioVn(tt.luc) : null].filter(Boolean).join(' · ')
                : tt.ma === 'da_len_nhan'
                  ? tt.tracking
                  : chuaDong ? 'chưa đóng gói' : `đóng xong ${gioVn(k.ngayDong)}`}
        </div>
      </div>
    </div>
  );
}

function Chip({ mau, cham, children }: { mau: 'vang' | 'xanh' | 'do' | 'xam'; cham?: boolean; children: React.ReactNode }) {
  const lop = {
    vang: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    xanh: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    do: 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-400',
    xam: 'border-border bg-muted text-muted-foreground',
  }[mau];
  const chamMau = { vang: 'bg-amber-500', xanh: 'bg-emerald-500', do: 'bg-red-500', xam: 'bg-muted-foreground' }[mau];
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-md border px-2 py-0.5 text-[11px] font-medium ${lop}`}>
      {cham && <span className={`size-1.5 shrink-0 rounded-full ${chamMau}`} />}
      {children}
    </span>
  );
}

/**
 * Modal chọn line: giá đặt cạnh thời gian giao trung bình 30 ngày, vì rẻ nhất chưa chắc là
 * lựa chọn đúng khi hãng đó giao chậm hơn hai ngày (CEO 22/09/2026). Chọn hãng rồi mới bấm
 * chốt — một cú bấm nhầm không gửi thẳng lên Lark.
 */
function ModalSoCuoc({
  k, bao, dangBao, soCuoc, coQuyenChon, daChon, ketQua, dangChonHang, chonHang, dong,
}: {
  k: KienDongHang;
  bao: BaoGiaKien | undefined;
  dangBao: boolean;
  soCuoc: (shipmentId: string) => void;
  coQuyenChon: boolean;
  daChon: string | null | undefined;
  ketQua: KetQuaChon | undefined;
  dangChonHang: string | undefined;
  chonHang: (orderId: string, carrierKey: string, dongModal?: boolean) => void;
  dong: () => void;
}) {
  const [chiTiet, setChiTiet] = useState<string | null>(null);
  const [xep, setXep] = useState<'cuoc' | 'nhanh'>('cuoc');
  const [dangNgam, setDangNgam] = useState<string | null>(daChon ?? null);
  const can = k.weightKg != null ? canQuyDoi(k.weightKg, k.dims) : canQuyDoi(k.canDuKienKg, null);

  // Mở modal là báo giá luôn — Đức mở đúng kiện mình đang cần, không phải bấm thêm lần nữa.
  useEffect(() => {
    if (!bao && !dangBao) soCuoc(k.shipmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k.shipmentId]);

  const rows = bao?.rows ?? [];
  const reNhatCost = rows.find((r) => r.carrierKey === bao?.reNhatKey)?.vndCost ?? null;
  const nhanhNhat = rows
    .filter((r) => r.ok && conChonDuoc(r) && bao?.thoiGian[r.carrierKey])
    .sort((a, b) => bao!.thoiGian[a.carrierKey].ngayTb - bao!.thoiGian[b.carrierKey].ngayTb)[0]?.carrierKey ?? null;

  const daXep = [...rows].sort((a, b) => {
    if (xep === 'cuoc') return (a.vndCost ?? Infinity) - (b.vndCost ?? Infinity);
    const ta = bao?.thoiGian[a.carrierKey]?.ngayTb ?? Infinity;
    const tb = bao?.thoiGian[b.carrierKey]?.ngayTb ?? Infinity;
    return ta - tb;
  });
  const ngam = rows.find((r) => r.carrierKey === dangNgam);
  const soChonDuoc = rows.filter((r) => r.ok && conChonDuoc(r)).length;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) dong(); }}>
      <DialogContent className="max-h-[88vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="text-[10px] tracking-[0.12em] text-muted-foreground">SO CƯỚC &amp; CHỌN LINE SHIP</div>
          <DialogTitle className="flex flex-wrap items-baseline gap-2.5">
            {k.orderNumber}
            <span className="text-[13px] font-normal text-muted-foreground">{k.storeName}</span>
            <span className="rounded border border-border px-1.5 text-[11px] font-normal tracking-wide text-muted-foreground">
              {coNuoc(k.country)}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">Cước và thời gian giao của các hãng cho kiện này</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          <O nhan="CÂN THỰC" giaTri={k.weightKg != null ? `${soKg(k.weightKg)} kg` : k.canDuKienKg != null ? `${soKg(k.canDuKienKg)} kg (dự kiến)` : '—'} />
          <O nhan="KÍCH THƯỚC" giaTri={k.dims ? `${k.dims.l}×${k.dims.w}${k.dims.h != null ? `×${k.dims.h}` : ''} cm` : '—'} />
          <O nhan="CÂN TÍNH CƯỚC" giaTri={can.tinhCuoc != null ? `${soKg(can.tinhCuoc)} kg` : '—'} />
          <O nhan="HỘP" giaTri={k.hop ?? '—'} />
        </div>

        {bao?.theoDuKien && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Kiện chưa đóng — cước tính theo cân dự kiến của Shopify, đóng xong cân lại có thể lệch.
          </p>
        )}

        {k.huy.loai !== 'khong' && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {k.huy.loai === 'toan_bo'
              ? `Kiện đã huỷ${k.huy.lyDo ? ` (${k.huy.lyDo})` : ''} — không đi hàng nữa.`
              : `Đơn huỷ ${k.huy.soHuy}/${k.huy.tong} món — kiểm lại hàng trong kiện trước khi chọn line.`}
          </p>
        )}

        {dangBao && <p className="py-8 text-center text-sm text-muted-foreground">Đang báo giá…</p>}

        {!dangBao && bao?.error && (
          <div className="flex flex-col items-start gap-2 py-4">
            <p className="text-sm text-amber-600 dark:text-amber-400">{bao.error}</p>
            <button type="button" onClick={() => soCuoc(k.shipmentId)}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted">
              Thử lại
            </button>
          </div>
        )}

        {!dangBao && bao && !bao.error && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-muted-foreground">
                {soChonDuoc} hãng nhận tuyến {k.country ?? '—'} · {xep === 'cuoc' ? 'sắp theo cước' : 'sắp theo thời gian giao'}
              </span>
              <div className="flex gap-1.5">
                {([['cuoc', 'Cước thấp nhất'], ['nhanh', 'Giao nhanh nhất']] as const).map(([ma, nhan]) => (
                  <button
                    key={ma} type="button" onClick={() => setXep(ma)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      xep === ma ? 'border-foreground/40 bg-muted font-medium' : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {nhan}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {daXep.map((r) => {
                const tg = bao.thoiGian[r.carrierKey];
                const chonDuoc = r.ok && conChonDuoc(r);
                const chenh = r.ok && reNhatCost != null && r.vndCost != null ? r.vndCost - reNhatCost : null;
                const dangChonDong = dangNgam === r.carrierKey;
                const ngayNgung = r.suspendedAt
                  ? new Date(r.suspendedAt).toLocaleDateString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH })
                  : null;
                return (
                  <Fragment key={r.accountId}>
                    <button
                      type="button"
                      disabled={!chonDuoc}
                      onClick={() => setDangNgam(r.carrierKey)}
                      className={`grid w-full grid-cols-[22px_1fr_136px_132px] items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition disabled:opacity-55 ${
                        dangChonDong ? 'border-amber-500 bg-amber-500/10' : 'border-border hover:border-foreground/30 hover:bg-muted/40'
                      }`}
                    >
                      <span className={`size-4 rounded-full border ${dangChonDong ? 'border-[5px] border-amber-500' : 'border-muted-foreground/50'}`} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold">{r.carrierKey}</span>
                          {r.carrierKey === bao.reNhatKey && <NhanNho mau="xanh">RẺ NHẤT</NhanNho>}
                          {r.carrierKey === nhanhNhat && <NhanNho mau="lam">NHANH NHẤT</NhanNho>}
                          {daChon === r.carrierKey && <NhanNho mau="xam">ĐANG CHỌN</NhanNho>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {!r.ok
                            ? `không báo giá được (${r.error ?? 'không rõ'})`
                            : !chonDuoc
                              ? `${r.suspendReason || 'Tạm ngưng'}${ngayNgung ? ` · từ ${ngayNgung}` : ''}`
                              : r.carrierName}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold tabular-nums">{r.ok ? vnd(r.vndCost) : '—'}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {chenh == null ? '' : chenh > 0 ? `+${num(chenh)}₫ so với rẻ nhất` : 'rẻ nhất'}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{tg ? `${soNgay(tg.ngayTb)} ngày` : '—'}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {tg ? `${tg.soKien} kiện${tg.phamVi === 'chung' ? ', mọi nước' : ` đi ${k.country}`}` : 'chưa có số liệu'}
                        </span>
                      </span>
                    </button>

                    {r.ok && r.breakdown && (
                      <div className="pl-[38px]">
                        <button
                          type="button"
                          onClick={() => setChiTiet(chiTiet === r.accountId ? null : r.accountId)}
                          aria-expanded={chiTiet === r.accountId}
                          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {chiTiet === r.accountId ? 'thu gọn cách tính' : 'xem cách tính cước'}
                        </button>
                        {chiTiet === r.accountId && <ChiTietPhi row={r} />}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}

        {ketQua && (
          <p className={`text-xs ${
            !ketQua.ok ? 'text-red-600 dark:text-red-400'
              : ketQua.lark && !ketQua.lark.ok ? 'text-amber-600 dark:text-amber-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}>
            {!ketQua.ok
              ? ketQua.error
              : ketQua.lark && !ketQua.lark.ok
                ? `Lark chưa nhận — nhờ điền tay cột Couriers: ${ketQua.lark.error}`
                : `Đã ghi "${ketQua.lark?.ten}" vào cột Couriers trên Lark (${ketQua.lark?.daGhi ?? 0} dòng).`}
          </p>
        )}

        <div className="-mx-6 -mb-6 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
          <span className="text-[13px] text-muted-foreground">
            {ngam
              ? [ngam.carrierKey, vnd(ngam.vndCost), bao?.thoiGian[ngam.carrierKey] ? `${soNgay(bao.thoiGian[ngam.carrierKey].ngayTb)} ngày` : null]
                  .filter(Boolean).join(' · ')
              : 'Chưa chọn hãng'}
            {k.soKienCungDon > 1 && ` · áp cho ${k.soKienCungDon} kiện của đơn`}
          </span>
          <div className="flex gap-2.5">
            <button type="button" onClick={dong}
              className="rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium transition hover:border-foreground/40">
              Đóng
            </button>
            <button
              type="button"
              disabled={!coQuyenChon || !dangNgam || !!dangChonHang || dangNgam === daChon || k.huy.loai === 'toan_bo'}
              onClick={() => dangNgam && chonHang(k.orderId, dangNgam, true)}
              className="rounded-lg bg-amber-500 px-5 py-2.5 text-[13px] font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {dangChonHang ? 'Đang ghi…' : coQuyenChon ? 'Chốt line & ghi lên Lark' : 'Chỉ xem'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function O({ nhan, giaTri }: { nhan: string; giaTri: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <div className="text-[10px] tracking-[0.1em] text-muted-foreground">{nhan}</div>
      <div className="mt-1 truncate text-sm font-medium tabular-nums" title={giaTri}>{giaTri}</div>
    </div>
  );
}

function NhanNho({ mau, children }: { mau: 'xanh' | 'lam' | 'xam'; children: React.ReactNode }) {
  const lop = {
    xanh: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
    lam: 'border-sky-500/40 text-sky-700 dark:text-sky-400',
    xam: 'border-border text-muted-foreground',
  }[mau];
  return <span className={`rounded border px-1.5 py-px text-[10px] font-medium tracking-[0.08em] ${lop}`}>{children}</span>;
}

/**
 * Chi tiết cước của MỘT hãng cho kiện này: cước gốc, phụ phí, nhiên liệu, thuế.
 * Là tiền TRẢ CARRIER, chưa gồm đóng gói và markup của shop.
 */
function ChiTietPhi({ row }: { row: CarrierQuoteRow }) {
  const b = row.breakdown;
  if (!b) return null;
  // Quy mọi dòng về VND: account tính tiền ngoại tệ nhân hệ số vndCost/carrierCost.
  const heSo = row.costCurrency !== 'VND' && b.carrierCost ? (row.vndCost ?? 0) / b.carrierCost : 1;
  const ct = chiTietCuoc(b, heSo);
  const kg = (v: number) => `${soKg(Number(v.toFixed(3)))}kg`;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{row.carrierName}</span>
        <span>Zone {row.zone}{row.tierUpperKg ? ` · bậc ≤${row.tierUpperKg}kg` : ''}</span>
        <span>
          Cân tính cước {kg(ct.canNang.tinhCuoc)}
          {ct.canNang.dungQuyDoi ? ` (quy đổi kích thước ${kg(ct.canNang.quyDoi)} > cân thực ${kg(ct.canNang.thuc)})` : ''}
        </span>
        {row.costCurrency !== 'VND' && <span>quy đổi từ {row.costCurrency}</span>}
      </div>

      <dl className="divide-y divide-border/60 rounded-md border border-border/60 bg-background/60">
        {ct.dong.map((d) => (
          <div key={d.ma} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <dt className="text-xs">
              {d.nhan}
              {d.ghiChu && <span className="ml-1.5 text-[10px] text-muted-foreground">{d.ghiChu}</span>}
            </dt>
            <dd className={`shrink-0 text-xs tabular-nums ${d.giaTri < 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
              {d.giaTri < 0 ? '−' : ''}{num(Math.abs(d.giaTri))}₫
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 px-3 py-2">
          <dt className="text-xs font-semibold">Cước trả carrier</dt>
          <dd className="shrink-0 text-sm font-semibold tabular-nums">{num(ct.tong)}₫</dd>
        </div>
      </dl>

      {!ct.khop && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Tổng các dòng lệch so với cước engine trả về — engine có thể vừa thêm khoản phí mới mà bảng chi tiết chưa cập nhật. Lấy số ở cột cước làm chuẩn.
        </p>
      )}

      {ct.thamChieu.map((d) => (
        <p key={d.ma} className="text-[11px] text-muted-foreground">
          {d.nhan}: {num(d.giaTri)}₫{d.ghiChu ? ` · ${d.ghiChu}` : ''}
        </p>
      ))}

      {(row.notes ?? []).length > 0 && (
        <ul className="space-y-0.5">
          {(row.notes ?? []).map((n, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">· {dichGhiChu(n)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
