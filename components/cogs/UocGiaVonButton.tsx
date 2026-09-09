'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { uocGiaVonDuTinhAction } from '@/features/cogs/actions';

type KetQua = Awaited<ReturnType<typeof uocGiaVonDuTinhAction>>;

/** Ước giá vốn DỰ TÍNH cho SKU chưa có bảng giá: giá thực gần nhất của SKU / cùng mã sản phẩm (bảng kê), rồi MMP niêm yết VND × CK. */
export function UocGiaVonButton({ stores }: { stores: Array<{ id: string; name: string }> }) {
  const [storeId, setStoreId] = useState(stores.find((s) => s.name === 'meanblvd')?.id ?? stores[0]?.id ?? '');
  const [kq, setKq] = useState<KetQua | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chay = (dryRun: boolean) => start(async () => {
    setLoi(null);
    try { setKq(await uocGiaVonDuTinhAction(storeId, dryRun)); } catch (e) { setLoi(e instanceof Error ? e.message : String(e)); }
  });
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="text-sm font-medium">Giá vốn dự tính cho SKU chưa có bảng giá</div>
      <p className="text-xs text-muted-foreground">Nguồn theo thứ tự: giá nội địa của đúng SKU → của cùng mã sản phẩm cùng brand (bỏ size/màu), lấy từ bảng kê gần nhất → MMP niêm yết VND. Giá dự tính = giá nội địa × (1 − CK brand <b>đúng tháng đơn</b>) — tier CK tính theo doanh số tháng nên mỗi lần CK brand đổi ghi một mức giá hiệu lực đầu tháng; tháng chưa kê dùng CK kỳ gần nhất trước đó (tạm). SKU có CK riêng (phụ kiện 0 %…) giữ CK riêng. Ghi vào bảng giá (sku_costs, nguồn "uoc:…@ck=kỳ"), không đụng bảng giá ops upload. Giá thực từ bảng kê luôn đè lên dự tính.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Store
          <select className="mt-1 block rounded border px-2 py-1" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <Button variant="outline" onClick={() => chay(true)} disabled={pending || !storeId}>Xem trước</Button>
        <Button onClick={() => chay(false)} disabled={pending || !storeId}>Ghi giá dự tính</Button>
        {pending && <span className="text-sm text-muted-foreground">Đang tính…</span>}
        {loi && <span className="text-sm text-red-600">{loi}</span>}
      </div>
      {kq && (
        <div className="space-y-2 text-sm">
          <div>
            {kq.dryRun ? 'Xem trước' : `Đã ghi ${kq.daGhi} dòng`}: <b>{kq.skuXet}</b> SKU đã bán · {kq.daCoGia} đã có bảng giá · ước được <b>{kq.uocLichSuSku + kq.uocLichSuMaSp + kq.uocMmp}</b> (đúng SKU {kq.uocLichSuSku} · cùng mã SP {kq.uocLichSuMaSp} · MMP VND {kq.uocMmp}) · chưa có giá <b>{kq.khong}</b>
            {' · '}theo tier tháng <b>{kq.skuTheoTier}</b> SKU → <b>{kq.soMucGia}</b> mức giá
          </div>
          {kq.brandDoiCk.length > 0 && (
            <div className="text-xs text-muted-foreground">Brand có CK đổi theo tháng: {kq.brandDoiCk.map((b) => `${b.brandSlug} (${b.ckTheoKy.map(([ky, c]) => `${ky.slice(5)}:${Math.round(c * 100)}%`).join(' ')})`).join(' · ')}</div>
          )}
          {kq.khongTheoVendor.length > 0 && (
            <div className="text-xs text-muted-foreground">Chưa có giá theo brand: {kq.khongTheoVendor.slice(0, 20).map((v) => `${v.vendor} ${v.n}`).join(' · ')}{kq.khongTheoVendor.length > 20 ? ' …' : ''}</div>
          )}
        </div>
      )}
    </CardContent></Card>
  );
}
