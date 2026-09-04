'use client';

import { useState } from 'react';
import type { JobRow, LanChayRow } from '@/features/jobs/queries';
import { NHAN_TRANG_THAI, type TrangThaiJob } from '@/features/jobs/registry';

const MAU: Record<TrangThaiJob, string> = {
  chua_chay: 'bg-red-100 text-red-800 border-red-200',
  qua_han: 'bg-red-100 text-red-800 border-red-200',
  loi: 'bg-amber-100 text-amber-900 border-amber-200',
  dang_chay: 'bg-blue-100 text-blue-800 border-blue-200',
  binh_thuong: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

function truoc(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const p = ms / 60000;
  if (p < 60) return `${Math.round(p)} phút trước`;
  if (p < 60 * 48) return `${Math.round(p / 60)} giờ trước`;
  return `${Math.round(p / 1440)} ngày trước`;
}

function chuKy(phut: number): string {
  if (phut < 60) return `${phut} phút`;
  if (phut < 1440) return `${phut / 60} giờ`;
  return `${phut / 1440} ngày`;
}

export function JobsTable({ rows, lichSu }: { rows: JobRow[]; lichSu: LanChayRow[] }) {
  const [moLichSu, setMoLichSu] = useState(false);
  const loLang = rows.filter((r) => r.trangThai === 'chua_chay' || r.trangThai === 'qua_han');

  return (
    <div className="space-y-6">
      {loLang.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>{loLang.length} tác vụ không chạy.</strong>{' '}
          {loLang.map((r) => r.ten).join(' · ')}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Tác vụ</th>
              <th className="px-3 py-2 font-medium">Trạng thái</th>
              <th className="px-3 py-2 font-medium">Chạy lần cuối</th>
              <th className="px-3 py-2 font-medium">Chu kỳ</th>
              <th className="px-3 py-2 font-medium text-right tabular-nums">7 ngày</th>
              <th className="px-3 py-2 font-medium">Hỏng thì sao</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.ten}</div>
                  <div className="text-xs text-muted-foreground font-mono">{r.key}</div>
                  {r.error && <div className="mt-1 text-xs text-amber-800 max-w-md truncate" title={r.error}>{r.error}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded border px-2 py-0.5 text-xs ${MAU[r.trangThai]}`}>
                    {NHAN_TRANG_THAI[r.trangThai]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div>{truoc(r.lanCuoi)}</div>
                  {r.durationMs != null && <div className="text-xs text-muted-foreground tabular-nums">{(r.durationMs / 1000).toFixed(1)}s</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{chuKy(r.chuKyPhut)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.soLan7Ngay}
                  {r.soLoi7Ngay > 0 && <span className="text-red-700"> ({r.soLoi7Ngay} lỗi)</span>}
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-xs">{r.hauQua}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <button type="button" onClick={() => setMoLichSu((v) => !v)} className="text-sm text-muted-foreground underline underline-offset-4">
          {moLichSu ? 'Ẩn' : 'Xem'} lịch sử {lichSu.length} lần chạy gần nhất
        </button>
        {moLichSu && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Lúc</th>
                  <th className="px-3 py-2 font-medium">Tác vụ</th>
                  <th className="px-3 py-2 font-medium">Kết quả</th>
                  <th className="px-3 py-2 font-medium">Số liệu</th>
                </tr>
              </thead>
              <tbody>
                {lichSu.map((h, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(h.startedAt).toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.jobKey}</td>
                    <td className="px-3 py-2">
                      <span className={h.status === 'error' ? 'text-red-700' : h.status === 'running' ? 'text-blue-700' : 'text-emerald-700'}>{h.status}</span>
                      {h.durationMs != null && <span className="text-muted-foreground tabular-nums"> · {(h.durationMs / 1000).toFixed(1)}s</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate">
                      {h.error ?? (h.summary ? JSON.stringify(h.summary) : '—')}
                    </td>
                  </tr>
                ))}
                {lichSu.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Chưa có lần chạy nào được ghi nhận</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
