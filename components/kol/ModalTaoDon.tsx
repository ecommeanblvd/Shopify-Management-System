'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { taoDon, goiYGiaVon, traTonKhaDung } from '@/features/kol/actions';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { SearchSelect, type SelectOption } from '@/components/ui/search-select';
import { formatMoneyForDisplay } from '@/components/ui/money-input';
import { MaHangPicker } from '@/components/kol/MaHangPicker';
import { Stepper, kepSoLuong } from '@/components/kol/Stepper';
import type { NguoiNhan } from '@/features/kol/queries';
import type { HinhThuc, KetQuaBienThe, MucDich } from '@/features/kol/types';

const NHAN_MUC_DICH: Record<MucDich, string> = { kol: 'KOL', chup_do: 'Chụp đồ', khac: 'Khác' };

interface DongState {
  key: string;
  sku: string;
  tenHang: string;
  kho: string;
  soLuong: number;
  hinhThuc: HinhThuc;
  hanTra: string;
  giaVon: string;
  giaVonTienTe: string;
  dangTraGiaVon: boolean;
  ton: number | null;
  tonDangTai: boolean;
}

function dongMoi(): DongState {
  return {
    key: crypto.randomUUID(),
    sku: '', tenHang: '', kho: WAREHOUSE_PRIORITY[0], soLuong: 1,
    hinhThuc: 'tang', hanTra: '', giaVon: '', giaVonTienTe: 'VND',
    dangTraGiaVon: false, ton: null, tonDangTai: false,
  };
}

/**
 * Modal "Tạo đơn" — thay cho trang `/f/kol/moi` cũ (spec CEO 23/09/2026):
 * mọi trường là một LỰA CHỌN (chọn người nhận từ sổ, chọn mã hàng qua tìm
 * kiếm/quét, chọn kho/hình thức từ danh sách, số lượng qua stepper), không có
 * ô gõ tay nào nhận thẳng giá trị hệ thống phải tin. Giá vốn CHỈ đọc, hệ
 * thống tự tra qua `goiYGiaVon` — không có ô gõ tay giá vốn ở đây, sửa giá
 * còn thiếu là việc của `suaGiaVon` ở màn chi tiết đơn.
 */
