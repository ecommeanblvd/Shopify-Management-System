'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { timDongDeTra } from '@/features/doi-tra/queries';
import type { DongDonTra } from '@/features/doi-tra/types';
import { taoYeuCauTra } from '@/features/doi-tra/actions';
import { LY_DO, NOI_HOAN, LOAI_TRA, type NoiHoan, type LoaiTra } from '@/features/doi-tra/ly-do';
import { useTimDong } from '@/components/cx/dung-tim-dong';

/**
 * CX tạo yêu cầu trả thay khách (CEO 27/09: "CX nhập hộ, giữ nguyên thói quen").
 *
 * Hai bước: tìm đúng DÒNG đơn → điền lý do. Chọn dòng chứ không chọn đơn, vì
 * CX đang ghi MỘT DÒNG = MỘT MÓN trên Lark và hoàn tiền tính theo món.
 */
export function FormTaoYeuCau() {
  /* Phần debounce + chặn đua lượt gọi + TÁCH "lỗi gọi" khỏi "không có kết quả"
     nằm ở hook `useTimDong` — dùng chung với ô tìm của module ticket. */
  const o = useTimDong<DongDonTra>(timDongDeTra);
  const [chon, setChon] = useState<DongDonTra | null>(null);
  const hienThi = o.hienThi;

  if (chon) {
    return (
      <BuocLyDo
        dong={chon}
        onQuayLai={() => setChon(null)}
        onXong={() => { setChon(null); o.xoa(); }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Tìm món khách muốn trả</span>
        <input
          value={o.tuKhoa}
          onChange={(e) => o.doiTuKhoa(e.target.value)}
          placeholder="Mã đơn, SKU, tên sản phẩm, hoặc email khách"
          aria-label="Tìm món khách muốn trả theo mã đơn, SKU, tên sản phẩm hoặc email khách"
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
        />
      </label>

      {o.loiGoi && <p className="text-sm text-destructive">{o.loiGoi}</p>}

      {!o.duNgan && !o.loiGoi && (
        <div className="rounded-lg border border-border">
          {o.dangTim && hienThi.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Đang tìm…</p>
          ) : hienThi.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Không có món nào khớp “{o.ky}”.</p>
          ) : (
            <ul>
              {hienThi.map((m) => {
                const het = m.daTra >= m.soLuong;
                return (
                  <li key={m.lineId} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setChon(m)}
                      disabled={het}
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {m.tenSanPham ?? m.sku}
                          {m.bienThe && <span className="text-muted-foreground"> — {m.bienThe}</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.maDon} · <span className="font-mono">{m.sku}</span>
                          {m.khachEmail && ` · ${m.khachEmail}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {het ? 'đã có yêu cầu trả' : `mua ${m.soLuong}${m.daTra ? ` · đã trả ${m.daTra}` : ''}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BuocLyDo({
  dong, onQuayLai, onXong,
}: { dong: DongDonTra; onQuayLai: () => void; onXong: () => void }) {
  const conLai = dong.soLuong - dong.daTra;
  const [soLuong, setSoLuong] = useState(1);
  const [chinh, setChinh] = useState(LY_DO[0]!.ma);
  const [phu, setPhu] = useState('');
  const [noiHoan, setNoiHoan] = useState<NoiHoan>(NOI_HOAN[0].ma);
  const [loai, setLoai] = useState<LoaiTra>(LOAI_TRA[0].ma);
  const [ghiChu, setGhiChu] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nhomPhu = LY_DO.find((l) => l.ma === chinh)?.phu ?? [];

  function gui() {
    start(async () => {
      setLoi(null);
      const r = await taoYeuCauTra({
        lineId: dong.lineId, soLuong,
        lyDoChinh: chinh, lyDoPhu: phu || null,
        noiHoan, loai, ghiChu: ghiChu.trim() || null,
      });
      if (!r.ok) { setLoi(r.loi ?? 'Tạo yêu cầu thất bại.'); return; }
      toast.success(`Đã tạo yêu cầu trả ${r.rma}.`, { duration: 3000 });
      onXong();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-sm font-medium">
          {dong.tenSanPham ?? dong.sku}
          {dong.bienThe && <span className="text-muted-foreground"> — {dong.bienThe}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {dong.maDon} · <span className="font-mono">{dong.sku}</span> · {dong.store}
          {dong.khachEmail && ` · ${dong.khachEmail}`}
        </p>
        <button type="button" onClick={onQuayLai} className="mt-2 cursor-pointer text-xs underline">
          ← chọn món khác
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Số lượng trả</span>
          <input
            type="number" min={1} max={conLai} value={soLuong}
            onChange={(e) => setSoLuong(Number(e.target.value))}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">còn {conLai}/{dong.soLuong} món trả được</span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Loại yêu cầu</span>
          <select
            value={loai} onChange={(e) => setLoai(e.target.value as LoaiTra)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {LOAI_TRA.map((l) => <option key={l.ma} value={l.ma}>{l.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Lý do</span>
          <select
            value={chinh}
            onChange={(e) => { setChinh(e.target.value); setPhu(''); }}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {LY_DO.map((l) => <option key={l.ma} value={l.ma}>{l.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Lý do chi tiết</span>
          <select
            value={phu} onChange={(e) => setPhu(e.target.value)}
            disabled={nhomPhu.length === 0}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">{nhomPhu.length === 0 ? '— không có —' : '— không nêu —'}</option>
            {nhomPhu.map((p) => <option key={p.ma} value={p.ma}>{p.ten}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Hoàn về</span>
          <select
            value={noiHoan} onChange={(e) => setNoiHoan(e.target.value as NoiHoan)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {NOI_HOAN.map((n) => <option key={n.ma} value={n.ma}>{n.ten}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Ghi chú (tuỳ chọn)</span>
          <textarea
            value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={2}
            placeholder="Khách nói gì, hẹn gì — để người duyệt đọc"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={gui} disabled={pending}>
          {pending ? 'Đang tạo…' : 'Tạo yêu cầu trả'}
        </Button>
      </div>
    </div>
  );
}
