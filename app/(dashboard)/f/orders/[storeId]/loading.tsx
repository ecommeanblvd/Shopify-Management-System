export default function Loading() {
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="h-9 w-48 rounded bg-muted" />
          <div className="mt-2 h-4 w-64 rounded bg-muted/60" />
        </div>
        <div className="h-8 w-40 rounded bg-muted/40" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-muted/30" />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted/20" />
        ))}
      </div>
    </div>
  );
}
