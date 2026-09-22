'use client';

import { useEffect, useState, useTransition } from 'react';
import { dayLaiDongLoi, ghiNhanKcs } from '@/features/kho-nhan/actions';
import { QC_CHECK, WAREHOUSE, WH_ACTION, type QcCheck, type WhAction, type Warehouse } from '@/features/kho-nhan/gia-tri-lark';
import { actionMacDinh } from '@/features/kho-nhan/luat';
import type { MonCuaDon, listDaXuLyHomNay } from '@/features/kho-nhan/queries';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';

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
const NUT_CHINH = 'h-9 rounded-lg bg-amber-500 px-5 text-[13px] font-semibold text-amber-950 transition hover:bg-amber-400 disabled:opacity-50';

export function BangNhanKcs({ don, mon, homNay, coQuyenNhap }: {
  don: string;
  mon: MonCuaDon[];
  homNay: DongHomNay[];
  coQuyenNhap: boolean;
}) {
  const [kho, setKho] = useState<Warehouse>(WAREHOUSE[0]);
  useEffect(() => {
    try {
      const luu = localStorage.getItem(KHOA_KHO);
      if (laKho(luu)) setKho(luu);
    } catch { /* trình duyệt chặn localStorage thì dùng kho mặc định */ }
  }, []);
  const doiKho = (w: Warehouse) => {
    setKho(w);
    try { localStorage.setItem(KHOA_KHO, w); } catch { /* không lưu được thì thôi */ }
  };

  // Bảng món trong SMS lưu mã đơn KHÔNG có '#', gửi Lark cũng phải cùng nếp đó.
  const donTran = don.trim().replace(/^#/, '');

  return (
    <div className="space-y-5">
      <form action="/f/warehouse/nhan-kcs" className="flex flex-wrap items-center gap-2">
        <input
          name="don"
          defaultValue={don}
          autoFocus
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

      {donTran && mon.length === 0 && (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Không thấy món nào của đơn {don}. Kiểm lại mã đơn hoặc chờ Lark đồng bộ.
        </p>
      )}

      {mon.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] tracking-[0.12em] text-muted-foreground">
            ĐƠN {donTran} · {mon.length} MÓN
          </div>
          {mon.map((m) => (
            <KhoiMon key={m.dinhDanh} m={m} donTran={donTran} kho={kho} doiKho={doiKho} coQuyenNhap={coQuyenNhap} />
          ))}
        </div>
      )}

      <DaXuLyHomNay dong={homNay} coQuyenNhap={coQuyenNhap} />
    </div>
  );
}

/** Một món = một khối nhập = một dòng kho trên Lark. Lỗi của món này không đụng món khác. */
function KhoiMon({ m, donTran, kho, doiKho, coQuyenNhap }: {
  m: MonCuaDon;
  donTran: string;
  kho: Warehouse;
  doiKho: (w: Warehouse) => void;
  coQuyenNhap: boolean;
}) {
  // Món đã nhận thì nhập tiếp là SỬA dòng cũ, nên điền sẵn cái đã ghi: không điền sẵn thì
  // người sửa mỗi ô cân sẽ vô tình hạ số lượng về 1.
  const [soLuong, setSoLuong] = useState(String(m.daNhan?.soLuong ?? 1));
  const [canKg, setCanKg] = useState(m.daNhan?.canKg != null ? String(m.daNhan.canKg) : '');
  const [qc, setQc] = useState<QcCheck>(laQc(m.daNhan?.qcCheck) ? m.daNhan.qcCheck as QcCheck : 'QC Pass');
  const [action, setAction] = useState<WhAction>(
    laAction(m.daNhan?.whAction) ? m.daNhan.whAction as WhAction : actionMacDinh(laQc(m.daNhan?.qcCheck) ? m.daNhan.qcCheck as QcCheck : 'QC Pass'),
  );
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
        setKetQua(await ghiNhanKcs(fd));
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
      <div className="rounded-xl border border-red-500/35 bg-red-500/5 px-4 py-3">
        {tieuDe}
        <p className="mt-1.5 text-[13px] text-red-700 dark:text-red-400">
          Đã huỷ{m.lyDoHuy ? ` (${m.lyDoHuy})` : ''} — không nhận vào kho.
        </p>
      </div>
    );
  }

  const khoa = !coQuyenNhap || dangGui;

  return (
    <form onSubmit={luu} className="rounded-xl border border-border bg-card px-4 py-3">
      <input type="hidden" name="monDinhDanh" value={m.dinhDanh} />
      <input type="hidden" name="monRecordId" value={m.recordId ?? ''} />
      <input type="hidden" name="orderNumber" value={donTran} />
      <input type="hidden" name="sku" value={m.sku ?? ''} />

      {tieuDe}

      {m.daNhan && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Đã nhận {gioVn(m.daNhan.luc)} · {m.daNhan.qcCheck} · {m.daNhan.whAction} · SL {m.daNhan.soLuong}
          {m.daNhan.canKg != null ? ` · ${m.daNhan.canKg} kg` : ''} — nhập tiếp là sửa dòng này.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Nhan chu="Số lượng">
          <input
            name="soLuong" type="number" min={1} step={1} required disabled={khoa}
            value={soLuong} onChange={(e) => setSoLuong(e.target.value)} className={O_NHAP}
          />
        </Nhan>
        <Nhan chu="Cân (kg)">
          <input
            name="canKg" type="number" min={0} step={0.01} disabled={khoa}
            value={canKg} onChange={(e) => setCanKg(e.target.value)} placeholder="—" className={O_NHAP}
          />
        </Nhan>
        <Nhan chu="Kết quả kiểm">
          <select name="qcCheck" value={qc} disabled={khoa} onChange={(e) => doiQc(e.target.value as QcCheck)} className={O_NHAP}>
            {QC_CHECK.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Nhan>
        <Nhan chu="Hướng xử lý">
          <select name="whAction" value={action} disabled={khoa} onChange={(e) => setAction(e.target.value as WhAction)} className={O_NHAP}>
            {WH_ACTION.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Nhan>
        <Nhan chu="Kho">
          <select name="warehouse" value={kho} disabled={khoa} onChange={(e) => doiKho(e.target.value as Warehouse)} className={O_NHAP}>
            {WAREHOUSE.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Nhan>
      </div>

      {qc === 'QC Failed' && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Nhan chu="Lý do không đạt">
            <input name="lyDoFail" required disabled={khoa} placeholder="Hỏng chỗ nào, sai gì" className={O_NHAP} />
          </Nhan>
          <Nhan chu="Ảnh lỗi">
            <input name="anh" type="file" accept="image/*" required disabled={khoa} className={`${O_NHAP} py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs`} />
          </Nhan>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={khoa} className={NUT_CHINH}>{dangGui ? 'Đang lưu…' : 'Lưu'}</button>
        {ketQua && <KetQuaMon kq={ketQua} />}
      </div>
    </form>
  );
}

function KetQuaMon({ kq }: { kq: KetQuaGhi }) {
  if (!kq.ok) return <span className="text-[13px] text-red-600 dark:text-red-400">{kq.loi ?? 'Không lưu được.'}</span>;
  // Lưu được ở SMS nhưng Lark trượt: việc không mất, cron đẩy lại — báo vàng chứ không báo đỏ.
  if (kq.loi) return <span className="text-[13px] text-amber-700 dark:text-amber-400">{kq.loi}</span>;
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
