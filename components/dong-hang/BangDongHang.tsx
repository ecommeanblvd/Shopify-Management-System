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
  const [, batDauBao] = useTransition();
  const [, batDauChon] = useTransition();

  const loiBaoGia = (): BaoGiaKien => ({ rows: [], reNhatKey: null, thoiGian: {}, error: 'Không báo giá được, thử lại', luc: new Date().toISOString() });

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

  const chonHang = (orderId: string, carrierKey: string) => {
    setDangChon((m) => new Map(m).set(orderId, carrierKey));
    batDauChon(async () => {
      try {
        const r = await chonHangChoDon(orderId, carrierKey);
        if (r.ok) setChonCucBo((m) => new Map(m).set(orderId, carrierKey));
        setKetQua((m) => new Map(m).set(orderId, r));
      } catch {
        setKetQua((m) => new Map(m).set(orderId, { ok: false, error: 'Không chọn được hãng, thử lại' }));
      } finally {
        setDangChon((m) => { const n = new Map(m); n.delete(orderId); return n; });
      }
    });
  };

  const nhom = nhomTheoNgayVaBase(kien);
  const chamTran = kien.length >= gioiHan;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {BO_LOC.map((l) => (
            <Link
              key={l}
              href={`/f/dong-hang?loc=${l}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                l === loc ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'
              }`}
            >
              {NHAN_LOC[l]}
            </Link>
          ))}
        </div>
        <form method="get" action="/f/dong-hang" className="flex items-center gap-1">
          <input type="hidden" name="loc" value={loc} />
          <input
            name="q" defaultValue={q} placeholder="Mã đơn / PK-…"
            className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:bg-muted">
            Tìm
          </button>
        </form>
        <span className="text-xs text-muted-foreground">{kien.length} kiện</span>
        {loc === 'cho_chon_line' && soKienChuaCan > 0 && (
          <span className="text-xs text-muted-foreground">
            · {soKienChuaCan} kiện Lark chưa nhập cân (chưa đóng xong) — xem ở “Tất cả”
          </span>
        )}
      </div>

      {choKhop.length > 0 && (
        <section className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
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
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Không có kiện nào theo bộ lọc này.
        </p>
      ) : (
        /* MỘT bảng cho cả trang: ngày và kho là hàng phân nhóm, nhờ vậy mọi cột thẳng
           hàng từ trên xuống — tách mỗi kho một bảng riêng thì mỗi bảng tự căn cột. */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[880px] text-sm tabular-nums">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                <th scope="col">Đơn</th>
                <th scope="col">Cân</th>
                <th scope="col">Hộp / SKU</th>
                <th scope="col">Khách trả</th>
                <th scope="col">Line ship</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            {nhom.map((g) => (
              <tbody key={g.ngay}>
                <tr className="border-y border-border bg-muted/60">
                  <th scope="colgroup" colSpan={6} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {hienNgayNhom(g.ngay)} · {g.theoBase.reduce((n, b) => n + b.kien.length, 0)} kiện
                    {laNgayTuongLai(g.ngay) && (
                      <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-sky-700 dark:text-sky-400">
                        Lark hẹn đi ngày này
                      </span>
                    )}
                  </th>
                </tr>
                {g.theoBase.map((b) => (
                  <Fragment key={b.base ?? 'khong-ro'}>
                    <tr className="border-b border-border/60 bg-muted/25">
                      <th scope="rowgroup" colSpan={6} className="px-3 py-1 text-left font-normal">
                        <span className="rounded bg-amber-500/15 px-1.5 py-px text-[11px] font-semibold text-amber-700 dark:text-amber-400">{b.base ?? 'chưa rõ kho'}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">{b.kien.length} kiện</span>
                      </th>
                    </tr>
                    {b.kien.map((k) => (
                      <DongKien
                        key={k.shipmentId}
                        k={k}
                        coQuyenChon={coQuyenChon}
                        chonCucBo={chonCucBo.get(k.orderId)}
                        ketQua={ketQua.get(k.orderId)}
                        dangChonHang={dangChon.get(k.orderId)}
                        moSoCuoc={() => setKienMo(k)}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            ))}
          </table>
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
    </div>
  );
}

function DongKien({
  k, coQuyenChon, chonCucBo, ketQua, dangChonHang, moSoCuoc,
}: {
  k: KienDongHang;
  coQuyenChon: boolean;
  chonCucBo: string | undefined;
  ketQua: KetQuaChon | undefined;
  dangChonHang: string | undefined;
  moSoCuoc: () => void;
}) {
  const daChon = chonCucBo ?? k.selectedCarrierKey;
  const tt = trangThaiKien({ ...k, selectedCarrierKey: daChon });
  const can = canQuyDoi(k.weightKg, k.dims);

  return (
    <tr className="border-t border-border/60 align-top">
      <td className="px-3 py-3">
        <div className="font-medium">{k.orderNumber}</div>
        {k.donDiChung.length > 0 && (
          <div className="text-[11px] leading-tight text-sky-700 dark:text-sky-400" title="Lark gộp các đơn này vào cùng một kiện">
            đi chung: {k.donDiChung.join(', ')}
          </div>
        )}
        <div className="text-[11px] leading-tight text-muted-foreground">{k.storeName}</div>
        <div className="text-[11px] leading-tight text-muted-foreground">{coNuoc(k.country)}</div>
      </td>

      <td className="px-3 py-3">
        <div>{k.weightKg != null ? `${soKg(k.weightKg)} kg` : '—'}</div>
        {k.dims && (
          <div className="text-[11px] leading-tight text-muted-foreground">
            {k.dims.l}×{k.dims.w}{k.dims.h != null ? `×${k.dims.h}` : ''}
          </div>
        )}
        {can.quyDoi != null && (
          <div className="text-[11px] leading-tight text-muted-foreground">
            quy đổi {soKg(can.quyDoi)} → tính cước {can.tinhCuoc != null ? soKg(can.tinhCuoc) : '—'}
          </div>
        )}
      </td>

      <td className="px-3 py-3">
        <div>{k.hop ?? '—'}</div>
        {k.skuText && <div className="max-w-[220px] truncate text-[11px] leading-tight text-muted-foreground" title={k.skuText}>{k.skuText}</div>}
        {k.pieces != null && <div className="text-[11px] leading-tight text-muted-foreground">{k.pieces} món</div>}
      </td>

      <td className="px-3 py-3 text-xs">{k.hangKhachTra ?? '—'}</td>

      <td className="px-3 py-3">
        {k.huy.loai === 'toan_bo' ? (
          <span className="text-xs text-red-600 dark:text-red-400">Không đi hàng</span>
        ) : k.larkMatDong ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : tt.ma === 'da_len_nhan' ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <button
              type="button" onClick={moSoCuoc}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted"
            >
              {daChon ? 'Xem / đổi line' : coQuyenChon ? 'So cước & chọn' : 'So cước'}
            </button>
            {dangChonHang && <span className="text-[10px] leading-tight text-muted-foreground">đang ghi {dangChonHang}…</span>}
            {ketQua && (
              <span className={`text-[10px] leading-tight ${
                !ketQua.ok ? 'text-red-600 dark:text-red-400'
                  : ketQua.lark && !ketQua.lark.ok ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}>
                {!ketQua.ok
                  ? ketQua.error
                  : ketQua.lark && !ketQua.lark.ok
                    ? `Lark lỗi — điền tay: ${ketQua.lark.error}`
                    : `Đã ghi Lark ✓ (${ketQua.lark?.daGhi ?? 0} dòng)`}
              </span>
            )}
          </div>
        )}
      </td>

      <td className="px-3 py-3">
        {k.larkMatDong && (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
            title="Dòng LOG-Export trên Lark đã bị xoá — kiện giữ lại để tra cứu">
            Lark đã xoá dòng
          </span>
        )}
        {k.huy.loai === 'toan_bo' && (
          <span className="rounded bg-red-500/15 px-1.5 py-px text-[10px] font-medium text-red-700 dark:text-red-400"
            title={k.huy.lyDo ?? undefined}>
            Đã huỷ{k.huy.lyDo ? ` · ${k.huy.lyDo}` : ''}
          </span>
        )}
        {k.huy.loai === 'mot_phan' && (
          <div className="mb-1">
            <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
              title={k.huy.lyDo ?? undefined}>
              Đơn huỷ {k.huy.soHuy}/{k.huy.tong} món — kiểm lại hàng trong kiện
            </span>
          </div>
        )}
        {k.huy.loai !== 'toan_bo' && tt.ma === 'cho_chon' && (
          <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400">Chờ chọn line</span>
        )}
        {tt.ma === 'da_chon' && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            Đã chọn: {tt.hang}{tt.nguoi ? ` · ${tt.nguoi}` : ''}{tt.luc ? ` · ${gioVn(tt.luc)}` : ''}
          </span>
        )}
        {tt.ma === 'da_len_nhan' && (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Đã lên nhãn · {tt.tracking}</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Modal so cước một kiện: giá của từng hãng ĐẶT CẠNH thời gian giao trung bình 30 ngày,
 * vì rẻ nhất chưa chắc là lựa chọn đúng khi hãng đó giao chậm hơn hai ngày (CEO 22/09/2026).
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
  chonHang: (orderId: string, carrierKey: string) => void;
  dong: () => void;
}) {
  const [moChiTiet, setMoChiTiet] = useState<string | null>(null);
  const can = canQuyDoi(k.weightKg, k.dims);

  // Mở modal là báo giá luôn — Đức mở đúng kiện mình đang cần, không phải bấm thêm lần nữa.
  useEffect(() => {
    if (!bao && !dangBao) soCuoc(k.shipmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k.shipmentId]);

  const rows = bao?.rows ?? [];
  const reNhatCost = rows.find((r) => r.carrierKey === bao?.reNhatKey)?.vndCost ?? null;
  // Nhanh nhất trong nhóm CÓ báo giá và chọn được — để tô đậm cạnh "rẻ nhất".
  const nhanhNhat = rows
    .filter((r) => r.ok && conChonDuoc(r) && bao?.thoiGian[r.carrierKey])
    .sort((a, b) => (bao!.thoiGian[a.carrierKey].ngayTb) - (bao!.thoiGian[b.carrierKey].ngayTb))[0]?.carrierKey ?? null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) dong(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Chọn line ship — {k.orderNumber}</DialogTitle>
          <DialogDescription>
            {[
              coNuoc(k.country),
              k.weightKg != null ? `${soKg(k.weightKg)} kg` : null,
              k.dims ? `${k.dims.l}×${k.dims.w}${k.dims.h != null ? `×${k.dims.h}` : ''}` : null,
              can.tinhCuoc != null ? `tính cước ${soKg(can.tinhCuoc)} kg` : null,
              k.hop,
              k.soKienCungDon > 1 ? `đơn có ${k.soKienCungDon} kiện — chọn một lần áp cho cả đơn` : null,
            ].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>

        {dangBao && <p className="py-6 text-center text-sm text-muted-foreground">Đang báo giá…</p>}

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                  <th scope="col" className="text-left">Hãng</th>
                  <th scope="col" className="text-right">Cước</th>
                  <th scope="col" className="text-right">So với rẻ nhất</th>
                  <th scope="col" className="text-left">Giao trung bình 30 ngày</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tg = bao.thoiGian[r.carrierKey];
                  const chonDuoc = r.ok && conChonDuoc(r);
                  const reNhat = r.carrierKey === bao.reNhatKey;
                  const ngayNgung = r.suspendedAt
                    ? new Date(r.suspendedAt).toLocaleDateString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH })
                    : null;
                  const lyDoNgung = `${r.suspendReason || 'Tạm ngưng'}${ngayNgung ? ` · từ ${ngayNgung}` : ''}`;
                  const chenh = r.ok && reNhatCost != null && r.vndCost != null ? r.vndCost - reNhatCost : null;
                  const dangMo = moChiTiet === r.accountId;
                  return (
                    <Fragment key={r.accountId}>
                      <tr className={`border-b border-border/60 ${chonDuoc ? '' : 'opacity-60'}`}>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="font-semibold">{r.carrierKey}</span>
                            {reNhat && <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400">rẻ nhất</span>}
                            {r.carrierKey === nhanhNhat && <span className="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-medium text-sky-700 dark:text-sky-400">nhanh nhất</span>}
                          </div>
                          <div className="max-w-[180px] truncate text-[11px] text-muted-foreground" title={r.carrierName}>{r.carrierName}</div>
                          {!chonDuoc && r.ok && <div className="text-[10px] text-muted-foreground">{lyDoNgung}</div>}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {r.ok ? (
                            <button type="button" onClick={() => setMoChiTiet(dangMo ? null : r.accountId)}
                              aria-expanded={dangMo} aria-controls={`ct-${r.accountId}`}
                              className={`font-semibold underline-offset-2 hover:underline ${reNhat ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                              {vnd(r.vndCost)}
                            </button>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">không báo giá được</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                          {chenh == null ? '—' : chenh === 0 ? '—' : `+${num(chenh)}₫`}
                        </td>
                        <td className="px-2 py-2">
                          {tg ? (
                            <div>
                              <span className={r.carrierKey === nhanhNhat ? 'font-semibold text-sky-700 dark:text-sky-400' : ''}>{soNgay(tg.ngayTb)} ngày</span>
                              <span className="ml-1 text-[11px] text-muted-foreground">
                                ({tg.soKien} kiện{tg.phamVi === 'chung' ? ', mọi nước' : ` đi ${k.country}`})
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">chưa có số liệu</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {!coQuyenChon ? (
                            <span className="text-[11px] text-muted-foreground">chỉ xem</span>
                          ) : !chonDuoc ? (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          ) : (
                            <button
                              type="button"
                              disabled={!!dangChonHang || daChon === r.carrierKey}
                              onClick={() => chonHang(k.orderId, r.carrierKey)}
                              className={`rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${
                                daChon === r.carrierKey
                                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                  : 'border-border hover:bg-muted'
                              }`}
                            >
                              {daChon === r.carrierKey ? '✓ đã chọn' : dangChonHang === r.carrierKey ? '…' : 'Chọn'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {dangMo && r.breakdown && <ChiTietPhi row={r} id={`ct-${r.accountId}`} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                ? `Lark lỗi — nhờ điền tay cột Couriers: ${ketQua.lark.error}`
                : `Đã ghi "${ketQua.lark?.ten}" vào cột Couriers trên Lark (${ketQua.lark?.daGhi ?? 0} dòng) — bên đóng hàng thấy được.`}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          Cước là tiền trả hãng cho kiện này. Thời gian là trung bình từ lúc tạo nhãn tới lúc giao, tính trên kiện đã giao trong 30 ngày.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Chi tiết cước của MỘT hãng cho kiện này: cước gốc, phụ phí, nhiên liệu, thuế.
 * Là tiền TRẢ CARRIER, chưa gồm đóng gói và markup của shop.
 */
function ChiTietPhi({ row, id }: { row: CarrierQuoteRow; id: string }) {
  const b = row.breakdown;
  if (!b) return null;
  // Quy mọi dòng về VND: account tính tiền ngoại tệ nhân hệ số vndCost/carrierCost.
  const heSo = row.costCurrency !== 'VND' && b.carrierCost ? (row.vndCost ?? 0) / b.carrierCost : 1;
  const ct = chiTietCuoc(b, heSo);
  const kg = (v: number) => `${soKg(Number(v.toFixed(3)))}kg`;
  return (
    <tr id={id} className="border-b border-border/40 bg-muted/30">
      <td colSpan={5} className="px-2 py-3">
        <div className="max-w-2xl space-y-2">
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
              Tổng các dòng lệch so với cước engine trả về — engine có thể vừa thêm khoản phí mới mà bảng chi tiết chưa cập nhật. Lấy số ở cột Cước làm chuẩn.
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
      </td>
    </tr>
  );
}
