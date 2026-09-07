'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MayQuet } from './MayQuet';
import type { BrandDangCho, DongCho } from '@/features/receiving/nhan-nhanh-queries';
import {
  layDongCho, layDongTheoMaQuet, moPhieuBrand, inTemMon, nhanNgoaiKeHoach, xacNhanQuet, type KetQuaQuet,
} from '@/features/receiving/nhan-nhanh-actions';

type Buoc =
  | { b: 1 }
  | { b: 2; brand: string; phieu: { id: string; code: string }; dongs: DongCho[]; loc: string }
  | { b: 3; brand: string; phieu: { id: string; code: string }; dong: DongCho; soLuong: number }
  | { b: 4; brand: string; phieu: { id: string; code: string }; dong: DongCho | null; daIn: string[]; daXacNhan: string[]; mongDoi: number };

const LOI: Record<Exclude<KetQuaQuet, { ok: true }>['lyDo'], string> = {
  khong_ton_tai: 'Mã không tồn tại', da_xac_nhan: 'Tem này đã xác nhận rồi',
  khac_phieu: 'Tem thuộc phiếu khác', khong_phai_tem_mon: 'Không phải tem món (WH-…)',
};

function rung() { try { navigator.vibrate?.(200); } catch { /* không hỗ trợ */ } }

