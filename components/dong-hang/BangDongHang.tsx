'use client';

import { Fragment, useState, useTransition } from 'react';
import Link from 'next/link';
import { baoGiaKien, chonHangChoDon } from '@/features/dong-hang/actions';
import { canQuyDoi, conChonDuoc, nhomTheoNgay, trangThaiKien } from '@/features/dong-hang/logic';
import { BO_LOC, type BaoGiaKien, type BoLocDongHang, type KienChoKhop, type KienDongHang } from '@/features/dong-hang/types';
import { chiTietCuoc, dichGhiChu } from '@/features/carrier-rates/compare/chi-tiet-cuoc';
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';

/** Bấm "So cước cả trang" chỉ báo giá ngần này kiện đầu — nhiều hơn thì quá
 *  nhiều lượt gọi engine một lúc; phần còn lại bấm "So cước" từng dòng. */
const TRAN_SO_CA_TRANG = 50;

/** Server action văng (mất mạng, deploy giữa chừng…) — vẫn phải cho người dùng
 *  thấy lỗi và bấm lại được, không để dòng treo mãi ở "…". */
const loiBaoGia = (): BaoGiaKien => ({ rows: [], reNhatKey: null, error: 'Không báo giá được, thử lại', luc: new Date().toISOString() });

const num = (n: number) => Math.round(n).toLocaleString('vi-VN');
const vnd = (n?: number | null) => (typeof n === 'number' ? num(n) + '₫' : '—');

/** 'hh:mm dd/mm' theo giờ Việt Nam — cố định múi giờ để server và client ra cùng chuỗi. */
function gioVn(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const phan = new Intl.DateTimeFormat('en-GB', {
    timeZone: MUI_GIO_KINH_DOANH, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false,
  }).formatToParts(d);
  const lay = (t: Intl.DateTimeFormatPartTypes) => phan.find((p) => p.type === t)?.value ?? '';
  return `${lay('hour')}:${lay('minute')} ${lay('day')}/${lay('month')}`;
}

/** 'YYYY-MM-DD' (đã theo giờ VN từ nhomTheoNgay) → 'dd/mm/yyyy'. */
const hienNgayNhom = (ngay: string) => ngay.split('-').reverse().join('/');

/** Mã nước ISO-2 → cờ + mã. Mã lạ thì giữ nguyên chữ. */
function coNuoc(ma: string | null): string {
  if (!ma) return '—';
  if (!/^[A-Za-z]{2}$/.test(ma)) return ma;
  const hoa = ma.toUpperCase();
  return `${String.fromCodePoint(...[...hoa].map((c) => 127397 + c.charCodeAt(0)))} ${hoa}`;
}

const NHAN_LOC: Record<BoLocDongHang, string> = {
  chua_tracking: 'Chưa có tracking',
  hom_nay: 'Hôm nay',
  '7_ngay': '7 ngày',
  tat_ca: 'Tất cả',
};