export function ModalTaoDon({ nguoiNhan }: { nguoiNhan: NguoiNhan[] }) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [nguoiNhanId, setNguoiNhanId] = useState('');
  const [mucDich, setMucDich] = useState<MucDich>('kol');
  const [ghiChu, setGhiChu] = useState('');
  const [dong, setDong] = useState<DongState[]>([dongMoi()]);

  // Hồ sơ ngừng dùng KHÔNG được chọn khi tạo đơn mới (spec CEO) — vẫn hiện ở bộ lọc
  // danh sách đơn (nơi mảng `nguoiNhan` này được tải sẵn với gomCaNgung=true) nên lọc ở đây.
  const nguoiNhanOptions: SelectOption[] = nguoiNhan
    .filter((n) => !n.ngungDung)
    .map((n) => ({ value: n.id, label: `${n.ten}${n.quocGia && n.quocGia !== 'VN' ? ` (${n.quocGia})` : ''}` }));

  const capNhat = (key: string, patch: Partial<DongState>) =>
    setDong((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const xoaDong = (key: string) => setDong((prev) => (prev.length > 1 ? prev.filter((d) => d.key !== key) : prev));
  const themDong = () => setDong((prev) => [...prev, dongMoi()]);

  function refreshTon(key: string, sku: string, kho: string) {
    if (!sku.trim() || !kho.trim()) return;
    capNhat(key, { tonDangTai: true });
    start(async () => {
      const t = await traTonKhaDung(sku, kho);
      capNhat(key, { ton: t, tonDangTai: false });
    });
  }

  function goiYGia(key: string, sku: string) {
    capNhat(key, { dangTraGiaVon: true });
    start(async () => {
      const g = await goiYGiaVon(sku);
      capNhat(key, g
        ? { giaVon: g.gia, giaVonTienTe: g.tienTe, dangTraGiaVon: false }
        : { giaVon: '', dangTraGiaVon: false });
    });
  }

  /** Chọn mã hàng xong (qua tìm kiếm hoặc quét) — nạp tên, tra tồn theo kho hiện tại, tra giá vốn. */
  function onChonMaHang(key: string, bt: KetQuaBienThe) {
    const khoHienTai = dong.find((d) => d.key === key)?.kho ?? WAREHOUSE_PRIORITY[0];
    capNhat(key, { sku: bt.sku, tenHang: bt.tenHang });
    refreshTon(key, bt.sku, khoHienTai);
    goiYGia(key, bt.sku);
  }

  function onKhoChange(key: string, sku: string, kho: string) {
    capNhat(key, { kho });
    refreshTon(key, sku, kho);
  }

  function onHinhThucChange(key: string, hinhThuc: HinhThuc) {
    // Tặng thì KHÔNG được có hạn trả — xoá trống ngay khi đổi hình thức.
    capNhat(key, { hinhThuc, hanTra: hinhThuc === 'tang' ? '' : dong.find((d) => d.key === key)?.hanTra ?? '' });
  }

  function resetForm() {
    setErr(null);
    setNguoiNhanId('');
    setMucDich('kol');
    setGhiChu('');
    setDong([dongMoi()]);
  }

  const soDongThieuGia = dong.filter((d) => !d.giaVon.trim() && !d.dangTraGiaVon).length;

  const submit = () =>
    start(async () => {
      setErr(null);
      if (!nguoiNhanId) { setErr('Phải chọn người nhận.'); return; }
      for (let i = 0; i < dong.length; i++) {
        const d = dong[i];
        const nhan = `Dòng ${i + 1}${d.sku ? ` (${d.sku})` : ''}`;
        if (!d.sku.trim()) { setErr(`${nhan}: chưa chọn mã hàng — tìm hoặc quét để chọn.`); return; }
        if (!d.kho.trim()) { setErr(`${nhan}: thiếu kho.`); return; }
        if (!Number.isInteger(d.soLuong) || d.soLuong <= 0) { setErr(`${nhan}: số lượng phải là số nguyên dương.`); return; }
        if (d.hinhThuc === 'muon' && !d.hanTra) { setErr(`${nhan}: hình thức mượn bắt buộc phải có hạn trả.`); return; }
      }

      const fd = new FormData();
      fd.set('nguoiNhanId', nguoiNhanId);
      fd.set('mucDich', mucDich);
      fd.set('ghiChu', ghiChu);
      fd.set('dong', JSON.stringify(dong.map((d) => ({
        sku: d.sku.trim(),
        tenHang: d.tenHang.trim() || undefined,
        kho: d.kho,
        soLuong: d.soLuong,
        hinhThuc: d.hinhThuc,
        hanTra: d.hinhThuc === 'muon' ? d.hanTra : undefined,
        giaVon: d.giaVon.trim() || undefined,
        giaVonTienTe: d.giaVon.trim() ? d.giaVonTienTe : undefined,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo đơn KOL / chụp đồ</DialogTitle>
          <DialogDescription>Đơn tạo ở trạng thái nháp, chưa đụng tồn kho — chốt đơn mới giữ chỗ.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block">Người nhận *</span>
              <SearchSelect
                value={nguoiNhanId}
                onChange={setNguoiNhanId}
                options={nguoiNhanOptions}
                placeholder="Gõ để tìm người nhận…"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block">Mục đích *</span>
              <select
                className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={mucDich}
                onChange={(e) => setMucDich(e.target.value as MucDich)}
              >
                {(Object.keys(NHAN_MUC_DICH) as MucDich[]).map((m) => (
                  <option key={m} value={m}>{NHAN_MUC_DICH[m]}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block">Ghi chú</span>
            <textarea
              className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              rows={2}
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Dòng hàng</h2>
              <Button type="button" variant="outline" size="sm" onClick={themDong}>+ Thêm dòng</Button>
            </div>
            <div className="space-y-3">
              {dong.map((d, i) => {
                const vuotTon = d.ton !== null && d.soLuong > d.ton;
                return (
                  <div key={d.key} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Dòng {i + 1}</span>
                      {dong.length > 1 && (
                        <button
                          type="button"
                          onClick={() => xoaDong(d.key)}
                          className="cursor-pointer text-xs text-red-600 hover:underline"
                        >
                          Xoá dòng
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Mã hàng *</span>
                        <MaHangPicker sku={d.sku} tenHang={d.tenHang} onChon={(bt) => onChonMaHang(d.key, bt)} />
                      </div>
                      <label className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Kho *</span>
                        <select
                          className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={d.kho}
                          onChange={(e) => onKhoChange(d.key, d.sku, e.target.value)}
                        >
                          {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Số lượng *</span>
                        <Stepper value={d.soLuong} onChange={(v) => capNhat(d.key, { soLuong: kepSoLuong(v) })} />
                      </div>
                      <label className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Hình thức *</span>
                        <select
                          className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={d.hinhThuc}
                          onChange={(e) => onHinhThucChange(d.key, e.target.value as HinhThuc)}
                        >
                          <option value="tang">Tặng</option>
                          <option value="muon">Mượn</option>
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="mb-1 block text-muted-foreground">
                          Hạn trả {d.hinhThuc === 'muon' ? '*' : '(chỉ áp dụng khi mượn)'}
                        </span>
                        <input
                          type="date"
                          className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                          value={d.hanTra}
                          disabled={d.hinhThuc !== 'muon'}
                          onChange={(e) => capNhat(d.key, { hanTra: e.target.value })}
                        />
                      </label>
                      <div className="text-xs">
                        <span className="mb-1 block text-muted-foreground">Giá vốn (tự tra)</span>
                        <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-2">
                          {d.dangTraGiaVon ? (
                            <span className="text-muted-foreground">đang tra…</span>
                          ) : d.giaVon.trim() ? (
                            <span className="font-medium tabular-nums">
                              {formatMoneyForDisplay(d.giaVon)} {d.giaVonTienTe}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">— chưa có</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Tồn khả dụng tại {d.kho}</span>
                      {d.tonDangTai ? (
                        <span className="text-muted-foreground">đang tra…</span>
                      ) : d.ton === null ? (
                        <span className="text-muted-foreground">— chưa tra</span>
                      ) : (
                        <span className={vuotTon ? 'font-medium text-red-600' : 'font-medium'}>{d.ton}</span>
                      )}
                    </div>

                    {vuotTon && (
                      <p className="text-xs font-medium text-amber-600">
                        ⚠ Số lượng ({d.soLuong}) vượt tồn khả dụng ({d.ton}) của {d.sku} tại kho {d.kho} — có thể tạo đơn
                        nháp ngay nhưng chốt đơn sẽ thất bại cho tới khi nhập thêm hàng.
                      </p>
                    )}
                    {d.sku && !d.giaVon.trim() && !d.dangTraGiaVon && (
                      <p className="text-xs text-muted-foreground">
                        Chưa tra được giá vốn — dòng này sẽ KHÔNG vào báo cáo chi phí cho tới khi được điền ở màn chi tiết đơn.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {soDongThieuGia > 0 && (
              <p className="text-xs font-medium text-amber-600">
                ⚠ {soDongThieuGia} dòng chưa có giá vốn — các dòng này sẽ KHÔNG vào báo cáo chi phí cho tới khi được điền.
              </p>
            )}
          </div>

          {err && <p className="text-sm font-medium text-red-600">{err}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpenDialog(false)} disabled={pending}>Huỷ</Button>
          <Button type="button" onClick={submit} disabled={pending}>{pending ? 'Đang tạo…' : 'Tạo đơn (nháp)'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
