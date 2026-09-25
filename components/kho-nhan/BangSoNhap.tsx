'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { nhanKho } from '@/features/warehouse/ten-kho';
import {
  dinhDanh, qcCheckLark, storeFinalLark, warehouseLark, whActionLark,
} from '@/features/kho-nhan/cot-lark';
import { INVENTORY_TYPE_RETAIL } from '@/features/kho-nhan/wh-lark-payload';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import { doiChieuNgay } from '@/features/kho-nhan/doi-chieu';
import type { KetQuaDoiChieu } from '@/features/kho-nhan/doi-chieu-logic';
import { coLech } from '@/features/kho-nhan/doi-chieu-logic';
import type { DongSoNhap } from '@/features/kho-nhan/types';

function gio(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(d));
}

/* Màu theo kết quả; CHỮ thì lấy nguyên văn tên lựa chọn của Lark (qcCheckLark)
 * để người ngồi so hai màn không phải dịch trong đầu. */
const MAU_QC: Record<string, string> = {
  pending: 'text-amber-600 dark:text-amber-400',
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-red-600 dark:text-red-400',
};

/** Ô trống hiện dấu — để phân biệt "không có giá trị" với "chưa tải xong". */
function O({ v }: { v: string | null | undefined }) {
  return v ? <>{v}</> : <span className="text-muted-foreground">—</span>;
}

