'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dayLaiDongLoi, ghiNhanKcs } from '@/features/kho-nhan/actions';
import { QC_CHECK, WAREHOUSE, WH_ACTION, type QcCheck, type WhAction, type Warehouse } from '@/features/kho-nhan/gia-tri-lark';
import { actionMacDinh } from '@/features/kho-nhan/luat';
import type { MonCuaDon, listDaXuLyHomNay } from '@/features/kho-nhan/queries';
import { xuLyQuet, type MonDeQuet } from '@/features/kho-nhan/quet';
import { traDonCuaDong, traDonCoBienThe } from '@/features/kho-nhan/quet-actions';
import { docMaTem } from '@/features/receiving/ma-tem';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';
import { OQuet } from './OQuet';

type DongHomNay = Awaited<ReturnType<typeof listDaXuLyHomNay>>[number];
type KetQuaGhi = Awaited<ReturnType<typeof ghiNhanKcs>>;

/** Kho chọn lần trước — người của một kho bấm cả ngày, không bắt chọn lại mỗi món. */
const KHOA_KHO = 'kho-nhan-warehouse';

const gioVn = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const laQc = (v: string | undefined): v is QcCheck => !!v && (QC_CHECK as readonly string[]).includes(v);
const laAction = (v: string | undefined): v is WhAction => !!v && (WH_ACTION as readonly string[]).includes(v);
const laKho = (v: string | null): v is Warehouse => !!v && (WAREHOUSE as readonly string[]).includes(v);

const O_NHAP = 'h-9 w-full rounded-md border border-input bg-input/30 px-2.5 text-sm outline-none focus:border-amber-500/60 disabled:opacity-50';
/** Bản điện thoại của O_NHAP — ô to hơn cho ngón tay (spec §5 "ô nhập lớn"). */
const O_NHAP_LON = 'h-11 w-full rounded-md border border-input bg-input/30 px-3 text-base outline-none focus:border-amber-500/60 disabled:opacity-50';
const NUT_CHINH = 'h-9 rounded-lg bg-amber-500 px-5 text-[13px] font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50';
/** Bản điện thoại của NUT_CHINH — chạy hết chiều ngang (spec §5 "nút Lưu w-full py-3"). */
const NUT_CHINH_LON = 'w-full rounded-lg bg-amber-500 py-3 text-sm font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50';

