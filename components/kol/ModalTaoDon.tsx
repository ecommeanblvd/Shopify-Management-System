'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { taoDon } from '@/features/kol/actions';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import {
  Dialog, DialogContent, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { buttonVariants } from '@/components/ui/button';
import { Stepper } from '@/components/kol/Stepper';
import { ChonSanPham } from '@/components/kol/ChonSanPham';
import { TagLoai } from '@/components/kol/TagLoai';
import type { NguoiNhan } from '@/features/kol/queries';
import type { HinhThuc, KetQuaBienThe, LoaiNguoiNhan } from '@/features/kol/types';
import { TIEN_TO_MA } from '@/features/kol/types';
import { boDauTiengViet } from '@/features/kol/bo-dau';
import { thangKinhDoanh } from '@/lib/timezone';

interface DongState {
  key: string;
  sku: string;
  /** Ghim theo ID chứ không chỉ SKU — SKU của brand đổi liên tục (CEO 24/09). */
  shopifyVariantId: string | null;
  tenHang: string;
  kho: string;
  soLuong: number;
  /** Tồn khả dụng TỪNG KHO, lấy một lần lúc chọn sản phẩm — đổi kho không phải
   *  gọi lại server, chỉ đọc lại từ mảng này. */
  tonTheoKho: { kho: string; ton: number }[];
  giaVon: number | null;
  giaVonTienTe: string | null;
}

function dongMoi(): DongState {
  return {
    key: crypto.randomUUID(),
    sku: '', shopifyVariantId: null, tenHang: '', kho: WAREHOUSE_PRIORITY[0], soLuong: 1,
    tonTheoKho: [], giaVon: null, giaVonTienTe: null,
  };
}

const so = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v));
const tien = (v: number, tt: string | null) => (tt && tt !== 'VND' ? `${so(v)} ${tt}` : `${so(v)} ₫`);

/** Tồn của dòng tại kho đang chọn. Chưa chọn sản phẩm → null (chưa biết, khác 0). */
function tonCuaDong(d: DongState): number | null {
  if (!d.sku) return null;
  return d.tonTheoKho.find((t) => t.kho === d.kho)?.ton ?? 0;
}

function chuCaiDau(ten: string): string {
  return ten.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
}

/**
 * Modal "Tạo đơn xuất hàng" — dựng theo bản thiết kế `design_handoff_kol_order_modal`
 * (CEO giao 24/09/2026).
 *
 * Ba điểm bám sát thiết kế, khác bản trước:
 *  - LOẠI người nhận (KOL / Production House) đến từ SỔ, người dùng không chọn
 *    tay; nó quyết định tag và tiền tố mã đơn. Trường "Mục đích" cũ bỏ hẳn.
 *  - HÌNH THỨC (Tặng / Cho mượn) và HẠN THU HỒI đặt ở cấp ĐƠN, áp cho mọi dòng.
 *    Schema vẫn giữ hai cột đó ở cấp DÒNG (không phải di dời gì) — lúc gửi thì
 *    ghi cùng một giá trị xuống mọi dòng. Giữ được khả năng tách theo dòng sau.
 *  - Dòng hàng là BẢNG, không phải chồng thẻ; tồn và giá vốn lấy sẵn từ lượt
 *    tìm nên đổi kho / đổi số lượng không gọi thêm server lần nào.
 *
 * Cảnh báo vượt tồn và thiếu giá vốn KHÔNG chặn tạo nháp — nháp chưa đụng tồn.
 */
