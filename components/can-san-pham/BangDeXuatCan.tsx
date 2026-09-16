'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { duyetVaDayCan, boQuaDeXuat, type KetQuaDay, type TrangDeXuat } from '@/features/can-san-pham/actions';

const kg = (g: number | null) => (g == null ? '—' : `${Math.round(g / 10) / 100}kg`);

export function BangDeXuatCan({ trang }: { trang: TrangDeXuat }) {
  const router = useRouter();
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [mo, setMo] = useState<string | null>(null);
  const [ketQua, setKetQua] = useState<KetQuaDay[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dayDuoc = trang.duyetDuoc && trang.coQuyenGhi;
  // "Chọn tất cả" bỏ qua dòng nghi thùng quá to — những dòng đó phải tick tay sau khi xem lại.
  const coTheChon = trang.dong.filter((d) => d.bienThe.length > 0 && !d.nghiThungTo);
  const tatCa = coTheChon.length > 0 && coTheChon.every((d) => chon.has(d.sku));
  const doi = (sku: string) => setChon((c) => { const n = new Set(c); if (n.has(sku)) n.delete(sku); else n.add(sku); return n; });

  const day = () => {
    const ds = trang.dong.filter((d) => chon.has(d.sku)).map((d) => ({ sku: d.sku, canMoiG: d.canDeXuatG }));
    if (!ds.length) return;
    if (!confirm(`Đẩy cân mới lên Shopify cho ${ds.length} SKU? Cân cũ được lưu lại trước khi đổi.`)) return;
    start(async () => {
      try { setKetQua(await duyetVaDayCan(ds)); setChon(new Set()); setLoi(null); router.refresh(); }
      catch (e) { setLoi(String((e as Error).message ?? e)); }
    });
  };
  const boQua = (sku: string, g: number) => start(async () => {
    try { await boQuaDeXuat(sku, g); router.refresh(); }
    catch (e) { setLoi(String((e as Error).message ?? e)); }
  });

  return (
    <div className="space-y-3">
      {trang.duyetDuoc && !trang.coQuyenGhi && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <b>Chưa đẩy được lên Shopify:</b> app chưa có quyền <code>write_products</code> trên store MEAN BLVD.
          Cần thêm quyền vào biến <code>SHOPIFY_SCOPES</code> trên Railway rồi kết nối lại store ở trang Stores.
          Danh sách vẫn xem được để sửa tay trong lúc chờ.
        </div>
      )}

      {ketQua && (
        <div className="rounded-md border border-border p-3 text-sm">
          Đã đẩy <b>{ketQua.filter((k) => k.ok).length}</b>/{ketQua.length} SKU.
          {ketQua.filter((k) => !k.ok).map((k) => (
            <div key={k.sku} className="text-xs text-red-600 dark:text-red-400">{k.sku}: {k.loi}</div>
          ))}
        </div>
      )}
      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      <Card><CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="text-sm">
            <b>{trang.dong.length}</b> SKU đang khai cân thấp hơn cân hãng tính
            <span className="ml-2 text-xs text-muted-foreground">cân Shopify đồng bộ lúc {trang.dongBoLuc?.slice(0, 16) ?? '—'}</span>
          </div>
          {trang.duyetDuoc && (
            <button type="button" onClick={day} disabled={!dayDuoc || chon.size === 0 || pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {pending ? 'Đang đẩy…' : `Duyệt và đẩy ${chon.size || ''} lên Shopify`}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                {trang.duyetDuoc && (
                  <th className="w-8 text-left">
                    <input type="checkbox" aria-label="Chọn tất cả" className="accent-primary" checked={tatCa} disabled={!dayDuoc}
                      onChange={() => setChon(tatCa ? new Set() : new Set(coTheChon.map((d) => d.sku)))} />
                  </th>
                )}
                <th className="text-left">SKU / sản phẩm</th>
                <th className="text-right">Cân hiện tại</th>
                <th className="text-right">Cân đề xuất</th>
                <th className="text-right">Tăng</th>
                <th className="text-right">Số đơn</th>
                <th className="text-right"></th>
              </tr>
            </thead>
            <tbody>
              {trang.dong.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Không còn SKU nào cần sửa cân.</td></tr>
              )}
              {trang.dong.map((d) => {
                const dau = d.bienThe[0];
                return (
                  <Fragment key={d.sku}>
                    <tr className="border-t border-border/60 align-top [&>td]:px-3 [&>td]:py-2">
                      {trang.duyetDuoc && (
                        <td><input type="checkbox" aria-label={`Chọn ${d.sku}`} className="accent-primary"
                          disabled={!dayDuoc || d.bienThe.length === 0} checked={chon.has(d.sku)} onChange={() => doi(d.sku)} /></td>
                      )}
                      <td className="text-left">
                        <button type="button" onClick={() => setMo(mo === d.sku ? null : d.sku)} className="flex items-start gap-1 text-left">
                          <ChevronRight className={`mt-0.5 size-3.5 shrink-0 transition ${mo === d.sku ? 'rotate-90' : ''}`} />
                          <span>
                            <span className="block font-mono text-xs">{d.sku}</span>
                            <span className="block text-xs text-muted-foreground">
                              {dau ? `${dau.productTitle}${dau.variantTitle ? ` · ${dau.variantTitle}` : ''}` : 'Không tìm thấy biến thể trên Shopify'}
                              {d.bienThe.length > 1 && ` · ${d.bienThe.length} biến thể cùng SKU`}
                            </span>
                            {d.nghiThungTo && <span className="block text-[11px] font-medium text-amber-600 dark:text-amber-400">Nghi đóng thùng quá to — cân quy đổi gấp đôi cân thực. Tăng cân web sẽ đẩy cước khách lên; xem lại khâu đóng gói trước khi duyệt.</span>}
                            {d.canLech && <span className="block text-[11px] text-amber-600 dark:text-amber-400">Các biến thể cùng SKU đang khai cân khác nhau</span>}
                            {d.lanDayLoi && <span className="block text-[11px] text-red-600 dark:text-red-400">Lần đẩy trước lỗi: {d.lanDayLoi}</span>}
                          </span>
                        </button>
                      </td>
                      <td className="text-right text-muted-foreground">{kg(d.canHienTaiG)}</td>
                      <td className="text-right font-semibold">{kg(d.canDeXuatG)}</td>
                      <td className="text-right text-emerald-600 dark:text-emerald-400">+{kg(d.canDeXuatG - (d.canHienTaiG ?? 0))}</td>
                      <td className="text-right">{d.bangChung.length}</td>
                      <td className="text-right">
                        {trang.duyetDuoc && (
                          <button type="button" onClick={() => boQua(d.sku, d.canDeXuatG)} disabled={pending}
                            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Bỏ qua</button>
                        )}
                      </td>
                    </tr>
                    {mo === d.sku && (
                      <tr className="bg-muted/30">
                        <td colSpan={7} className="px-10 py-2 text-xs">
                          <div className="mb-1 font-medium">Bằng chứng</div>
                          <ul className="space-y-0.5 tabular-nums">
                            {d.bangChung.map((b) => (
                              <li key={b.maDon}>{b.maDon}: hãng tính cả kiện {b.billedKg}kg · giải trình chọn món này, cân đúng {kg(b.deXuatG)}{b.thungQuaTo && <span className="text-amber-600 dark:text-amber-400"> · thùng quá to</span>}</li>
                            ))}
                          </ul>
                          <p className="mt-1 text-muted-foreground">
                            Cân đúng do người giải trình nhập cho đúng món này ở tiêu chí 1.1; nhiều đơn thì lấy mức cao nhất.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
