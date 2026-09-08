'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { luuTiGiaAction, layTiGiaVcbAction } from '@/features/cogs/actions';

export interface TiGiaHang {
  period: string;
  /** Tỉ giá đã nhập TRỰC TIẾP cho đúng tháng này (không mượn tháng khác). null = chưa nhập. */
  rate: number | null;
  source: string | null;
}

const NGUON: Record<string, string> = { manual: 'nhập tay', vcb: 'VCB' };

/** Form nhập tỉ giá USD→VND theo tháng (chỉ hiện khi `manage_cogs`) — mỗi dòng có ô nhập thủ công; nút "Lấy VCB" chỉ hiện ở dòng THÁNG HIỆN TẠI vì `layTiGiaVcbAction` chỉ chấp nhận tháng hiện tại (tháng đã qua phải nhập tay theo tỉ giá đúng kỳ đó). */
export function TiGiaForm({ hang, thangHienTai }: { hang: TiGiaHang[]; thangHienTai: string }) {
  const [nhap, setNhap] = useState<Record<string, string>>({});
  const [dangLuu, startLuu] = useTransition();
  const [dangVcb, startVcb] = useTransition();
  const [periodDangXuLy, setPeriodDangXuLy] = useState<string | null>(null);

  const luu = (period: string): void => {
    const gia = nhap[period]?.trim();
    if (!gia) { toast.error('Nhập tỉ giá trước'); return; }
    setPeriodDangXuLy(period);
    startLuu(async () => {
      try {
        const fd = new FormData();
        fd.set('period', period);
        fd.set('rate', gia);
        await luuTiGiaAction(fd);
        toast.success(`Đã lưu tỉ giá tháng ${period}`);
        setNhap((prev) => ({ ...prev, [period]: '' }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Lỗi không rõ');
      }
    });
  };

  const layVcb = (period: string): void => {
    setPeriodDangXuLy(period);
    startVcb(async () => {
      try {
        const r = await layTiGiaVcbAction(period);
        toast.success(`Đã lấy tỉ giá VCB tháng ${period}: ${r.rate.toLocaleString('vi-VN')} ₫/USD`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Lỗi không rõ');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tỉ giá USD → VND theo tháng</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tháng</TableHead>
                <TableHead>Tỉ giá hiện tại</TableHead>
                <TableHead>Nguồn</TableHead>
                <TableHead>Nhập tỉ giá mới</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hang.map((h) => {
                const dangXuLy = periodDangXuLy === h.period && (dangLuu || dangVcb);
                return (
                  <TableRow key={h.period}>
                    <TableCell className="font-mono">{h.period}</TableCell>
                    <TableCell>{h.rate == null ? '—' : `${h.rate.toLocaleString('vi-VN')} ₫/USD`}</TableCell>
                    <TableCell>{h.source ? (NGUON[h.source] ?? h.source) : '—'}</TableCell>
                    <TableCell>
                      <Input
                        value={nhap[h.period] ?? ''}
                        onChange={(e) => setNhap((prev) => ({ ...prev, [h.period]: e.target.value }))}
                        placeholder="26.500"
                        className="w-32"
                        disabled={dangXuLy}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap space-x-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => luu(h.period)} disabled={dangXuLy}>
                        Lưu
                      </Button>
                      {h.period === thangHienTai && (
                        <Button type="button" size="sm" variant="outline" onClick={() => layVcb(h.period)} disabled={dangXuLy}>
                          Lấy VCB
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
