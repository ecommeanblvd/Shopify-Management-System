'use client';

import { useState } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { nhanKho } from '@/features/warehouse/ten-kho';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import { doiChieuNgay } from '@/features/kho-nhan/doi-chieu';
import type { KetQuaDoiChieu } from '@/features/kho-nhan/doi-chieu-logic';
import { coLech } from '@/features/kho-nhan/doi-chieu-logic';
import type { DongSoNhap } from '@/features/kho-nhan/types';

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

/** Tên lựa chọn QC Check NGUYÊN VĂN của Lark → màu nhãn. */
const MAU_QC: Record<string, Mau> = {
  'QC Pass': 'dat',
  'QC Failed': 'khongDat',
  'Tiếp nhận - chưa QC': 'choQc',
  'Gửi dư': 'loai',
};

function O({ v }: { v: string | null | undefined }) {
  return v ? <>{v}</> : <span className="text-muted-foreground">—</span>;
}

const GIAI_THICH = 'Sổ ghi mọi chiếc đã nhận, chia theo ngày, dựng theo đúng hình bảng Lark '
  + 'WH - Inventory. Nút đối chiếu chỉ ĐỌC hai bên và chỉ ra chỗ lệch — không tự sửa bên nào.';

const COT = ['Định danh', 'Warehouse', 'Inventory type', 'Store final', 'Vendor final',
  'Order Number final', 'Lineitem Name', 'Lineitem SKU final', 'Qty', 'QC Check',
  'WH - Action', 'Ảnh SP', 'BBGN', 'Nguồn'];

export function BangSoNhap({ dong, kho, capNhatLuc }: {
  dong: DongSoNhap[]; kho: string; capNhatLuc: Date | null;
}) {
  const router = useRouter();
  const [ket, setKet] = useState<Record<string, KetQuaDoiChieu>>({});
  const [dangSoi, setDangSoi] = useState<string | null>(null);

  // Bản sao đã sắp theo ngày giảm dần nên chỉ cần gom liên tiếp, không sắp lại.
  const mang: { ngay: string; dong: DongSoNhap[] }[] = [];
  for (const c of dong) {
    const n = c.ngayImport ?? '(không rõ ngày)';
    if (mang[mang.length - 1]?.ngay !== n) mang.push({ ngay: n, dong: [] });
    mang[mang.length - 1]!.dong.push(c);
  }

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
      <div className="flex flex-wrap items-end gap-4">
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
        {/* Trang đọc BẢN SAO kéo về mỗi 6 tiếng, nên phải nói rõ bản sao cũ cỡ
            nào — im lặng là người xem tưởng đang nhìn Lark thời gian thực. */}
        <p className="text-xs text-muted-foreground">
          Bản sao Lark cập nhật lúc{' '}
          {capNhatLuc
            ? new Intl.DateTimeFormat('vi-VN', {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
                timeZone: 'Asia/Bangkok',
              }).format(new Date(capNhatLuc))
            : 'chưa kéo lần nào'}
        </p>
      </div>

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
              {/* Lời giải thích nằm trong tooltip chứ không in ra màn (CEO
                  25/09) — nó chỉ cần thiết đúng lúc người ta định bấm. */}
              <span
                title={GIAI_THICH}
                aria-label={GIAI_THICH}
                className="cursor-help text-muted-foreground hover:text-foreground"
              >
                <CircleAlertIcon className="size-4" />
              </span>
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
                      <tr key={c.recordId} className="border-b border-border last:border-b-0">
                        <td className="px-2 py-1.5 font-mono"><O v={c.dinhDanh} /></td>
                        <td className="px-2 py-1.5">
                          {c.warehouse ? <Nhan mau="kho">{c.warehouse}</Nhan> : <O v={null} />}
                        </td>
                        <td className="px-2 py-1.5">
                          {c.inventoryType ? <Nhan mau="loai">{c.inventoryType}</Nhan> : <O v={null} />}
                        </td>
                        <td className="px-2 py-1.5"><O v={c.storeFinal} /></td>
                        <td className="px-2 py-1.5"><O v={c.vendorFinal} /></td>
                        <td className="px-2 py-1.5"><O v={c.orderNumber} /></td>
                        <td className="max-w-[240px] truncate px-2 py-1.5"><O v={c.lineitemName} /></td>
                        <td className="px-2 py-1.5 font-mono"><O v={c.sku} /></td>
                        <td className="px-2 py-1.5 tabular-nums"><O v={c.soLuong?.toString()} /></td>
                        <td className="px-2 py-1.5">
                          {c.qcCheck
                            ? <Nhan mau={MAU_QC[c.qcCheck] ?? 'mo'}>{c.qcCheck}</Nhan>
                            : <O v={null} />}
                        </td>
                        <td className="px-2 py-1.5">
                          {c.whAction ? <Nhan mau="mo">{c.whAction.trim()}</Nhan> : <O v={null} />}
                        </td>
                        <td className="px-2 py-1.5 text-center">{c.coAnhHangDen ? '✓' : '—'}</td>
                        <td className="px-2 py-1.5 text-center">{c.coBbBanGiao ? '✓' : '—'}</td>
                        <td className="px-2 py-1.5">
                          {c.cuaHeThong
                            ? <Nhan mau="dat">hệ thống</Nhan>
                            : <Nhan mau="mo">nhập trên Lark</Nhan>}
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