export function BangNhanKcs({ don, mon, loiLark, homNay, coQuyenNhap }: {
  don: string;
  mon: MonCuaDon[];
  /** Đọc bảng kho Lark hỏng — vẫn nhập được nhưng kho phải biết là màn KHÔNG thấy kết quả cũ. */
  loiLark: string | null;
  homNay: DongHomNay[];
  coQuyenNhap: boolean;
}) {
  // Đọc kho đã chọn lần trước NGAY khi dựng state (không setState trong effect — gây render
  // dây chuyền). Lần dựng đầu trên máy chủ không có localStorage nên trả kho mặc định.
  const [kho, setKho] = useState<Warehouse>(() => {
    try {
      const luu = typeof window === 'undefined' ? null : localStorage.getItem(KHOA_KHO);
      return laKho(luu) ? luu : WAREHOUSE[0];
    } catch {
      return WAREHOUSE[0];
    }
  });
  const doiKho = (w: Warehouse) => {
    setKho(w);
    try { localStorage.setItem(KHOA_KHO, w); } catch { /* không lưu được thì thôi */ }
  };

  // Bảng món trong SMS lưu mã đơn KHÔNG có '#', gửi Lark cũng phải cùng nếp đó.
  const donTran = don.trim().replace(/^#/, '');

  const router = useRouter();
  /** Món vừa được quét chọn — tô sáng 3 giây rồi tự tắt. */
  const [monSang, setMonSang] = useState<string | null>(null);
  /** Mã quét không nhận ra — dải đỏ tự tắt sau 4 giây. */
  const [khongHieu, setKhongHieu] = useState<string | null>(null);
  /** Mã dòng đơn thuộc đơn KHÁC đơn đang mở — hỏi trước khi nhảy, không tự chuyển. */
  const [hoiChuyenDon, setHoiChuyenDon] = useState<{ orderNumber: string } | null>(null);
  /** Quét mã biến thể khi chưa mở đơn nào — danh sách đơn đang chờ có hàng này (rỗng = không thấy). */
  const [dsBienThe, setDsBienThe] = useState<Array<{ orderNumber: string; sku: string | null }> | null>(null);
  const [, batDauTraCuuQuet] = useTransition();

  const xuLyQuetManHinh = useCallback((raw: string) => {
    setKhongHieu(null);
    setHoiChuyenDon(null);
    setDsBienThe(null);
    const ds: MonDeQuet[] = mon.map((m) => ({
      dinhDanh: m.dinhDanh,
      sku: m.sku,
      shopifyLineId: m.shopifyLineId,
      shopifyVariantId: m.shopifyVariantId,
      daXuLy: m.daNhan != null,
    }));
    const ket = xuLyQuet(raw, ds);
    switch (ket.loai) {
      case 'mo_don': {
        router.push(`/f/warehouse/nhan-kcs?donId=${encodeURIComponent(ket.shopifyOrderId)}`);
        return;
      }
      case 'chon_mon': {
        const dinhDanh = ket.dinhDanh;
        setMonSang(dinhDanh);
        document.getElementById(`mon-${dinhDanh}`)?.scrollIntoView({ block: 'center' });
        // Trên máy tính, sau khi quét con trỏ nhảy thẳng vào ô cân — gõ số, Enter là lưu và
        // sang món kế, không rời tay khỏi bàn phím (spec §5). Đợi một nhịp cho scrollIntoView.
        setTimeout(() => (document.getElementById(`can-${dinhDanh}`) as HTMLInputElement | null)?.focus(), 300);
        setTimeout(() => setMonSang((cur) => (cur === dinhDanh ? null : cur)), 3000);
        return;
      }
      case 'don_khac': {
        // xuLyQuet không mang theo shopifyLineId gốc trong kết quả 'don_khac' — đọc lại từ raw.
        const ma = docMaTem(raw);
        if (!ma || ma.loai !== 'dong') {
          const r = raw;
          setKhongHieu(r);
          setTimeout(() => setKhongHieu((cur) => (cur === r ? null : cur)), 4000);
          return;
        }
        const shopifyLineId = ma.shopifyLineId;
        batDauTraCuuQuet(async () => {
          const donCuaDong = await traDonCuaDong(shopifyLineId);
          if (donCuaDong) {
            setHoiChuyenDon(donCuaDong);
          } else {
            setKhongHieu(raw);
            setTimeout(() => setKhongHieu((cur) => (cur === raw ? null : cur)), 4000);
          }
        });
        return;
      }
      case 'tim_bien_the': {
        batDauTraCuuQuet(async () => {
          const ds2 = await traDonCoBienThe(ket.shopifyVariantId);
          setDsBienThe(ds2);
        });
        return;
      }
      case 'khong_hieu': {
        const r = ket.raw;
        setKhongHieu(r);
        setTimeout(() => setKhongHieu((cur) => (cur === r ? null : cur)), 4000);
        return;
      }
    }
  }, [mon, router]);

  return (
    <div className="space-y-5">
      <OQuet onQuet={xuLyQuetManHinh} />

      {khongHieu && (
        <p className="rounded-md border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          Không nhận ra mã: {khongHieu}
        </p>
      )}

      {hoiChuyenDon && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <span>Mã này thuộc đơn #{hoiChuyenDon.orderNumber} — chuyển sang đơn đó?</span>
          <button
            type="button"
            onClick={() => { router.push(`/f/warehouse/nhan-kcs?don=${encodeURIComponent(hoiChuyenDon.orderNumber)}`); setHoiChuyenDon(null); }}
            className="rounded-md border border-amber-500 bg-amber-500/10 px-2 py-0.5 font-medium hover:bg-amber-500/20"
          >
            Chuyển
          </button>
          <button
            type="button"
            onClick={() => setHoiChuyenDon(null)}
            className="rounded-md border border-border px-2 py-0.5 hover:bg-muted"
          >
            Bỏ qua
          </button>
        </div>
      )}

      {dsBienThe && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          {dsBienThe.length === 0 && <p className="text-muted-foreground">Không thấy đơn nào đang chờ có hàng này.</p>}
          {dsBienThe.length > 0 && (
            <>
              <p className="text-muted-foreground">Các đơn đang chờ có hàng này:</p>
              <div className="flex flex-wrap gap-1.5">
                {dsBienThe.slice(0, 5).map((d) => (
                  <button
                    // Một đơn có thể xuất hiện nhiều lần với SKU khác nhau (danh sách chỉ bỏ
                    // trùng theo đơn+SKU), nên khoá React phải gồm cả SKU — lấy mỗi orderNumber
                    // là trùng khoá, React bỏ mất nút.
                    key={`${d.orderNumber} ${d.sku ?? ''}`}
                    type="button"
                    onClick={() => { router.push(`/f/warehouse/nhan-kcs?don=${encodeURIComponent(d.orderNumber)}`); setDsBienThe(null); }}
                    className="rounded-md border border-border bg-card px-2 py-1 font-medium hover:bg-muted"
                  >
                    #{d.orderNumber}{d.sku ? ` · ${d.sku}` : ''}
                  </button>
                ))}
              </div>
              {dsBienThe.length > 5 && (
                // Cắt còn 5 nút mà không nói gì thì kho tưởng chỉ có 5 đơn đang chờ hàng này.
                <p className="text-muted-foreground">
                  … và {dsBienThe.length - 5} đơn nữa — gõ mã đơn vào ô bên dưới nếu không thấy đơn cần tìm.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <form action="/f/warehouse/nhan-kcs" className="flex flex-wrap items-center gap-2">
        <input
          name="don"
          defaultValue={don}
          autoComplete="off"
          placeholder="Mã đơn — gõ hoặc quét"
          className="h-9 w-72 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus:border-amber-500/60"
        />
        <button type="submit" className={NUT_CHINH}>Tìm</button>
      </form>

      {!coQuyenNhap && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Bạn chỉ xem được — không có quyền ghi kết quả nhận hàng.
        </p>
      )}

      {loiLark && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Chưa đọc được bảng kho trên Lark ({loiLark}) — màn này KHÔNG thấy kết quả đã ghi sẵn trên Lark.
          Mở bảng Lark xem trước khi lưu, kẻo ghi đè kết quả người khác vừa làm.
        </p>
      )}

      {donTran && mon.length === 0 && (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Không thấy món nào của đơn {don}. Kiểm lại mã đơn hoặc chờ Lark đồng bộ.
        </p>
      )}

      {mon.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] tracking-[0.12em] text-muted-foreground">
              ĐƠN {donTran} · {mon.length} MÓN
            </div>
            <a
              href={`/f/warehouse/nhan-kcs/tem?don=${encodeURIComponent(donTran)}&kho=${encodeURIComponent(kho)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
            >
              In tem cả đơn
            </a>
          </div>
          {mon.map((m) => (
            <KhoiMon key={m.dinhDanh} m={m} donTran={donTran} kho={kho} doiKho={doiKho} coQuyenNhap={coQuyenNhap} sang={monSang === m.dinhDanh} />
          ))}
        </div>
      )}

      <DaXuLyHomNay dong={homNay} coQuyenNhap={coQuyenNhap} />
    </div>
  );
}

/** Một món = một khối nhập = một dòng kho trên Lark. Lỗi của món này không đụng món khác. */
function KhoiMon({ m, donTran, kho, doiKho, coQuyenNhap, sang }: {
  m: MonCuaDon;
  donTran: string;
  kho: Warehouse;
  doiKho: (w: Warehouse) => void;
  coQuyenNhap: boolean;
  /** Vừa được ô quét chọn tới — tô viền 3 giây (BangNhanKcs tự tắt lại). */
  sang: boolean;
}) {
  // Điền sẵn theo thứ tự: việc SMS đã ghi → dòng đang có trên Lark → mặc định trắng.
  // Bỏ qua dòng Lark là bấm Lưu một cái ghi đè kết quả kho đã làm bằng SL 1 / QC Pass.
  const qcCu = laQc(m.daNhan?.qcCheck) ? m.daNhan.qcCheck as QcCheck
    : laQc(m.larkCu?.qcCheck ?? undefined) ? m.larkCu!.qcCheck as QcCheck : 'QC Pass';
  const actionCu = laAction(m.daNhan?.whAction) ? m.daNhan.whAction as WhAction
    : laAction(m.larkCu?.whAction ?? undefined) ? m.larkCu!.whAction as WhAction : actionMacDinh(qcCu);
  // Số trên Lark có thể là 0 hoặc quá lớn (dòng cũ nhập tay). Điền sẵn một giá trị mà máy chủ
  // sẽ từ chối thì kho bấm Lưu là kẹt, nên chỉ nhận số hợp lệ, còn lại về mặc định.
  const slHopLe = (n: number | null | undefined) => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null);
  const canHopLe = (n: number | null | undefined) => (typeof n === 'number' && n > 0 && n <= 100 ? n : null);
  const soLuongCu = slHopLe(m.daNhan?.soLuong) ?? slHopLe(m.larkCu?.soLuong) ?? 1;
  const canCu = canHopLe(m.daNhan?.canKg) ?? canHopLe(m.larkCu?.canKg) ?? null;
  // Món trên Lark vốn đã không đạt → ảnh lỗi đã có từ lần kiểm trước, không bắt chụp lại.
  const larkQcCu = m.larkCu?.qcCheck === 'QC Failed' ? 'QC Failed' : '';
  // Ảnh lỗi chỉ SMS mới giữ (spec §3: Lark chỉ nhận lý do bằng chữ), nên dòng Lark có lý do
  // KHÔNG có nghĩa là đã có ảnh.
  const coAnhCu = !!m.daNhan?.anhKey || larkQcCu === 'QC Failed';

  const [soLuong, setSoLuong] = useState(String(soLuongCu));
  const [canKg, setCanKg] = useState(canCu != null ? String(canCu) : '');
  const [qc, setQc] = useState<QcCheck>(qcCu);
  const [action, setAction] = useState<WhAction>(actionCu);
  const [lyDo, setLyDo] = useState(m.daNhan?.lyDoFail ?? m.larkCu?.lyDoFail ?? '');
  const [ketQua, setKetQua] = useState<KetQuaGhi | null>(null);
  const [dangGui, batDauGui] = useTransition();

  const doiQc = (v: QcCheck) => {
    setQc(v);
    // Hướng xử lý chạy theo kết quả kiểm, nhưng vẫn cho sửa tay sau đó.
    setAction(actionMacDinh(v));
  };

  function luu(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setKetQua(null);
    batDauGui(async () => {
      try {
        const r = await ghiNhanKcs(fd);
        setKetQua(r);
        // Lưu xong (kể cả chạy thử/Lark trượt — việc trong SMS vẫn đã ghi) trả con trỏ về ô
        // quét: máy quét cầm tay lập tức gõ được mã món KẾ TIẾP mà không cần bấm chuột trở lại.
        // Không nhảy tới ô cân của món khác trong danh sách — món kế thực sự là món kho CẦM
        // TRÊN TAY tiếp theo, chỉ biết được sau khi quét, không phải món tiếp theo trong bảng
        // (review 23/09/2026 Critical 1: Enter lưu xong bỏ quên con trỏ trong ô cân vừa lưu,
        // lượt quét vật lý sau đó gõ nhầm vào input số và bị trình duyệt nuốt/biến dạng).
        if (r.ok) document.getElementById('o-quet')?.focus();
      } catch {
        setKetQua({ ok: false, loi: 'Không gửi được lên máy chủ — kiểm mạng rồi bấm Lưu lại.' });
      }
    });
  }

  const tieuDe = (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="text-sm font-medium">{m.sku ?? '—'}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={m.lineitemName ?? undefined}>
        {m.lineitemName ?? '—'}
      </span>
      {m.vendor && <Chip mau="xam">{m.vendor}</Chip>}
      {m.store && <Chip mau="xam">{m.store}</Chip>}
    </div>
  );

  if (m.huy) {
    return (
      <div id={`mon-${m.dinhDanh}`} className={`rounded-xl border border-red-500/35 bg-red-500/5 px-4 py-3 ${sang ? 'ring-2 ring-amber-500' : ''}`}>
        {tieuDe}
        <p className="mt-1.5 text-[13px] text-red-700 dark:text-red-400">
          Đã huỷ{m.lyDoHuy ? ` (${m.lyDoHuy})` : ''} — không nhận vào kho.
        </p>
      </div>
    );
  }

  const khoa = !coQuyenNhap || dangGui;
  // Đã lưu (từ trước hoặc vừa lưu trong phiên này) — có dòng ở SMS nên mới có việc để in tem.
  const daLuu = m.daNhan != null || !!ketQua?.ok;

  // Hai bộ ô nhập CÙNG state, CÙNG name — chỉ khác cỡ chữ/khoảng cách theo khổ màn. Nhờ
  // 'hidden'/'md:hidden' (display:none) mà trình duyệt tự loại bộ đang ẩn khỏi kiểm tra
  // required (constraint validation chỉ xét phần tử đang HIỂN THỊ), nên không đụng nhau lúc
  // bấm Lưu. Ô ảnh lỗi (type=file) KHÔNG được nhân đôi kiểu này — file chọn ở input này không
  // tự có ở input kia, nhân đôi sẽ khiến FormData lấy nhầm ô rỗng — nên khối "Lý do không đạt +
  // Ảnh lỗi" bên dưới giữ NGUYÊN VẸN một bộ dùng chung cho cả hai khổ màn.
  const truong = (lon: boolean) => {
    const cls = lon ? O_NHAP_LON : O_NHAP;
    return (
      <>
        <Nhan chu="Số lượng">
          <input
            name="soLuong" type="number" min={1} step={1} required disabled={khoa}
            value={soLuong} onChange={(e) => setSoLuong(e.target.value)} className={cls}
          />
        </Nhan>
        <Nhan chu="Cân (kg)">
          <input
            // id chỉ gắn ở bộ máy tính — sau khi quét chọn món, con trỏ nhảy thẳng vào đây
            // (spec §5 "bàn phím cho máy tính"). Gắn cả hai bộ sẽ trùng id, getElementById
            // vớ ngay bộ đang ẩn trên điện thoại.
            {...(!lon ? { id: `can-${m.dinhDanh}` } : {})}
            name="canKg" type="number" min={0} step={0.01} disabled={khoa}
            value={canKg} onChange={(e) => setCanKg(e.target.value)} placeholder="—" className={cls}
          />
        </Nhan>
        <Nhan chu="Kết quả kiểm">
          <select name="qcCheck" value={qc} disabled={khoa} onChange={(e) => doiQc(e.target.value as QcCheck)} className={cls}>
            {QC_CHECK.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Nhan>
        <Nhan chu="Hướng xử lý">
          <select name="whAction" value={action} disabled={khoa} onChange={(e) => setAction(e.target.value as WhAction)} className={cls}>
            {WH_ACTION.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Nhan>
        <Nhan chu="Kho">
          <select name="warehouse" value={kho} disabled={khoa} onChange={(e) => doiKho(e.target.value as Warehouse)} className={cls}>
            {WAREHOUSE.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Nhan>
      </>
    );
  };

  return (
    <form
      id={`mon-${m.dinhDanh}`}
      onSubmit={luu}
      className={`rounded-xl border border-border bg-card px-4 py-3 ${sang ? 'ring-2 ring-amber-500' : ''}`}
    >
      <input type="hidden" name="monDinhDanh" value={m.dinhDanh} />
      <input type="hidden" name="monRecordId" value={m.recordId ?? ''} />
      <input type="hidden" name="orderNumber" value={donTran} />
      <input type="hidden" name="sku" value={m.sku ?? ''} />
      <input type="hidden" name="larkQcCu" value={larkQcCu} />

      {tieuDe}

      {m.daNhan && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Đã nhận {gioVn(m.daNhan.luc)} · {m.daNhan.qcCheck} · {m.daNhan.whAction} · SL {m.daNhan.soLuong}
          {m.daNhan.canKg != null ? ` · ${m.daNhan.canKg} kg` : ''} — nhập tiếp là sửa dòng này.
        </p>
      )}

      {m.larkCu && (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          Trên Lark món này ĐÃ có dòng kho: {m.larkCu.qcCheck ?? 'chưa kiểm'}
          {m.larkCu.whAction ? ` · ${m.larkCu.whAction}` : ''}
          {m.larkCu.soLuong != null ? ` · SL ${m.larkCu.soLuong}` : ''}
          {m.larkCu.canKg != null ? ` · ${m.larkCu.canKg} kg` : ''}
          {m.larkCu.lyDoFail ? ` · lý do: ${m.larkCu.lyDoFail}` : ''}
          {' '}— bấm Lưu là GHI ĐÈ dòng đó.
        </p>
      )}

      {/* Máy tính: lưới nhiều cột — bảng đang có. */}
      <div className="hidden md:block">
        <div className="mt-3 grid grid-cols-3 gap-2.5 lg:grid-cols-5">
          {truong(false)}
        </div>
      </div>

      {/* Điện thoại: thẻ dọc, ô nhập lớn hơn cho ngón tay (spec §5). */}
      <div className="mt-3 space-y-2.5 md:hidden">
        {truong(true)}
      </div>

      {qc === 'QC Failed' && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Nhan chu="Lý do không đạt">
            <input
              name="lyDoFail" required disabled={khoa} placeholder="Hỏng chỗ nào, sai gì"
              value={lyDo} onChange={(e) => setLyDo(e.target.value)} className={O_NHAP}
            />
          </Nhan>
          <Nhan chu={coAnhCu ? 'Ảnh lỗi (đã có — chọn ảnh mới nếu muốn thay)' : 'Ảnh lỗi'}>
            {/* Đã có ảnh cũ thì KHÔNG bắt buộc: sửa lại một món đã ghi hỏng (vd gõ nhầm cân)
                mà bắt chụp lại là hành người — máy chủ tự dùng ảnh đang lưu. */}
            <input name="anh" type="file" accept="image/*" required={!coAnhCu} disabled={khoa} className={`${O_NHAP} py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs`} />
          </Nhan>
        </div>
      )}

      <div className="mt-3 hidden flex-wrap items-center gap-3 md:flex">
        <button type="submit" disabled={khoa} className={NUT_CHINH}>{dangGui ? 'Đang lưu…' : 'Lưu'}</button>
        {daLuu && <NutInTem donTran={donTran} dinhDanh={m.dinhDanh} kho={kho} />}
        {ketQua && <KetQuaMon kq={ketQua} />}
        {m.temInLuc && <span className="text-[11px] text-muted-foreground">đã in tem {gioVn(m.temInLuc)}</span>}
      </div>
      <div className="mt-3 space-y-2 md:hidden">
        <button type="submit" disabled={khoa} className={NUT_CHINH_LON}>{dangGui ? 'Đang lưu…' : 'Lưu'}</button>
        {daLuu && <NutInTem donTran={donTran} dinhDanh={m.dinhDanh} kho={kho} lon />}
        {ketQua && <KetQuaMon kq={ketQua} />}
        {m.temInLuc && <p className="text-[11px] text-muted-foreground">đã in tem {gioVn(m.temInLuc)}</p>}
      </div>
    </form>
  );
}

/** Sau khi lưu một món (phiên này hoặc từ trước) — mở trang in tem cho đúng món đó ở tab mới (spec §5). */
function NutInTem({ donTran, dinhDanh, kho, lon }: { donTran: string; dinhDanh: string; kho: Warehouse; lon?: boolean }) {
  return (
    <a
      href={`/f/warehouse/nhan-kcs/tem?don=${encodeURIComponent(donTran)}&mon=${encodeURIComponent(dinhDanh)}&kho=${encodeURIComponent(kho)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={lon
        ? 'block w-full rounded-lg border border-border py-2.5 text-center text-sm font-medium hover:bg-muted'
        : 'rounded-md border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted'}
    >
      In tem
    </a>
  );
}

function KetQuaMon({ kq }: { kq: KetQuaGhi }) {
  if (!kq.ok) return <span className="text-[13px] text-red-600 dark:text-red-400">{kq.loi ?? 'Không lưu được.'}</span>;
  // Lưu được ở SMS nhưng Lark trượt: việc không mất, cron đẩy lại — báo vàng chứ không báo đỏ.
  if (kq.loi) return <span className="text-[13px] text-amber-700 dark:text-amber-400">{kq.loi}</span>;
  // Chạy thử thì CHƯA gửi gì sang Lark — nói thẳng, đừng khoe đã tạo dòng.
  if (kq.dry) {
    return <span className="text-[13px] text-amber-700 dark:text-amber-400">Đã lưu ở SMS (chế độ chạy thử — chưa gửi Lark)</span>;
  }
  return (
    <span className="text-[13px] text-emerald-700 dark:text-emerald-400">
      {kq.tao ? 'Đã tạo dòng kho trên Lark' : 'Đã cập nhật dòng kho trên Lark'}
    </span>
  );
}

function DaXuLyHomNay({ dong, coQuyenNhap }: { dong: DongHomNay[]; coQuyenNhap: boolean }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] tracking-[0.12em] text-muted-foreground">ĐÃ XỬ LÝ HÔM NAY · {dong.length} DÒNG</div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[11px] font-medium text-muted-foreground">
              <th className="px-3 py-2">Giờ</th>
              <th className="px-3 py-2">Mã đơn</th>
              <th className="px-3 py-2">Mã hàng</th>
              <th className="px-3 py-2">Kết quả</th>
              <th className="px-3 py-2">Hướng xử lý</th>
              <th className="px-3 py-2">Người làm</th>
              <th className="px-3 py-2">Đẩy Lark</th>
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => <DongDaXuLy key={d.id} d={d} coQuyenNhap={coQuyenNhap} />)}
            {dong.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">Hôm nay chưa nhận món nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DongDaXuLy({ d, coQuyenNhap }: { d: DongHomNay; coQuyenNhap: boolean }) {
  const [loiMoi, setLoiMoi] = useState<string | null>(null);
  const [dangDay, batDauDay] = useTransition();

  function thuLai() {
    setLoiMoi(null);
    batDauDay(async () => {
      try {
        const r = await dayLaiDongLoi(d.id);
        if (!r.ok) setLoiMoi(r.loi ?? 'Vẫn chưa đẩy được.');
      } catch {
        setLoiMoi('Không gọi được máy chủ.');
      }
    });
  }

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{gioVn(d.luc)}</td>
      <td className="whitespace-nowrap px-3 py-2 font-medium">{d.orderNumber}</td>
      <td className="px-3 py-2">{d.sku ?? '—'}</td>
      <td className="px-3 py-2">{d.qcCheck}</td>
      <td className="px-3 py-2 text-muted-foreground">{d.whAction}</td>
      <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground" title={d.nguoiLam ?? undefined}>{d.nguoiLam ?? '—'}</td>
      <td className="px-3 py-2">
        {d.trangThaiDay === 'da_day' && <Chip mau="xanh" cham>đã đẩy</Chip>}
        {d.trangThaiDay === 'cho' && <Chip mau="vang" cham>chờ đẩy</Chip>}
        {d.trangThaiDay === 'loi' && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip mau="do" cham>lỗi</Chip>
            <span className="text-[11px] text-red-600 dark:text-red-400">{loiMoi ?? d.loi ?? ''}</span>
            {coQuyenNhap && (
              <button
                type="button" onClick={thuLai} disabled={dangDay}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
              >
                {dangDay ? 'Đang đẩy…' : 'Thử lại'}
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function Nhan({ chu, children }: { chu: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted-foreground">{chu}</span>
      {children}
    </label>
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