export function BangSoNhap({
  dong, ngay, kho, cacNgay,
}: {
  dong: DongSoNhap[]; ngay: string; kho: string; cacNgay: string[];
}) {
  const router = useRouter();
  const [ket, setKet] = useState<KetQuaDoiChieu | null>(null);
  const [dangSoi, setDangSoi] = useState(false);

  const doiLoc = (k: 'ngay' | 'kho', v: string) => {
    const p = new URLSearchParams({ ngay, kho });
    if (v) p.set(k, v); else p.delete(k);
    router.push(`/f/warehouse/dong-bo?${p.toString()}`);
  };

  const soi = async () => {
    setDangSoi(true); setKet(null);
    try {
      const r = await doiChieuNgay(ngay);
      if (!r.ok || !r.ket) { toast.error(r.loi ?? 'Đối chiếu thất bại.', { duration: 10000 }); return; }
      setKet(r.ket);
      if (coLech(r.ket)) toast.error('Hai bên đang lệch — xem bảng bên dưới.', { duration: 10000 });
      else toast.success(`Khớp hoàn toàn: ${r.ket.khop} dòng.`, { duration: 3000 });
    } catch (e) {
      console.error('[kho-nhan] đối chiếu lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.', { duration: 10000 });
    } finally {
      setDangSoi(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Ngày nhận</span>
          <select
            value={ngay} onChange={(e) => doiLoc('ngay', e.target.value)}
            className="h-10 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {cacNgay.length === 0 && <option value="">chưa có ngày nào</option>}
            {cacNgay.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Kho</span>
          <select
            value={kho} onChange={(e) => doiLoc('kho', e.target.value)}
            className="h-10 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Tất cả kho</option>
            {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{nhanKho(k)}</option>)}
          </select>
        </label>
        <Button type="button" onClick={() => void soi()} disabled={dangSoi || !ngay}>
          {dangSoi ? 'Đang đối chiếu…' : 'Đối chiếu với Lark'}
        </Button>
      </div>

      {ket && <KhoiLech ket={ket} />}

      {dong.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Không có chiếc nào khớp bộ lọc này.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full whitespace-nowrap text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                {['Định danh', 'Warehouse', 'Ngày Import', 'Inventory type',
                  'Import (select order)', 'Store final', 'Vendor final',
                  'Order Number final', 'Lineitem Name', 'Lineitem SKU final',
                  'Qty trước QC', 'QC Check', 'Lý do QC failed', 'Ảnh lỗi QC',
                  'WH - Action'].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {dong.map((c) => {
                const action = whActionLark(c);
                return (
                  <tr key={c.id} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1.5 font-mono">
                      {dinhDanh({ maDon: c.maDon, sku: c.sku, uniqueCode: c.larkUniqueCode })}
                    </td>
                    <td className="px-2 py-1.5">{warehouseLark(c.kho)}</td>
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{gio(c.nhanLuc)}</td>
                    <td className="px-2 py-1.5">{INVENTORY_TYPE_RETAIL}</td>
                    <td className="px-2 py-1.5">
                      {c.larkRecordId
                        ? <span className="font-mono text-muted-foreground">{c.larkRecordId}</span>
                        : <span className="text-amber-600 dark:text-amber-400">chưa gửi</span>}
                    </td>
                    <td className="px-2 py-1.5"><O v={storeFinalLark(c.maDon)} /></td>
                    <td className="px-2 py-1.5"><O v={c.vendor} /></td>
                    <td className="px-2 py-1.5"><O v={c.maDon} /></td>
                    <td className="max-w-[240px] truncate px-2 py-1.5">
                      <O v={c.tenSanPham ?? c.tenBienThe} />
                    </td>
                    <td className="px-2 py-1.5 font-mono"><O v={c.sku} /></td>
                    {/* Mô hình bên mình MỖI DÒNG LÀ MỘT CHIẾC, nên số lượng
                        tiếp nhận luôn bằng 1 — không phải chỗ điền tay. */}
                    <td className="px-2 py-1.5 tabular-nums">1</td>
                    <td className={`px-2 py-1.5 ${MAU_QC[c.ketQuaQc] ?? ''}`}>{qcCheckLark(c.ketQuaQc)}</td>
                    <td className="max-w-[200px] truncate px-2 py-1.5">
                      <O v={c.lyDoLoi.length ? c.lyDoLoi.join(', ') : null} />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {c.soAnhLoi > 0 ? `${c.soAnhLoi} ảnh` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-1.5"><O v={action} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KhoiLech({ ket }: { ket: KetQuaDoiChieu }) {
  if (!coLech(ket)) {
    return (
      <p className="rounded-lg border border-border px-3 py-3 text-sm text-emerald-600 dark:text-emerald-400">
        Khớp hoàn toàn — {ket.khop} dòng trùng khít hai bên.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">Kết quả đối chiếu — {ket.khop} dòng khớp</p>
      <Muc
        ten="Chưa gửi lên Lark" so={ket.chuaGui.length}
        mau="text-amber-600 dark:text-amber-400"
        y="Bên mình có, Lark chưa biết. Bấm “Bắt đầu QC” ở màn Nhận & Kiểm để gửi."
        dong={ket.chuaGui.map((c) => `${c.unitCode} · ${c.maDon ?? '—'}`)}
      />
      <Muc
        ten="Đã gửi nhưng Lark không còn" so={ket.matTrenLark.length}
        mau="text-red-600 dark:text-red-400"
        y="Loại lệch âm thầm nhất: bên mình ghi là đã gửi, nhưng dòng đó đã biến mất khỏi Lark. Cần người kiểm tay."
        dong={ket.matTrenLark.map((c) => `${c.unitCode} · ${c.maDon ?? '—'}`)}
      />
      <Muc
        ten="Chỉ có trên Lark" so={ket.chiCoTrenLark.length}
        mau="text-muted-foreground"
        y="Đội kho nhập thẳng lên Lark — bình thường trong giai đoạn chạy song song hai hệ thống."
        dong={ket.chiCoTrenLark.map((d) => `${d.maDon ?? '—'} · ${d.sku ?? '—'}`)}
      />
    </div>
  );
}

function Muc({ ten, so, mau, y, dong }: {
  ten: string; so: number; mau: string; y: string; dong: string[];
}) {
  if (so === 0) return null;
  return (
    <details className="rounded-lg bg-muted px-3 py-2">
      <summary className={`cursor-pointer ${mau}`}>{ten}: {so}</summary>
      <p className="mt-1 text-xs text-muted-foreground">{y}</p>
      <ul className="mt-1 space-y-0.5 font-mono text-xs">
        {dong.slice(0, 50).map((d) => <li key={d}>{d}</li>)}
      </ul>
      {dong.length > 50 && (
        <p className="mt-1 text-xs text-muted-foreground">… còn {dong.length - 50} dòng nữa</p>
      )}
    </details>
  );
}
