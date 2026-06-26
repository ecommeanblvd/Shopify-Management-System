import type { LarkDetailRecord } from '@/features/lark/detail';

function RecordFields({ rec }: { rec: LarkDetailRecord }) {
  return (
    <dl className="divide-y divide-border/50">
      {rec.fields.map((f) => (
        <div key={f.label} className="flex gap-3 px-3 py-1.5 text-sm">
          <dt className="w-1/3 shrink-0 text-muted-foreground">{f.label}</dt>
          <dd className="flex-1 break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Card hiển thị field Lark của record MỚI NHẤT; record cũ thu gọn (lịch sử). RSC. */
export function LarkDetailCard({ records }: { records: LarkDetailRecord[] }) {
  const [latest, ...older] = records;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Dữ liệu Lark (vận hành)</h2>
      {!latest ? (
        <p className="text-sm text-muted-foreground">Không tìm thấy dữ liệu Lark cho đơn này.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-border">
            <RecordFields rec={latest} />
          </div>
          {older.length > 0 && (
            <details className="rounded border border-border">
              <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Lịch sử ({older.length} bản cũ)
              </summary>
              <div className="space-y-3 p-2">
                {older.map((rec, i) => (
                  <div key={rec.recordId} className="rounded border border-border/60">
                    <div className="border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                      Bản cũ #{i + 1}
                    </div>
                    <RecordFields rec={rec} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
