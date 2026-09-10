'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { DongBaoCao } from '@/features/cogs/bao-cao-logic';

const tien = (n: number): string => n.toLocaleString('vi-VN') + ' ₫';
const phanTram = (n: number): string => n.toLocaleString('vi-VN', { style: 'percent', maximumFractionDigits: 0 });

export interface LaiGopRow extends DongBaoCao {
  /** Tỉ giá USD→VND ÁP DỤNG cho tháng này (đã mượn tháng trước nếu thiếu). null = không có tỉ giá nào. */
  tiGiaHieuLuc: number | null;
}

export interface ChiTietDong {
  brandSlug: string | null;
  brandName: string;
  maDon: string;
  sku: string | null;
  amount: number;
  source: string;
  statementRef: string | null;
  kind: string;
}

interface LaiGopTableProps {
  rows: LaiGopRow[];
  /** 'tu=...&den=...&store=...&brand=...' — dùng lại cho link chi tiết + hai route CSV. */
  querySuffix: string;
  chiTietPeriod: string | null;
  chiTiet: ChiTietDong[] | null;
}

/** Bảng "Lãi gộp theo tháng" — spec §6. Số VND theo `vi-VN`; dòng thiếu tỉ giá ẩn số tiền quy đổi (Doanh thu/Phí ship/Lãi gộp) và gắn badge đỏ; tỉ giá tạm gắn badge vàng cạnh tháng. */
export function LaiGopTable({ rows, querySuffix, chiTietPeriod, chiTiet }: LaiGopTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <a
          href={`/f/orders/lai-gop/bang-thang.csv?${querySuffix}`}
          className="h-8 px-3 inline-flex items-center rounded-md border border-input text-xs font-medium hover:bg-muted"
        >
          Xuất CSV bảng tháng
        </a>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tháng</TableHead>
              <TableHead className="text-right">Doanh thu thuần</TableHead>
              <TableHead className="text-right">Phí ship</TableHead>
              <TableHead className="text-right">Giá vốn</TableHead>
              <TableHead className="text-right" title="Doanh thu thuần − phí ship − giá vốn. Chỉ hiện khi 100 % dòng đã có giá vốn; thiếu dòng nào thì số này là dương giả (COGS thiếu tính 0) nên thay bằng nhãn 'thiếu COGS'.">Lãi gộp</TableHead>
              <TableHead className="text-right" title="Margin SP trên phần đã đối soát = doanh thu (line) của đúng các dòng đã có giá vốn − giá vốn. Luôn có nghĩa dù độ phủ chưa đủ.">Margin SP dòng có COGS</TableHead>
              <TableHead className="text-right">Chi brand ngoài Shopify</TableHead>
              <TableHead className="text-right">Độ phủ line / doanh thu</TableHead>
              <TableHead className="text-right">Thuộc đơn tháng trước</TableHead>
              <TableHead className="text-right">Tỉ giá</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                  Không có dữ liệu trong khoảng đã chọn.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const anSo = r.thieuTiGia;
              const laiGopMau = anSo ? undefined : r.phuLine < 1 ? 'text-amber-700 dark:text-amber-400' : undefined;
              return (
                <TableRow key={r.period}>
                  <TableCell className="font-mono whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{r.period}</span>
                      {r.thieuTiGia && <Badge variant="destructive">thiếu tỉ giá</Badge>}
                      {r.tiGiaTam && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          tỉ giá tạm
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{anSo ? '—' : tien(r.doanhThuThuan)}</TableCell>
                  <TableCell className="text-right">{anSo ? '—' : tien(r.phiShip)}</TableCell>
                  <TableCell className="text-right">{tien(r.cogs)}</TableCell>
                  <TableCell className={`text-right font-medium ${laiGopMau ?? ''}`}>
                    {anSo ? '—' : r.phuLine < 1
                      ? <span className="text-xs" title={`Mới ${phanTram(r.phuLine)} dòng có giá vốn → chưa tính được lãi gộp tháng (nếu coi COGS thiếu = 0 sẽ ra ${tien(r.laiGop)} — số giả). Xem cột Margin SP dòng có COGS.`}>thiếu COGS {phanTram(1 - r.phuLine)}</span>
                      : tien(r.laiGop)}
                  </TableCell>
                  <TableCell className="text-right">{anSo ? '—' : tien(r.marginSpCoCogs)}</TableCell>
                  <TableCell className="text-right">{tien(r.offline)}</TableCell>
                  <TableCell className="text-right">{phanTram(r.phuLine)} / {phanTram(r.phuDoanhThu)}</TableCell>
                  <TableCell className="text-right">{tien(r.thuocThangTruoc)}</TableCell>
                  <TableCell className="text-right">{r.tiGiaHieuLuc == null ? '—' : r.tiGiaHieuLuc.toLocaleString('vi-VN')}</TableCell>
                  <TableCell className="whitespace-nowrap text-right space-x-2">
                    <Link href={`/f/orders/lai-gop?${querySuffix}&chi-tiet=${r.period}`} className="text-xs text-primary hover:underline">
                      Chi tiết
                    </Link>
                    <a
                      href={`/f/orders/lai-gop/chua-co-gia-von.csv?period=${r.period}&${querySuffix}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Xuất line chưa có giá vốn
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {chiTietPeriod && (
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold">Chi tiết giá vốn tháng {chiTietPeriod}</h2>
          {!chiTiet || chiTiet.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có dòng giá vốn nào trong tháng này.</p>
          ) : (
            Object.entries(groupByBrand(chiTiet)).map(([brandName, dong]) => (
              <div key={brandName} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {brandName} — {tien(dong.reduce((s, d) => s + d.amount, 0))}
                </h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mã đơn</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Số tiền</TableHead>
                        <TableHead>Loại</TableHead>
                        <TableHead>Nguồn</TableHead>
                        <TableHead>Chứng từ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dong.map((d, i) => (
                        <TableRow key={`${d.maDon}-${d.sku ?? ''}-${i}`}>
                          <TableCell className="font-mono">{d.maDon}</TableCell>
                          <TableCell className="font-mono">{d.sku ?? '—'}</TableCell>
                          <TableCell className="text-right">{tien(d.amount)}</TableCell>
                          <TableCell>{d.kind}</TableCell>
                          <TableCell>{d.source}</TableCell>
                          <TableCell className="font-mono text-xs">{d.statementRef ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function groupByBrand(dong: ChiTietDong[]): Record<string, ChiTietDong[]> {
  const out: Record<string, ChiTietDong[]> = {};
  for (const d of dong) {
    (out[d.brandName] ??= []).push(d);
  }
  return out;
}
