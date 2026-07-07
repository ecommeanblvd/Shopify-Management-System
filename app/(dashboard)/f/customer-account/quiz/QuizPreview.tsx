'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { QuizUIQuestion } from '@/features/customer-account/style-quiz/quiz-definition';
import { runQuizPreview, type QuizPreviewResult } from './actions';

const AXIS_LABEL: Record<string, string> = { color: '① Màu sắc (da/tóc/mắt)', body: '② Dáng người', archetype: '③ Gu / phong cách' };

export function QuizPreview({ stores, questions }: {
  stores: { id: string; domain: string }[];
  questions: QuizUIQuestion[];
}) {
  const cici = stores.find((s) => s.domain.includes('cici'));
  const [storeId, setStoreId] = useState(cici?.id ?? stores[0]?.id ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [heightCm, setHeightCm] = useState('');
  const [proportion, setProportion] = useState('');
  const [result, setResult] = useState<QuizPreviewResult | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const byAxis: Record<string, QuizUIQuestion[]> = { color: [], body: [], archetype: [] };
    for (const q of questions) byAxis[q.axis].push(q);
    return byAxis;
  }, [questions]);

  const answeredCount = Object.values(answers).filter(Boolean).length;

  const run = () => {
    if (!storeId) return;
    startTransition(async () => {
      const r = await runQuizPreview(storeId, answers, {
        heightCm: heightCm ? Number(heightCm) : undefined,
        proportion: (proportion || undefined) as never,
      });
      setResult(r);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      {/* Cột trái: quiz */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded border p-3 text-sm">
          <span className="text-muted-foreground">Store:</span>
          <select className="rounded border px-2 py-1" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
          <span className="ml-auto text-muted-foreground">Đã trả lời {answeredCount}/{questions.length}</span>
        </div>

        {(['color', 'body', 'archetype'] as const).map((axis) => (
          <div key={axis} className="rounded border p-3 space-y-3">
            <div className="text-sm font-semibold">{AXIS_LABEL[axis]}</div>
            {groups[axis].map((q) => (
              <div key={q.id} className="space-y-1">
                <div className="text-sm">{q.prompt} {q.level === 2 && <span className="text-xs text-muted-foreground">(nâng cao)</span>}</div>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((o) => {
                    const on = answers[q.id] === o.value;
                    return (
                      <button key={o.value} type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: on ? '' : o.value }))}
                        className={`rounded border px-2 py-1 text-xs transition ${on ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'}`}>
                        {o.swatch && <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: o.swatch, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} />}
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {axis === 'body' && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="text-muted-foreground">Tuỳ chọn:</span>
                <input className="w-24 rounded border px-2 py-1" placeholder="Cao (cm)" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
                <select className="rounded border px-2 py-1" value={proportion} onChange={(e) => setProportion(e.target.value)}>
                  <option value="">Tỉ lệ thân/chân…</option>
                  <option value="longTorsoShortLegs">Thân dài chân ngắn</option>
                  <option value="balanced">Cân đối</option>
                  <option value="shortTorsoLongLegs">Thân ngắn chân dài</option>
                </select>
              </div>
            )}
          </div>
        ))}

        <Button onClick={run} disabled={pending || !storeId}>{pending ? 'Đang tính…' : 'Xem kết quả'}</Button>
      </div>

      {/* Cột phải: kết quả */}
      <div className="space-y-3">
        {!result && <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">Trả lời rồi bấm "Xem kết quả" để xem hồ sơ + gợi ý.</div>}
        {result && (
          <>
            <div className="rounded border p-3 space-y-2 text-sm">
              <div className="font-semibold">Hồ sơ phong cách</div>
              <div><span className="text-muted-foreground">Mùa màu: </span><b>{result.profile.season}</b> ({result.profile.temperature}){result.profile.sisterFallback && <span className="text-muted-foreground"> · hoặc {result.profile.sisterFallback}</span>}</div>
              <div className="flex gap-1">{result.profile.palette.map((h) => <span key={h} className="h-5 w-5 rounded" style={{ background: h, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} title={h} />)}</div>
              <div><span className="text-muted-foreground">Dáng: </span><b>{result.profile.shape}</b> · {result.profile.heightBand}</div>
              <div><span className="text-muted-foreground">Gu: </span><b>{result.profile.archetype}</b>{result.profile.archetypeSecondary && <span> + {result.profile.archetypeSecondary}</span>}</div>
              <div className="text-xs text-muted-foreground">keywords: {result.profile.keywords.join(', ')}</div>
            </div>

            <div className="rounded border p-3">
              <div className="mb-2 text-sm font-semibold">Gợi ý ({result.recommendations.length}) · catalog {result.catalogSize} sp</div>
              {result.recommendations.length === 0 && <div className="text-sm text-muted-foreground">Store này chưa có catalog đồng bộ.</div>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {result.recommendations.map((p) => (
                  <div key={p.handle} className="rounded border p-1.5 text-xs">
                    {p.imageUrl
                      ? <img src={p.imageUrl} alt={p.title} className="mb-1 aspect-[3/4] w-full rounded object-cover" />
                      : <div className="mb-1 aspect-[3/4] w-full rounded bg-muted" />}
                    <div className="line-clamp-2 font-medium">{p.title}</div>
                    <div className="text-muted-foreground">{p.category ?? '—'} · {p.score.toFixed(2)}</div>
                    {p.reasons.length > 0 && <div className="mt-0.5 text-[10px] text-emerald-700">{p.reasons.join(' · ')}</div>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
