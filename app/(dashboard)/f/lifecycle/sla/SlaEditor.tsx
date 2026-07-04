'use client';

import { useState, useTransition } from 'react';
import { updateSla } from '@/features/lifecycle/sla-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const KEY_LABEL: Record<string, string> = {
  placed_to_production: 'Đặt hàng → gửi brand',
  production: 'Sản xuất (brand → về kho)',
  qc: 'QC',
  pack: 'Đóng gói',
  ship: 'Bàn giao carrier',
  deliver: 'Giao hàng',
};

export function SlaEditor({ sla, canManage }: {
  sla: Array<{ key: string; targetHours: number; note: string | null }>; canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(sla.map((s) => [s.key, String(s.targetHours)])));
  const [msg, setMsg] = useState<string | null>(null);

  const save = (key: string) =>
    start(async () => {
      setMsg(null);
      const r = await updateSla(key, Number(vals[key]));
      setMsg(r.ok ? `Đã lưu ${KEY_LABEL[key] ?? key}` : (r.error ?? 'Lỗi'));
    });

  return (
    <Card><CardContent className="p-0">
      <table className="w-full text-sm">
        <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Công đoạn</th><th>Giờ</th><th></th></tr></thead>
        <tbody>
          {sla.map((s) => (
            <tr key={s.key} className="border-b [&>td]:p-3">
              <td>{KEY_LABEL[s.key] ?? s.key}<div className="text-xs text-muted-foreground">{s.note}</div></td>
              <td><input className="w-24 border rounded px-2 py-1" value={vals[s.key]} disabled={!canManage}
                    onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} /></td>
              <td className="text-right">{canManage && <Button size="sm" variant="outline" onClick={() => save(s.key)} disabled={pending}>Lưu</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <p className="text-sm p-3 border-t">{msg}</p>}
    </CardContent></Card>
  );
}
