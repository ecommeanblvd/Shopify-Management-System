'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { nhanKho } from '@/features/warehouse/ten-kho';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import { gomTheoNgay } from '@/features/kho-nhan/tach-ngay';
import {
  dinhDanh, qcCheckLark, storeFinalLark, warehouseLark, whActionLark,
} from '@/features/kho-nhan/cot-lark';
import { INVENTORY_TYPE_RETAIL } from '@/features/kho-nhan/wh-lark-payload';
import { doiChieuNgay } from '@/features/kho-nhan/doi-chieu';
import type { KetQuaDoiChieu } from '@/features/kho-nhan/doi-chieu-logic';
import { coLech } from '@/features/kho-nhan/doi-chieu-logic';
import type { DongSoNhap } from '@/features/kho-nhan/types';

function gio(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  }).format(new Date(d));
}

/** 'YYYY-MM-DD' → 'dd/mm/yyyy', đúng cách bảng Lark đặt tiêu đề mảng. */
function ngayVn(s: string): string {
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

type Mau = 'kho' | 'loai' | 'dat' | 'khongDat' | 'choQc' | 'mo';

/** Nhãn bo tròn — bảng Lark hiện các cột chọn kiểu này, nhìn lướt là ra. */
function Nhan({ mau, children }: { mau: Mau; children: React.ReactNode }) {
  const lop: Record<Mau, string> = {
    kho: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    loai: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dat: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    khongDat: 'bg-red-500/15 text-red-700 dark:text-red-300',
    choQc: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    mo: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${lop[mau]}`}>
      {children}
    </span>
  );
}

const MAU_QC: Record<string, Mau> = { pass: 'dat', fail: 'khongDat', pending: 'choQc' };

function O({ v }: { v: string | null | undefined }) {
  return v ? <>{v}</> : <span className="text-muted-foreground">—</span>;
}

const COT = ['Định danh', 'Warehouse', 'Nhận lúc', 'Inventory type', 'Import (select order)',
  'Store final', 'Vendor final', 'Order Number final', 'Lineitem Name', 'Lineitem SKU final',
  'Qty', 'QC Check', 'Lý do QC failed', 'Ảnh lỗi', 'WH - Action'];

export function BangSoNhap({ dong, kho }: { dong: DongSoNhap[]; kho: string }) {
  const router = useRouter();
  const [ket, setKet] = useState<Record<string, KetQuaDoiChieu>>({});
  const [dangSoi, setDangSoi] = useState<string | null>(null);

  const mang = gomTheoNgay(dong);

  const soi = async (ngay: string) => {
    setDangSoi(ngay);
    try {
      const r = await doiChieuNgay(ngay);
      if (!r.ok || !r.ket) { toast.error(r.loi ?? 'Đối chiếu thất bại.', { duration: 10000 }); return; }
      setKet((p) => ({ ...p, [ngay]: r.ket! }));
      if (coLech(r.ket)) toast.error(`${ngayVn(ngay)}: hai bên đang lệch — xem chi tiết trong mảng.`, { duration: 10000 });
      else toast.success(`${ngayVn(ngay)}: khớp hoàn toàn, ${r.ket.khop} dòng.`, { duration: 3000 });
    } catch (e) {
      console.error('[kho-nhan] đối chiếu lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại.', { duration: 10000 });
    } finally {
      setDangSoi(null);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex w-fit flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Kho</span>
        <select
          value={kho}
          onChange={(e) => router.push(`/f/warehouse/dong-bo${e.target.value ? `?kho=${e.target.value}` : ''}`)}
          className="h-10 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">Tất cả kho</option>
          {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{nhanKho(k)}</option>)}
        </select>
      </label>

      {mang.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Chưa có chiếc nào được ghi nhận.
        </p>
      ) : (
        mang.map((m, i) => (
          // Mảng mới nhất mở sẵn, các mảng cũ gập lại — bảng Lark cũng gom theo
          // ngày như vậy, và việc của kho gần như luôn nằm ở ngày trên cùng.
          <details key={m.ngay} open={i === 0} className="rounded-lg border border-border">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2">
              <span className="text-sm font-semibold">{ngayVn(m.ngay)}</span>
              <span className="text-xs text-muted-foreground">{m.dong.length} chiếc</span>
              <Button
                type="button" variant="outline" size="sm"
                disabled={dangSoi !== null}
                onClick={(e) => { e.preventDefault(); void soi(m.ngay); }}
              >
                {dangSoi === m.ngay ? 'Đang đối chiếu…' : 'Đối chiếu Lark'}
              </Button>
            </summary>

            <div className="border-t border-border p-3">
              {ket[m.ngay] && <KhoiLech ket={ket[m.ngay]!} />}
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-xs">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>{COT.map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {m.dong.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-b-0">
                        <td className="px-2 py-1.5 font-mono">
                          {dinhDanh({ maDon: c.maDon, sku: c.sku, uniqueCode: c.larkUniqueCode })}
                        </td>
                        <td className="px-2 py-1.5"><Nhan mau="kho">{warehouseLark(c.kho)}</Nhan></td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{gio(c.nhanLuc)}</td>
                        <td className="px-2 py-1.5"><Nhan mau="loai">{INVENTORY_TYPE_RETAIL}</Nhan></td>
                        <td className="px-2 py-1.5">
                          {c.larkRecordId
                            ? <Nhan mau="mo">{c.maDon ?? c.larkRecordId}</Nhan>
                            : <Nhan mau="choQc">chưa gửi</Nhan>}
                        </td>
                        <td className="px-2 py-1.5"><O v={storeFinalLark(c.maDon)} /></td>
                        <td className="px-2 py-1.5"><O v={c.vendor} /></td>
                        <td className="px-2 py-1.5"><O v={c.maDon} /></td>
                        <td className="max-w-[240px] truncate px-2 py-1.5"><O v={c.tenSanPham ?? c.tenBienThe} /></td>
                        <td className="px-2 py-1.5 font-mono"><O v={c.sku} /></td>
                        <td className="px-2 py-1.5 tabular-nums">1</td>
                        <td className="px-2 py-1.5">
                          <Nhan mau={MAU_QC[c.ketQuaQc] ?? 'mo'}>{qcCheckLark(c.ketQuaQc)}</Nhan>
                        </td>
                        <td className="max-w-[200px] truncate px-2 py-1.5">
                          <O v={c.lyDoLoi.length ? c.lyDoLoi.join(', ') : null} />
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {c.soAnhLoi > 0 ? `${c.soAnhLoi} ảnh` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          {whActionLark(c)
                            ? <Nhan mau={c.ketQuaQc === 'pass' ? 'dat' : 'choQc'}>{whActionLark(c)}</Nhan>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))
      )}
    </div>
  );
}

function KhoiLech({ ket }: { ket: KetQuaDoiChieu }) {
  if (!coLech(ket)) {
    return (
      <p className="mb-3 rounded-lg border border-border px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
        Khớp hoàn toàn — {ket.khop} dòng trùng khít hai bên.
      </p>
    );
  }
  return (
    <div className="mb-3 space-y-2 rounded-lg border border-border p-3 text-sm">
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
        y="Loại lệch âm thầm nhất: bên mình ghi là đã gửi, nhưng dòng đó đã biến mất khỏi Lark."
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
