import type { LarkDetailRecord } from '@/features/lark/detail';

/** Card hiển thị mọi field Lark của (các) record khớp đơn. RSC nhận props. */
export function LarkDetailCard({ records }: { records: LarkDetailRecord[] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Dữ liệu Lark (vận hành)</h2>
      {records.length === 0 ? (
        <p className="text-sm text-gray-400">Không tìm thấy dữ liệu Lark cho đơn này.</p>
      ) : (
        <div className="space-y-4">
          {records.map((rec, i) => (
            <div key={rec.recordId} className="rounded border border-gray-100">
              {records.length > 1 && (
                <div className="border-b border-gray-100 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
                  Kiện / record #{i + 1}
                </div>
              )}
              <dl className="divide-y divide-gray-50">
                {rec.fields.map((f) => (
                  <div key={f.label} className="flex gap-3 px-3 py-1.5 text-sm">
                    <dt className="w-1/3 shrink-0 text-gray-500">{f.label}</dt>
                    <dd className="flex-1 break-words text-gray-800">{f.value}</dd>
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
