'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { xemTruocAction, apDungAction } from '@/features/cogs/actions';
import type { XemTruoc } from '@/features/cogs/bang-ke-import';

const tien = (n: number): string => n.toLocaleString('vi-VN') + ' ₫';

interface BangKeImporterProps {
  brands: Array<{ slug: string; displayName: string }>;
}

/** Form nhập bảng kê brand: Xem trước (đọc + ghép, không ghi) rồi Áp dụng theo kỳ đã chọn. */
export function BangKeImporter({ brands }: BangKeImporterProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<XemTruoc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [pendingApply, startApply] = useTransition();

  const onPreview = (): void => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    setError(null);
    startPreview(async () => {
      try {
        const r = await xemTruocAction(fd);
        setPreview(r);
        if (r.loi) {
          setSelected(new Set());
          toast.error(r.loi);
        } else {
          setSelected(new Set(r.ky.map((k) => k.period)));
        }
      } catch (e) {
        setPreview(null);
        setSelected(new Set());
        const msg = e instanceof Error ? e.message : 'Lỗi không rõ';
        setError(msg);
        toast.error(msg);
      }
    });
  };

  const togglePeriod = (period: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period); else next.add(period);
      return next;
    });
  };

  const onApply = (): void => {
    const form = formRef.current;
    if (!form || !preview) return;
    const fd = new FormData(form);
    for (const p of selected) fd.append('periods', p);
    startApply(async () => {
      try {
        const r = await apDungAction(fd);
        const tongDong = r.daGhi.reduce((s, d) => s + d.lines, 0);
        const tongOffline = r.daGhi.reduce((s, d) => s + d.offline, 0);
        const tongReturn = r.daGhi.reduce((s, d) => s + d.returns, 0);
        const tomTat = `Đã ghi ${r.daGhi.length} kỳ — ${tongDong} dòng, ${tongOffline} offline, ${tongReturn} return`;
        if (r.loi) {
          // Một kỳ sau lỗi giữa chừng — apDungBangKe vẫn trả về những kỳ ĐÃ
          // GHI trước đó thay vì throw, nên phải báo cả hai: đã ghi tới đâu
          // và lỗi gì, không được nuốt mất thông tin đã ghi.
          toast.error(`${tomTat}. ${r.loi}`);
        } else {
          toast.success(tomTat);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Lỗi không rõ');
      }
    });
  };

  const coLoi = preview?.loi != null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6 space-y-4">
          <form ref={formRef} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="brandSlug">Brand</Label>
                <select
                  id="brandSlug"
                  name="brandSlug"
                  required
                  className="w-full h-9 border border-input bg-input/30 rounded-md px-3 text-sm"
                >
                  <option value="">— Chọn brand —</option>
                  {brands.map((b) => (
                    <option key={b.slug} value={b.slug}>{b.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="url">Link Google Sheet</Label>
                <Input id="url" name="url" placeholder="https://docs.google.com/spreadsheets/d/..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="file">Hoặc chọn file (.xlsx, .csv)</Label>
              <Input id="file" name="file" type="file" accept=".xlsx,.csv" />
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={onPreview} disabled={pendingPreview}>
                {pendingPreview ? 'Đang xem trước…' : 'Xem trước'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onApply}
                disabled={!preview || coLoi || selected.size === 0 || pendingApply}
              >
                {pendingApply ? 'Đang áp dụng…' : `Áp dụng ${selected.size} kỳ`}
              </Button>
            </div>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="p-6 space-y-4">
            {preview.loi && <p className="text-sm text-destructive">{preview.loi}</p>}
            {preview.boQua.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Bỏ qua tab: {preview.boQua.join(', ')}
              </p>
            )}

            {preview.ky.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Kỳ</TableHead>
                      <TableHead>Tab</TableHead>
                      <TableHead className="text-right">Dòng (A+B)</TableHead>
                      <TableHead className="text-right">Khớp SKU</TableHead>
                      <TableHead className="text-right">Khớp mã gốc</TableHead>
                      <TableHead className="text-right">Đơn 1 line</TableHead>
                      <TableHead className="text-right">Offline</TableHead>
                      <TableHead className="text-right">Không khớp</TableHead>
                      <TableHead className="text-right">Return</TableHead>
                      <TableHead className="text-right">Σ TT</TableHead>
                      <TableHead className="text-right">Lệch CT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.ky.map((k) => (
                      <TableRow key={k.period}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(k.period)}
                            onChange={() => togglePeriod(k.period)}
                          />
                        </TableCell>
                        <TableCell className="font-mono">{k.period}</TableCell>
                        <TableCell>{k.sheet}</TableCell>
                        <TableCell className="text-right">{k.tongDong}</TableCell>
                        <TableCell className="text-right">{k.khopSku}</TableCell>
                        <TableCell className="text-right">{k.khopMaGoc}</TableCell>
                        <TableCell className="text-right">{k.donMotLine}</TableCell>
                        <TableCell className="text-right">{k.offline}</TableCell>
                        <TableCell className="text-right">{k.khongKhop.length}</TableCell>
                        <TableCell className="text-right">{k.returns}</TableCell>
                        <TableCell className="text-right">{tien(k.tongTT)}</TableCell>
                        <TableCell className="text-right">{k.lechCongThuc}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {preview.ky.some((k) => k.khongKhop.length > 0) && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Không khớp</summary>
                <ul className="mt-2 space-y-1 text-xs font-mono">
                  {preview.ky.flatMap((k) => k.khongKhop.map((x, i) => (
                    <li key={`${k.period}-${i}`}>
                      {k.period} — {x.maDon} / {x.sku} — {tien(x.tt)} — {x.lyDo}
                    </li>
                  )))}
                </ul>
              </details>
            )}

            {preview.ky.some((k) => k.du.length > 0) && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Sheet tính dư</summary>
                <ul className="mt-2 space-y-1 text-xs font-mono">
                  {preview.ky.flatMap((k) => k.du.map((x, i) => (
                    <li key={`${k.period}-${i}`}>
                      {k.period} — {x.maDon} / {x.sku} — sheet {x.slSheet} / hệ thống {x.quantity}
                    </li>
                  )))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
