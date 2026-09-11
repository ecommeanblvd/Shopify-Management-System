'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { luuNhapKpi, type NhapKpiInput } from '@/features/kpi-logistics/actions';

const so = (v: string): number => Number(v.replace(/[^\d.-]/g, '')) || 0;

/** Form nhập phần hệ thống không tự biết của một kỳ KPI. Chỉ admin thấy trang này. */
export function NhapKpiForm({ ky, banDau, soDonAmCuocGoiY, soDonLoiNoiBo, soDonChuaXet, gateTuDong }: {
  ky: string;
  banDau: NhapKpiInput;
  /** Số đơn âm cước hệ thống flag — bối cảnh, KHÔNG phải số điền vào ô. */
  soDonAmCuocGoiY: number;
  /** Đơn âm cước đã đối soát chốt là lỗi nội bộ — đây mới là số nên điền. */
  soDonLoiNoiBo: number;
  /** Đơn âm cước chưa ai phân định — còn tồn thì chưa đủ căn cứ chấm 1.1. */
  soDonChuaXet: number;
  gateTuDong: boolean;
}) {
  const [v, setV] = useState<NhapKpiInput>(banDau);
  const [pending, start] = useTransition();
  const [xong, setXong] = useState<string | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  const luu = () => start(async () => {
    setLoi(null); setXong(null);
    try { await luuNhapKpi({ ...v, ky }); setXong('Đã lưu'); }
    catch (e) { setLoi(e instanceof Error ? e.message : String(e)); }
  });

  const o = 'h-8 rounded-md border border-input bg-input/30 px-2 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-1 text-sm">
          <div className="font-medium">P1.1 · Số đơn âm cước do lỗi trách nhiệm</div>
          <input type="number" min={0} className={`${o} w-full`} value={v.soDonAmCuocLoi}
            onChange={(e) => setV({ ...v, soDonAmCuocLoi: so(e.target.value) })} />
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <div>
              Hệ thống thấy <b>{soDonAmCuocGoiY}</b> đơn âm cước trong kỳ; đối soát đã chốt <b>{soDonLoiNoiBo}</b> đơn là lỗi nội bộ
              và còn <b>{soDonChuaXet}</b> đơn chưa ai xét. Chỉ điền số đơn do sai bảng giá web hoặc phân sai luồng carrier.
            </div>
            {soDonLoiNoiBo !== banDau.soDonAmCuocLoi && (
              <button type="button" onClick={() => setV((x) => ({ ...x, soDonAmCuocLoi: soDonLoiNoiBo }))}
                className="rounded border border-border px-2 py-0.5 font-medium hover:bg-muted">
                Điền {soDonLoiNoiBo} theo kết quả đối soát
              </button>
            )}
          </div>
        </label>

        <label className="space-y-1 text-sm">
          <div className="font-medium">P1.4 · Ghi đè tỉ lệ đóng đúng size thùng (%)</div>
          <input type="number" min={0} max={100} step={0.1} className={`${o} w-full`}
            value={v.tyLeSizeThung == null ? '' : Math.round(v.tyLeSizeThung * 1000) / 10}
            onChange={(e) => setV({ ...v, tyLeSizeThung: e.target.value === '' ? null : so(e.target.value) / 100 })} />
          <div className="text-[11px] text-muted-foreground">Bỏ trống = dùng số hệ thống tự đo (lệch cân tính cước vs cân carrier charge). Chỉ điền khi cần ghi đè vì miễn trừ theo mục VII.</div>
        </label>

        <label className="space-y-1 text-sm">
          <div className="font-medium">P3C · Số thực thu Kế toán xác nhận (đ)</div>
          <input type="number" min={0} step={1000} className={`${o} w-full`}
            value={v.thuHoiKeToanVnd ?? ''}
            onChange={(e) => setV({ ...v, thuHoiKeToanVnd: e.target.value === '' ? null : so(e.target.value) })} />
          <div className="text-[11px] text-muted-foreground">Bỏ trống = dùng số credit note đã ghi trong hệ thống.</div>
        </label>

        <label className="space-y-1 text-sm">
          <div className="font-medium">Clawback kỳ này (đ)</div>
          <input type="number" min={0} step={1000} className={`${o} w-full`} value={v.clawbackVnd}
            onChange={(e) => setV({ ...v, clawbackVnd: so(e.target.value) })} />
          <div className="text-[11px] text-muted-foreground">Thưởng kỳ trước bị thu hồi (mục VIII). Trần 30 % thu nhập thực nhận do Kế toán kiểm soát.</div>
        </label>

        <label className="space-y-1 text-sm">
          <div className="font-medium">Ghi chú kỳ</div>
          <input type="text" className={`${o} w-full`} value={v.ghiChu ?? ''} placeholder="Lý do điều chỉnh, biên bản liên quan…"
            onChange={(e) => setV({ ...v, ghiChu: e.target.value })} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {([['roRiGiam', 'P3B · Giảm rò rỉ dưới ngưỡng'], ['khacPhucGoc', 'P3B · Khắc phục gốc lỗi "ta sai"']] as const).map(([k, nhan]) => (
          <label key={k} className="inline-flex items-center gap-2">
            <input type="checkbox" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} className="size-4" />
            {nhan}
          </label>
        ))}
        <label className="inline-flex items-center gap-2">
          <span>Gate đối soát</span>
          <select className={o} value={v.gateOverride === null ? 'auto' : v.gateOverride ? 'dat' : 'truot'}
            onChange={(e) => setV({ ...v, gateOverride: e.target.value === 'auto' ? null : e.target.value === 'dat' })}>
            <option value="auto">Theo hệ thống ({gateTuDong ? 'đạt' : 'chưa đạt'})</option>
            <option value="dat">Ghi đè: đạt</option>
            <option value="truot">Ghi đè: trượt</option>
          </select>
        </label>
        {v.gateOverride !== null && (
          <input type="text" className={`${o} min-w-[260px] flex-1`} placeholder="Lý do ghi đè Gate (bắt buộc ghi rõ)"
            value={v.gateGhiChu ?? ''} onChange={(e) => setV({ ...v, gateGhiChu: e.target.value })} />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={luu} disabled={pending}>{pending ? 'Đang lưu…' : 'Lưu số liệu kỳ'}</Button>
        {xong && <span className="text-sm text-emerald-600 dark:text-emerald-400">{xong}</span>}
        {loi && <span className="text-sm text-red-600 dark:text-red-400">{loi}</span>}
      </div>
    </div>
  );
}