const linkLoc = (b: BoLocDongHang, q: string) => `/f/dong-hang?loc=${b}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

interface KetQuaChon { ok: boolean; error?: string; lark?: { ok: boolean; daGhi: number; ten?: string; error?: string } }

/**
 * Bảng "Đóng hàng": mỗi dòng một KIỆN đã đóng trên Lark, nhóm theo ngày đóng
 * (giờ VN). So cước theo cân thực + kích thước CỦA KIỆN (không phải cân đơn),
 * rồi chọn line ship — hãng chọn áp cho cả ĐƠN nên mọi kiện cùng đơn đổi theo.
 */
export function BangDongHang({
  kien, choKhop, loc, q, coQuyenChon, chamTran, gioiHan,
}: {
  kien: KienDongHang[];
  choKhop: KienChoKhop[];
  loc: BoLocDongHang;
  q: string;
  coQuyenChon: boolean;
  chamTran: boolean;
  /** Trần số kiện một lượt tải (GIOI_HAN_KIEN) — chỉ để hiện đúng con số trong câu báo. */
  gioiHan: number;
}) {
  const [bao, setBao] = useState<Map<string, BaoGiaKien>>(new Map());
  const [dangBao, setDangBao] = useState<Set<string>>(new Set());
  // Riêng cho nút "So cước cả trang": nút đó chỉ mờ khi CHÍNH nó đang chạy,
  // không mờ theo vì có một dòng lẻ nào đó đang báo giá.
  const [dangCaTrang, setDangCaTrang] = useState(false);
  const [, batDauBao] = useTransition();
  // Dòng chi tiết phí đang mở, khoá `${shipmentId}|${accountId}`.
  const [moChiTiet, setMoChiTiet] = useState<string | null>(null);
  // Hãng vừa chọn tại máy này, theo orderId — để mọi kiện cùng đơn đổi ngay,
  // không đợi tải lại trang.
  const [chonCucBo, setChonCucBo] = useState<Map<string, string>>(new Map());
  const [ketQua, setKetQua] = useState<Map<string, KetQuaChon>>(new Map());
  const [dangChon, setDangChon] = useState<string | null>(null);
  const [, batDauChon] = useTransition();

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

  const soCuocCaTrang = () => {
    const ids = kien.slice(0, TRAN_SO_CA_TRANG).map((k) => k.shipmentId);
    if (ids.length === 0) return;
    setDangCaTrang(true);
    setDangBao((s) => new Set([...s, ...ids]));
    batDauBao(async () => {
      try {
        // allSettled: MỘT kiện lỗi không được kéo đổ báo giá của những kiện còn lại.
        const kq = await Promise.allSettled(ids.map((id) => baoGiaKien(id)));
        setBao((m) => {
          const n = new Map(m);
          kq.forEach((r, i) => n.set(ids[i], r.status === 'fulfilled' ? r.value : loiBaoGia()));
          return n;
        });
      } finally {
        setDangCaTrang(false);
        setDangBao((s) => { const n = new Set(s); for (const id of ids) n.delete(id); return n; });
      }
    });
  };

  const chonHang = (orderId: string, carrierKey: string) => {
    setDangChon(`${orderId}|${carrierKey}`);
    batDauChon(async () => {
      try {
        const r = await chonHangChoDon(orderId, carrierKey);
        if (r.ok) setChonCucBo((m) => new Map(m).set(orderId, carrierKey));
        setKetQua((m) => new Map(m).set(orderId, r));
      } catch {
        setKetQua((m) => new Map(m).set(orderId, { ok: false, error: 'Không chọn được hãng, thử lại' }));
      } finally {
        setDangChon(null);
      }
    });
  };

  const doiChiTiet = (khoa: string) => setMoChiTiet((x) => (x === khoa ? null : khoa));
  const quaTran = kien.length > TRAN_SO_CA_TRANG;
  const nhom = nhomTheoNgay(kien);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1">
          {BO_LOC.map((b) => (
            <Link
              key={b}
              href={linkLoc(b, q)}
              aria-current={b === loc ? 'page' : undefined}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                b === loc
                  ? 'border-emerald-500/50 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400'
                  : 'border-border hover:bg-muted'
              }`}
            >
              {NHAN_LOC[b]}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <form method="get" action="/f/dong-hang" className="flex items-center gap-1">
            <input type="hidden" name="loc" value={loc} />
            <input
              name="q" defaultValue={q} placeholder="Mã đơn / PK-…" aria-label="Tìm theo mã đơn hoặc mã kiện"
              className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
            <button type="submit" className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted">
              Tìm
            </button>
          </form>
          <button
            type="button" onClick={soCuocCaTrang}
            disabled={dangCaTrang || kien.length === 0}
            title={quaTran ? `Chỉ báo giá ${TRAN_SO_CA_TRANG} kiện đầu — những kiện sau bấm “So cước” từng dòng, hoặc thu hẹp bộ lọc.` : undefined}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
          >
            {dangCaTrang ? 'Đang so cước…' : quaTran ? `So cước ${TRAN_SO_CA_TRANG} kiện đầu` : 'So cước cả trang'}
          </button>
        </div>
      </div>

      {chamTran && (
        <p className="text-xs text-muted-foreground">
          Chỉ hiện {gioiHan} kiện mới nhất — thu hẹp bộ lọc hoặc tìm theo mã đơn.
        </p>
      )}

      {choKhop.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
          <h2 className="text-xs font-semibold uppercase tracking-wider">Không khớp đơn SMS ({choKhop.length})</h2>
          <ul className="mt-1 space-y-0.5">
            {choKhop.map((c) => (
              <li key={c.recordId} className="text-[11px] leading-snug">
                {[
                  c.logUniqueCode, c.orderNumber,
                  c.weightKg != null ? `${c.weightKg} kg` : null,
                  c.dims, c.hop, c.lyDo, gioVn(c.nhanLuc),
                ].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {kien.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Không có kiện nào theo bộ lọc này.
        </p>
      ) : (
        nhom.map((g) => (
          <section key={g.ngay} className="rounded-lg border border-border">
            <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {hienNgayNhom(g.ngay)} · {g.kien.length} kiện
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                    <th scope="col">Đơn</th>
                    <th scope="col">Cân</th>
                    <th scope="col">Hộp / SKU</th>
                    <th scope="col">Khách trả</th>
                    <th scope="col">So cước</th>
                    <th scope="col">Chọn</th>
                    <th scope="col">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {g.kien.map((k) => (
                    <DongKien
                      key={k.shipmentId}
                      k={k}
                      bao={bao.get(k.shipmentId)}
                      dangBao={dangBao.has(k.shipmentId)}
                      moChiTiet={moChiTiet}
                      doiChiTiet={doiChiTiet}
                      soCuoc={soCuoc}
                      coQuyenChon={coQuyenChon}
                      chonCucBo={chonCucBo.get(k.orderId)}
                      ketQua={ketQua.get(k.orderId)}
                      dangChon={dangChon}
                      chonHang={chonHang}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function DongKien({
  k, bao, dangBao, moChiTiet, doiChiTiet, soCuoc, coQuyenChon, chonCucBo, ketQua, dangChon, chonHang,
}: {
  k: KienDongHang;
  bao: BaoGiaKien | undefined;
  dangBao: boolean;
  moChiTiet: string | null;
  doiChiTiet: (khoa: string) => void;
  soCuoc: (shipmentId: string) => void;
  coQuyenChon: boolean;
  chonCucBo: string | undefined;
  ketQua: KetQuaChon | undefined;
  dangChon: string | null;
  chonHang: (orderId: string, carrierKey: string) => void;
}) {
  const daChon = chonCucBo ?? k.selectedCarrierKey;
  const tt = trangThaiKien({ ...k, selectedCarrierKey: daChon });
  const can = canQuyDoi(k.weightKg, k.dims);
  const rows = bao?.rows ?? [];
  const moRow = rows.find((r) => moChiTiet === `${k.shipmentId}|${r.accountId}`);
  const chonDuocRows = rows.filter((r) => r.ok && conChonDuoc(r));
  // Chỉ khoá nút khi CHÍNH đơn này đang được gán hãng — đơn khác vẫn bấm được.
  const donDangChon = dangChon?.startsWith(`${k.orderId}|`) ?? false;

  return (
    <Fragment>
      <tr className="border-t border-border/60 align-top">
        <td className="px-3 py-3">
          <div className="font-semibold">{k.orderNumber}</div>
          <div className="text-[11px] leading-tight text-muted-foreground">{k.storeName}</div>
          <div className="text-[11px] leading-tight text-muted-foreground">{coNuoc(k.country)}</div>
        </td>

        <td className="px-3 py-3">
          <div>{k.weightKg != null ? `${k.weightKg} kg` : '—'}</div>
          {k.dims && (
            <div className="text-[11px] leading-tight text-muted-foreground">
              {k.dims.l}×{k.dims.w}{k.dims.h != null ? `×${k.dims.h}` : ''}
            </div>
          )}
          {can.quyDoi != null && (
            <div className="text-[11px] leading-tight text-muted-foreground">
              quy đổi {can.quyDoi} → tính cước {can.tinhCuoc ?? '—'}
            </div>
          )}
        </td>

        <td className="px-3 py-3">
          <div>{k.hop ?? '—'}</div>
          {k.skuText && <div className="max-w-[200px] truncate text-[11px] leading-tight text-muted-foreground" title={k.skuText}>{k.skuText}</div>}
          {k.pieces != null && <div className="text-[11px] leading-tight text-muted-foreground">{k.pieces} món</div>}
        </td>

        <td className="px-3 py-3 text-xs">{k.hangKhachTra ?? '—'}</td>

        <td className="px-3 py-3" aria-busy={dangBao || undefined}>
          {dangBao ? (
            <span className="text-xs text-muted-foreground">…</span>
          ) : !bao ? (
            <button type="button" onClick={() => soCuoc(k.shipmentId)}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted">
              So cước
            </button>
          ) : bao.error ? (
            <div className="flex flex-col items-start gap-1">
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{bao.error}</span>
              <button type="button" onClick={() => soCuoc(k.shipmentId)}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition hover:bg-muted">
                Thử lại
              </button>
            </div>
          ) : (
            <div className="flex max-w-[320px] flex-wrap items-center gap-1">
              {rows.map((r) => {
                if (!r.ok) {
                  return (
                    <span key={r.accountId} title={r.error}
                      className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                      {r.carrierKey} — không báo giá được
                    </span>
                  );
                }
                const reNhat = r.carrierKey === bao.reNhatKey;
                const chonDuoc = conChonDuoc(r);
                const khoa = `${k.shipmentId}|${r.accountId}`;
                const ngayNgung = r.suspendedAt
                  ? new Date(r.suspendedAt).toLocaleDateString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH })
                  : null;
                const lyDoNgung = `${r.suspendReason || 'Tạm ngưng'}${ngayNgung ? ` · từ ${ngayNgung}` : ''}`;
                return (
                  <button
                    key={r.accountId} type="button"
                    aria-expanded={moChiTiet === khoa}
                    aria-controls={`chi-tiet-${k.shipmentId}-${r.accountId}`}
                    title={chonDuoc ? 'Bấm để xem cách tính giá' : lyDoNgung}
                    onClick={() => doiChiTiet(khoa)}
                    className={`rounded px-1.5 py-px text-[10px] transition ${
                      reNhat
                        ? 'bg-emerald-500/15 font-semibold text-emerald-700 dark:text-emerald-400'
                        : 'bg-muted hover:bg-muted/70'
                    } ${chonDuoc ? '' : 'opacity-50'}`}
                  >
                    {r.carrierKey} — {vnd(r.vndCost)}
                  </button>
                );
              })}
            </div>
          )}
        </td>

        <td className="px-3 py-3">
          {!coQuyenChon ? (
            <span className="text-xs text-muted-foreground">Chỉ xem</span>
          ) : tt.ma === 'da_len_nhan' ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : !bao || bao.error || chonDuocRows.length === 0 ? (
            <span className="text-xs text-muted-foreground">So cước trước</span>
          ) : (
            <div className="flex flex-col items-start gap-1">
              <div className="flex flex-wrap gap-1">
                {chonDuocRows.map((r) => (
                  <button
                    key={r.accountId} type="button"
                    disabled={donDangChon || daChon === r.carrierKey}
                    onClick={() => chonHang(k.orderId, r.carrierKey)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:opacity-60 ${
                      daChon === r.carrierKey
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {daChon === r.carrierKey ? `✓ ${r.carrierKey}` : dangChon === `${k.orderId}|${r.carrierKey}` ? '…' : `Chọn ${r.carrierKey}`}
                  </button>
                ))}
              </div>
              {k.soKienCungDon > 1 && (
                <span className="text-[10px] leading-tight text-muted-foreground">áp cho {k.soKienCungDon} kiện</span>
              )}
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
          {tt.ma === 'cho_chon' && (
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

      {moRow && <ChiTietPhi row={moRow} id={`chi-tiet-${k.shipmentId}-${moRow.accountId}`} />}
    </Fragment>
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
  const kg = (v: number) => `${Number(v.toFixed(3))}kg`;
  return (
    <tr id={id} className="border-t border-border/40 bg-muted/30">
      <td colSpan={7} className="px-3 py-3">
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
              Tổng các dòng lệch so với cước engine trả về — engine có thể vừa thêm khoản phí mới mà bảng chi tiết chưa cập nhật. Lấy số ở chip giá làm chuẩn.
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