export function QuetNhanHang({ brands }: { brands: BrandDangCho[] }) {
  const [buoc, setBuoc] = useState<Buoc>({ b: 1 });
  const [pending, start] = useTransition();
  const [do_, setDo] = useState(false);

  // Đọc state qua ref để onMa ổn định — đổi deps là camera khởi động lại.
  const buocRef = useRef(buoc);
  useEffect(() => { buocRef.current = buoc; }, [buoc]);

  const baoLoi = (msg: string) => { rung(); setDo(true); toast.error(msg); setTimeout(() => setDo(false), 600); };

  const chonBrand = (brand: string) => start(async () => {
    const phieu = await moPhieuBrand(brand);
    const dongs = await layDongCho(brand);
    setBuoc({ b: 2, brand, phieu, dongs, loc: '' });
  });

  const quetBuoc2 = useCallback((ma: string) => {
    const b = buocRef.current;
    if (b.b !== 2) return;
    start(async () => {
      const r = await layDongTheoMaQuet(ma);
      if (!r.ok) { baoLoi(r.loi); return; }
      if (r.dong.brandSlug !== b.brand) { baoLoi(`Dòng này của brand ${r.dong.brandSlug ?? '?'}, phiếu đang mở là ${b.brand}`); return; }
      setBuoc({ b: 3, brand: b.brand, phieu: b.phieu, dong: r.dong, soLuong: Math.max(0, r.dong.mongDoi - r.dong.daIn) });
    });
  }, []);

  const quetBuoc4 = useCallback((ma: string) => {
    const b = buocRef.current;
    if (b.b !== 4) return;
    start(async () => {
      const r = await xacNhanQuet({ receiptId: b.phieu.id, maQuet: ma });
      if (!r.ok) { baoLoi(LOI[r.lyDo]); return; }
      toast.success(`${r.unitCode} ✓ ${r.lineId ? `${r.daXacNhan}/${r.mongDoi}` : 'ngoài kế hoạch'}`);
      setBuoc((prev) => prev.b === 4 ? { ...prev, daXacNhan: [...prev.daXacNhan, r.unitCode], mongDoi: r.mongDoi || prev.mongDoi } : prev);
      if (r.duChiec) toast.success('Đủ chiếc — đã chốt nhận hàng dòng này');
    });
  }, []);

  // Về bước 2 sau khi quét xong, tải lại danh sách chờ (dòng đủ chiếc sẽ biến mất).
  const veDanhSach = () => { if (buoc.b === 1) return; start(async () => { const dongs = await layDongCho(buoc.brand); setBuoc({ b: 2, brand: buoc.brand, phieu: buoc.phieu, dongs, loc: '' }); }); };

  useEffect(() => {
    if (do_) document.body.classList.add('ring-4', 'ring-red-500');
    else document.body.classList.remove('ring-4', 'ring-red-500');
    return () => document.body.classList.remove('ring-4', 'ring-red-500');
  }, [do_]);

  if (buoc.b === 1) {
    // brandSlug khởi tạo null trong DB (gán sau khi biết brand) — bỏ qua brand chưa
    // có slug ở màn chọn brand, không có gì để mở phiếu cho.
    const cacBrand = brands.filter((b): b is BrandDangCho & { brandSlug: string } => !!b.brandSlug);
    return (
      <div className="p-4 space-y-3">
        <h1 className="text-xl font-semibold">Nhập kho nhanh · chọn brand</h1>
        {cacBrand.length === 0 && <p className="text-sm text-muted-foreground">Không có dòng nào đang chờ hàng brand.</p>}
        <div className="grid grid-cols-2 gap-3">
          {cacBrand.map((b) => (
            <button key={b.brandSlug} type="button" disabled={pending} onClick={() => chonBrand(b.brandSlug)}
              className="rounded-xl border p-4 text-left active:bg-muted">
              <div className="font-medium">{b.displayName ?? b.brandSlug}</div>
              <div className="text-xs text-muted-foreground">{b.soDong} dòng chờ</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (buoc.b === 2) {
    const q = buoc.loc.trim().toLowerCase();
    const hien = q ? buoc.dongs.filter((d) => (d.orderNumber ?? '').toLowerCase().includes(q)) : buoc.dongs;
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{buoc.brand.toUpperCase()} · phiếu {buoc.phieu.code}</h1>
          <button type="button" className="text-sm underline" onClick={() => setBuoc({ b: 1 })}>Đóng phiếu</button>
        </div>
        <MayQuet onMa={quetBuoc2} dangBan={pending} />
        <input value={buoc.loc} onChange={(e) => setBuoc({ ...buoc, loc: e.target.value })} placeholder="Tìm theo mã đơn"
          className="w-full rounded-md border border-input bg-input/30 px-3 py-2 text-base" />
        <ul className="divide-y rounded-lg border">
          {hien.map((d) => (
            <li key={d.lineId}>
              <button type="button" className="w-full p-3 text-left active:bg-muted" onClick={() => setBuoc({ b: 3, brand: buoc.brand, phieu: buoc.phieu, dong: d, soLuong: Math.max(0, d.mongDoi - d.daIn) })}>
                <div className="flex justify-between"><span className="font-medium">{d.orderNumber}</span><span className="text-xs text-muted-foreground">{d.expectedDeliveryDate ? new Date(d.expectedDeliveryDate).toLocaleDateString('vi-VN') : ''}</span></div>
                <div className="text-sm">{d.productTitle} {d.variantTitle ? `· ${d.variantTitle}` : ''}</div>
                <div className="text-xs text-muted-foreground">mong đợi {d.mongDoi} · đã in {d.daIn} · đã xác nhận {d.daXacNhan}</div>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="w-full rounded-lg border border-amber-500 p-3 text-amber-700" onClick={() => setBuoc({ b: 4, brand: buoc.brand, phieu: buoc.phieu, dong: null, daIn: [], daXacNhan: [], mongDoi: 0 })}>
          Nhận ngoài kế hoạch (hàng không có trong danh sách)
        </button>
      </div>
    );
  }

  if (buoc.b === 3) {
    const d = buoc.dong;
    return (
      <div className="p-4 space-y-3">
        <button type="button" className="text-sm underline" onClick={veDanhSach}>← Danh sách chờ</button>
        <div className="rounded-lg border p-3">
          <div className="font-semibold">{d.orderNumber}</div>
          <div>{d.productTitle} {d.variantTitle ? `· ${d.variantTitle}` : ''}</div>
          <div className="text-sm text-muted-foreground">mong đợi {d.mongDoi} · đã in {d.daIn} · đã xác nhận {d.daXacNhan}</div>
        </div>
        <label className="block text-sm">Số tem in
          <input type="number" min={0} max={99} value={buoc.soLuong} onChange={(e) => setBuoc({ ...buoc, soLuong: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-input bg-input/30 px-3 py-2 text-lg" />
        </label>
        {buoc.soLuong > d.mongDoi - d.daIn && <p className="text-sm text-amber-700">Vượt mong đợi: {buoc.soLuong - (d.mongDoi - d.daIn)} tem sẽ là &quot;ngoài kế hoạch&quot;.</p>}
        <button type="button" disabled={pending || buoc.soLuong <= 0} className="w-full rounded-lg bg-black p-3 text-white"
          onClick={() => start(async () => {
            const r = await inTemMon({ receiptId: buoc.phieu.id, lineId: d.lineId, soLuong: buoc.soLuong });
            const ma = [...r.maTheoDon, ...r.maNgoaiKeHoach];
            window.open(`/f/warehouse/receiving/tem?ma=${ma.join(',')}`, '_blank');
            setBuoc({ b: 4, brand: buoc.brand, phieu: buoc.phieu, dong: d, daIn: ma, daXacNhan: [], mongDoi: d.mongDoi });
          })}>In {buoc.soLuong} tem</button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <button type="button" className="text-sm underline" onClick={veDanhSach}>← Danh sách chờ</button>
      <h2 className="font-semibold">{buoc.dong ? `${buoc.dong.orderNumber} · quét xác nhận` : 'Nhận ngoài kế hoạch'}</h2>
      {buoc.dong && <p className="text-sm">Đã xác nhận {buoc.dong.daXacNhan + buoc.daXacNhan.length}/{buoc.mongDoi}</p>}
      {!buoc.dong && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
          const r = await nhanNgoaiKeHoach({ receiptId: buoc.phieu.id, sku: String(f.get('sku') || '') || null, productTitle: String(f.get('ten') || '') || null, soLuong: Number(f.get('n') || 1) });
          if (r.ma.length === 0) { toast.error('Không có tem nào được tạo'); return; }
          window.open(`/f/warehouse/receiving/tem?ma=${r.ma.join(',')}`, '_blank');
          setBuoc((prev) => prev.b === 4 ? { ...prev, daIn: [...prev.daIn, ...r.ma] } : prev);
        }); }}>
          <input name="ten" placeholder="Tên hàng" className="flex-1 rounded-md border px-2 py-2" />
          <input name="sku" placeholder="SKU (nếu có)" className="w-28 rounded-md border px-2 py-2" />
          <input name="n" type="number" defaultValue={1} min={1} max={50} className="w-16 rounded-md border px-2 py-2" />
          <button type="submit" disabled={pending} className="rounded-md bg-amber-600 px-3 text-white">In</button>
        </form>
      )}
      <MayQuet onMa={quetBuoc4} dangBan={pending} />
      <ul className="text-sm font-mono">
        {buoc.daIn.map((m) => <li key={m} className={buoc.daXacNhan.includes(m) ? 'text-emerald-700' : 'text-muted-foreground'}>{m} {buoc.daXacNhan.includes(m) ? '✓' : '· chưa quét'}</li>)}
      </ul>
    </div>
  );
}