export function ModalTaoDon({ nguoiNhan }: { nguoiNhan: NguoiNhan[] }) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [nguoiNhanId, setNguoiNhanId] = useState('');
  const [timNhan, setTimNhan] = useState('');
  const [hinhThuc, setHinhThuc] = useState<HinhThuc>('tang');
  const [hanTra, setHanTra] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [dong, setDong] = useState<DongState[]>([dongMoi()]);
  const [picker, setPicker] = useState<'them' | string | null>(null);

  const chonDuoc = useMemo(() => nguoiNhan.filter((n) => !n.ngungDung), [nguoiNhan]);
  const daChon = chonDuoc.find((n) => n.id === nguoiNhanId) ?? null;

  const ketQuaNhan = useMemo(() => {
    const k = boDauTiengViet(timNhan.trim());
    if (!k) return chonDuoc.slice(0, 8);
    return chonDuoc
      .filter((n) => boDauTiengViet(`${n.ten} ${n.kenh ?? ''} ${n.dienThoai ?? ''}`).includes(k))
      .slice(0, 8);
  }, [chonDuoc, timNhan]);

  const capNhat = (key: string, patch: Partial<DongState>) =>
    setDong((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  function onChonSanPham(bt: KetQuaBienThe) {
    const chonKhoCoHang = bt.tonTheoKho.find((t) => t.ton > 0)?.kho ?? WAREHOUSE_PRIORITY[0];
    if (picker === 'them') {
      setDong((prev) => [...prev, {
        ...dongMoi(), sku: bt.sku, shopifyVariantId: bt.shopifyVariantId, tenHang: bt.tenHang, kho: chonKhoCoHang,
        tonTheoKho: bt.tonTheoKho, giaVon: bt.giaVon, giaVonTienTe: bt.giaVonTienTe,
      }]);
    } else if (picker) {
      // Chế độ THAY: giữ nguyên kho và số lượng, chỉ đổi sản phẩm (theo thiết kế).
      capNhat(picker, {
        sku: bt.sku, shopifyVariantId: bt.shopifyVariantId, tenHang: bt.tenHang,
        tonTheoKho: bt.tonTheoKho, giaVon: bt.giaVon, giaVonTienTe: bt.giaVonTienTe,
      });
    }
  }

  const tongSl = dong.reduce((a, d) => a + (d.sku ? d.soLuong : 0), 0);
  const tongGiaVon = dong.reduce((a, d) => a + (d.giaVon != null ? d.giaVon * d.soLuong : 0), 0);
  const soVuotTon = dong.filter((d) => { const t = tonCuaDong(d); return t != null && d.soLuong > t; }).length;
  const soThieuGia = dong.filter((d) => d.sku && d.giaVon == null).length;

  const maPreview = daChon
    ? `${TIEN_TO_MA[daChon.loai as LoaiNguoiNhan]}-${(thangKinhDoanh(new Date()) ?? '').replace('-', '').slice(-4)}-…`
    : 'Mã đơn tự sinh theo người nhận';

  const thieuHan = hinhThuc === 'muon' && !hanTra;
  const coTheTao = Boolean(nguoiNhanId) && dong.some((d) => d.sku) && !thieuHan;

  function resetForm() {
    setErr(null); setNguoiNhanId(''); setTimNhan(''); setHinhThuc('tang');
    setHanTra(''); setGhiChu(''); setDong([dongMoi()]); setPicker(null);
  }

  const submit = () =>
    start(async () => {
      setErr(null);
      if (!nguoiNhanId) { setErr('Phải chọn người nhận.'); return; }
      const coHang = dong.filter((d) => d.sku.trim());
      if (coHang.length === 0) { setErr('Phải có ít nhất một dòng hàng.'); return; }
      if (thieuHan) { setErr('Cho mượn thì bắt buộc có hạn thu hồi.'); return; }

      const fd = new FormData();
      fd.set('nguoiNhanId', nguoiNhanId);
      fd.set('ghiChu', ghiChu);
      // Hình thức + hạn thu hồi là của cả ĐƠN nhưng schema lưu theo DÒNG —
      // ghi cùng một giá trị xuống mọi dòng.
      fd.set('dong', JSON.stringify(coHang.map((d) => ({
        sku: d.sku.trim(),
        shopifyVariantId: d.shopifyVariantId ?? undefined,
        tenHang: d.tenHang.trim() || undefined,
        kho: d.kho,
        soLuong: d.soLuong,
        hinhThuc,
        hanTra: hinhThuc === 'muon' ? hanTra : undefined,
        giaVon: d.giaVon != null ? String(d.giaVon) : undefined,
        giaVonTienTe: d.giaVon != null ? (d.giaVonTienTe ?? 'VND') : undefined,
      }))));

      const r = await taoDon(fd);
      if (!r.ok) { setErr(r.loi ?? 'Có lỗi xảy ra.'); return; }
      setOpenDialog(false);
      resetForm();
      if (r.ma) router.push(`/f/kol/${r.ma}`);
    });

  return (
    <Dialog open={openDialog} onOpenChange={(v) => { setOpenDialog(v); if (!v) resetForm(); }}>
      <DialogTrigger className={buttonVariants({})}>+ Tạo đơn</DialogTrigger>
      {/*
        KHÔNG thêm `relative` vào đây. DialogContent gốc là
        `fixed top-1/2 left-1/2 -translate-*`; `relative` sẽ ĐÈ MẤT `fixed`,
        modal rơi khỏi lớp nổi và tụt xuống cuối luồng trang (CEO báo 24/09).
        Phần tử `fixed` vốn đã là gốc toạ độ cho con `absolute`, nên popup tìm
        sản phẩm neo đúng mà không cần `relative`.

        `flex flex-col` đè `grid` của bản gốc: vùng dòng hàng phải là chỗ CUỘN
        (`min-h-0 flex-1`), mà `flex-1` không có tác dụng trong grid — để grid
        thì `overflow-hidden` cắt cụt danh sách thay vì cho cuộn.
      */}
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-3 px-6 pb-4 pt-[18px]">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em]">Tạo đơn xuất hàng</DialogTitle>
              <span
                className={`rounded-md px-2 py-[3px] font-mono text-[12px] ${
                  daChon ? 'border border-border text-foreground' : 'border border-dashed border-border text-muted-foreground'
                }`}
              >
                {maPreview}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Nháp — chưa đụng tồn kho, chốt đơn mới giữ chỗ</p>
          </div>
        </div>

        {/* ── Thông tin đơn ──────────────────────────────────────── */}
        <div className="flex shrink-0 flex-col gap-2.5 px-6 pb-[18px]">
          <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_320px]">
            {/* Người nhận */}
            <div className="relative">
              {daChon ? (
                <div className="flex h-10 items-center gap-2 rounded-[9px] border border-border bg-input px-2.5">
                  <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-primary/20 text-[11px] font-semibold">
                    {chuCaiDau(daChon.ten)}
                  </span>
                  <span className="shrink-0 text-sm font-medium">{daChon.ten}</span>
                  <TagLoai loai={daChon.loai} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{daChon.kenh ?? ''}</span>
                  <button
                    type="button"
                    onClick={() => { setNguoiNhanId(''); setTimNhan(''); }}
                    className="shrink-0 cursor-pointer text-[12px] font-medium text-primary hover:underline"
                  >
                    Đổi
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={timNhan}
                    onChange={(e) => setTimNhan(e.target.value)}
                    placeholder="Người nhận — gõ tên, SĐT hoặc @handle"
                    aria-label="Tìm người nhận theo tên, số điện thoại hoặc handle"
                    className="h-10 w-full rounded-[9px] border border-border bg-input px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                  />
                  {timNhan.trim() !== '' && (
                    <div className="absolute left-0 top-[46px] z-10 w-full rounded-[10px] border border-border bg-card p-1.5 shadow-xl">
                      {ketQuaNhan.length === 0 ? (
                        <p className="px-2.5 py-3 text-[13px] text-muted-foreground">Không tìm thấy người nhận.</p>
                      ) : ketQuaNhan.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => { setNguoiNhanId(n.id); setTimNhan(''); }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                        >
                          <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-primary/20 text-[11px] font-semibold">
                            {chuCaiDau(n.ten)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{n.ten}</span>
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {[n.kenh, n.dienThoai, n.quocGia !== 'VN' ? n.quocGia : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <TagLoai loai={n.loai} />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Hình thức — áp cho CẢ ĐƠN */}
            <div
              className="flex h-10 items-center gap-[3px] rounded-[9px] border border-border bg-input p-[3px]"
              role="radiogroup"
              aria-label="Hình thức xuất hàng"
            >
              {([['tang', 'Tặng', 'không thu hồi'], ['muon', 'Cho mượn', 'cần thu hồi']] as const).map(([v, chinh, phu]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={hinhThuc === v}
                  onClick={() => { setHinhThuc(v); if (v === 'tang') setHanTra(''); }}
                  className={`flex h-full flex-1 cursor-pointer flex-col items-center justify-center rounded-md leading-tight ${
                    hinhThuc === v ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="text-[13px]">{chinh}</span>
                  <span className="text-[11px] opacity-75">{phu}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 md:flex-row">
            <input
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              placeholder="Ghi chú (không bắt buộc)"
              aria-label="Ghi chú"
              className="h-[34px] min-w-0 flex-1 rounded-lg border border-transparent bg-muted px-3 text-[13px] outline-none focus:border-border"
            />
            {hinhThuc === 'muon' && (
              <label className="flex h-[34px] w-full shrink-0 items-center gap-2 rounded-lg border border-primary/35 bg-primary/10 px-2.5 md:w-[320px]">
                <span className="shrink-0 text-[12px] font-medium text-primary">Hạn thu hồi *</span>
                <input
                  type="date"
                  value={hanTra}
                  onChange={(e) => setHanTra(e.target.value)}
                  required
                  aria-label="Hạn thu hồi"
                  className="min-w-0 flex-1 rounded border-none bg-background px-1.5 py-0.5 text-[13px] outline-none"
                />
              </label>
            )}
          </div>
        </div>

        {/* ── Dòng hàng ──────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border bg-muted px-6 pb-3 pt-4">
          <div className="mb-2 flex items-baseline gap-3">
            <h2 className="text-[15px] font-semibold">Dòng hàng</h2>
            <p className="text-[12px] tabular-nums text-muted-foreground">
              {dong.filter((d) => d.sku).length} dòng · {tongSl} sản phẩm
              {tongGiaVon > 0 && ` · giá vốn ${so(tongGiaVon)} ₫`}
            </p>
          </div>

          <div className="grid grid-cols-[20px_minmax(0,1fr)_84px_110px_110px_28px] gap-3 border-b border-border pb-2 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <span /><span>Sản phẩm</span><span>Kho</span><span>Số lượng</span><span className="text-right">Giá vốn</span><span />
          </div>

          {dong.map((d, i) => {
            const ton = tonCuaDong(d);
            const vuot = ton != null && d.soLuong > ton;
            return (
              <div key={d.key} className="grid grid-cols-[20px_minmax(0,1fr)_84px_110px_110px_28px] items-center gap-3 border-b border-border/60 py-2.5">
                <span className="text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>

                <button
                  type="button"
                  onClick={() => setPicker(d.key)}
                  className="min-w-0 cursor-pointer rounded-[7px] px-1.5 py-1 text-left hover:bg-border/40"
                >
                  {d.sku ? (
                    <>
                      <span className="block truncate font-mono text-[13px] font-semibold">{d.sku}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {d.tenHang}
                        {ton != null && (
                          <span className={vuot ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                            {' · '}Tồn {ton}{vuot && ` · thiếu ${d.soLuong - ton}`}
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">Bấm để chọn sản phẩm…</span>
                  )}
                </button>

                <select
                  value={d.kho}
                  onChange={(e) => capNhat(d.key, { kho: e.target.value })}
                  aria-label={`Kho cho dòng ${i + 1}`}
                  className="h-[34px] w-full cursor-pointer rounded-lg border border-border bg-background px-1.5 text-[13px]"
                >
                  {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>

                <Stepper
                  value={d.soLuong}
                  onChange={(v) => capNhat(d.key, { soLuong: v })}
                  ariaLabel={`Số lượng dòng ${i + 1}`}
                  canhBao={vuot}
                />

                <span className="text-right text-[13px] tabular-nums">
                  {d.giaVon == null
                    ? <span className="text-muted-foreground">Chưa có</span>
                    : <span className="font-medium">{tien(d.giaVon * d.soLuong, d.giaVonTienTe)}</span>}
                </span>

                <button
                  type="button"
                  onClick={() => setDong((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== d.key) : prev))}
                  disabled={dong.length <= 1}
                  aria-label={`Xoá dòng ${i + 1}`}
                  className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-border/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setPicker('them')}
            className="mt-2 h-8 cursor-pointer rounded-lg px-2.5 text-[13px] font-medium text-primary hover:bg-primary/10"
          >
            + Thêm dòng
          </button>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-4 border-t border-border px-6 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">
              {daChon
                ? `Gửi ${daChon.ten} · ${hinhThuc === 'tang' ? 'Tặng, không thu hồi' : 'Cho mượn, cần thu hồi'}`
                : 'Chưa chọn người nhận'}
            </p>
            {(soVuotTon > 0 || soThieuGia > 0) && (
              <p className="truncate text-[12px] text-amber-600 dark:text-amber-400">
                {[
                  soVuotTon > 0 && `${soVuotTon} dòng vượt tồn — chốt đơn sẽ lỗi tới khi nhập thêm`,
                  soThieuGia > 0 && `${soThieuGia} dòng chưa có giá vốn — chưa vào báo cáo chi phí`,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            {err && <p className="truncate text-[12px] text-red-600 dark:text-red-400">{err}</p>}
          </div>
          <button
            type="button"
            onClick={() => setOpenDialog(false)}
            className="h-[38px] shrink-0 cursor-pointer rounded-lg border border-border px-4 text-sm hover:bg-muted"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!coTheTao || pending}
            className="h-[38px] shrink-0 cursor-pointer rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Đang tạo…' : 'Tạo đơn nháp'}
          </button>
        </div>

        {picker && (
          <ChonSanPham
            che_do={picker}
            onChon={onChonSanPham}
            onDong={() => setPicker(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
