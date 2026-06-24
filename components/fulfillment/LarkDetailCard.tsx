import type { LarkDetailRecord } from '@/features/lark/detail';

/** Card hiển thị mọi field Lark của (các) record khớp đơn. RSC nhận props. */
export function LarkDetailCard({ records }: { records: LarkDetailRecord[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Dữ liệu Lark (vận hành)</h2>
      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không tìm thấy dữ liệu Lark cho đơn này.</p>
      ) : (
        <div className="space-y-4">
          {records.map((rec, i) => (
            <div key={rec.recordId} className="rounded border border-border">
              {records.length > 1 && (
                <div className="border-b border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                  Kiện / record #{i + 1}
                </div>
              )}
              <dl className="divide-y divide-border/50">
                {rec.fields.map((f) => (
                  <div key={f.label} className="flex gap-3 px-3 py-1.5 text-sm">
                    <dt className="w-1/3 shrink-0 text-muted-foreground">{f.label}</dt>
                    <dd className="flex-1 break-words">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
