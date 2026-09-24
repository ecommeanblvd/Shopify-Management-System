'use client';

import { useState, useTransition } from 'react';
import { LY_DO_HOP_LE, NHAN_LY_DO, type LyDoLoi } from '@/features/kho-nhan/loi-qc';
import { qcKhongDat } from '@/features/kho-nhan/qc-actions';
import { uploadReceiptImage } from '@/features/receiving/actions';
import { Button } from '@/components/ui/button';

interface DongLoiUi { key: string; lyDo: LyDoLoi; anhKey: string | null; anhTen: string; ghiChu: string }

const dongMoi = (): DongLoiUi =>
  ({ key: crypto.randomUUID(), lyDo: 'ban', anhKey: null, anhTen: '', ghiChu: '' });

/**
 * Khối nhập lỗi khi QC KHÔNG ĐẠT. Một chiếc có thể NHIỀU chỗ lỗi — bẩn gấu,
 * rách nách, hỏng khoá là ba dòng, mỗi dòng một ảnh (CEO 24/09).
 *
 * Ảnh tải qua `uploadReceiptImage` sẵn có; không viết lại đường tải ảnh.
 */
export function KhoiLoi({
  itemId, coStorage, onXong, onHuy,
}: {
  itemId: string; coStorage: boolean; onXong: () => void; onHuy: () => void;
}) {
  const [dong, setDong] = useState<DongLoiUi[]>([dongMoi()]);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dangTai, setDangTai] = useState<string | null>(null);

  const sua = (key: string, patch: Partial<DongLoiUi>) =>
    setDong((p) => p.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function chonAnh(key: string, file: File) {
    setDangTai(key); setLoi(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('scope', itemId);
      const k = await uploadReceiptImage(fd);
      sua(key, { anhKey: k, anhTen: file.name });
    } catch {
      setLoi('Tải ảnh thất bại, thử lại.');
    } finally {
      setDangTai(null);
    }
  }

  const luu = () =>
    start(async () => {
      setLoi(null);
      const r = await qcKhongDat(itemId, dong.map((d) => ({
        lyDo: d.lyDo, anhKey: d.anhKey, ghiChu: d.ghiChu,
      })));
      if (!r.ok) { setLoi(r.loi ?? 'Lưu thất bại.'); return; }
      onXong();
    });

  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Chỗ lỗi</h3>
        <button
          type="button"
          onClick={() => setDong((p) => [...p, dongMoi()])}
          className="cursor-pointer text-sm font-medium text-primary hover:underline"
        >
          + Thêm chỗ lỗi
        </button>
      </div>

      {!coStorage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Chưa cấu hình kho ảnh nên không đính được ảnh — vẫn lưu được lý do.
        </p>
      )}

      {dong.map((d, i) => (
        <div key={d.key} className="grid gap-2 rounded-md border border-border bg-background p-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Lý do {i + 1}</span>
            <select
              value={d.lyDo}
              onChange={(e) => sua(d.key, { lyDo: e.target.value as LyDoLoi })}
              aria-label={`Lý do chỗ lỗi ${i + 1}`}
              className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm"
            >
              {LY_DO_HOP_LE.map((l) => <option key={l} value={l}>{NHAN_LY_DO[l]}</option>)}
            </select>
          </label>

          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">
              Ghi chú{d.lyDo === 'khac' ? ' *' : ''}
            </span>
            <input
              value={d.ghiChu}
              onChange={(e) => sua(d.key, { ghiChu: e.target.value })}
              placeholder={d.lyDo === 'khac' ? 'Bắt buộc — ghi rõ lỗi gì' : 'Vị trí, mức độ…'}
              aria-label={`Ghi chú chỗ lỗi ${i + 1}`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>

          <div className="flex items-end gap-2">
            {coStorage && (
              <label className="cursor-pointer text-xs">
                <span className="mb-1 block text-muted-foreground">Ảnh *</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label={`Ảnh chỗ lỗi ${i + 1}`}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void chonAnh(d.key, f); }}
                  className="w-44 cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded file:border file:border-input file:bg-background file:px-2 file:py-1"
                />
              </label>
            )}
            {dangTai === d.key && <span className="pb-1 text-xs text-muted-foreground">đang tải…</span>}
            {d.anhKey && <span className="pb-1 text-xs text-emerald-600 dark:text-emerald-400">đã có ảnh</span>}
            {dong.length > 1 && (
              <button
                type="button"
                onClick={() => setDong((p) => p.filter((x) => x.key !== d.key))}
                aria-label={`Xoá chỗ lỗi ${i + 1}`}
                className="mb-1 cursor-pointer rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Xoá
              </button>
            )}
          </div>
        </div>
      ))}

      {loi && <p className="text-sm text-destructive">{loi}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onHuy}>Quay lại</Button>
        <Button
          type="button" variant="destructive" size="lg"
          onClick={luu} disabled={pending || dangTai !== null}
        >
          {pending ? 'Đang lưu…' : 'Lưu — trả brand'}
        </Button>
      </div>
    </div>
  );
}
