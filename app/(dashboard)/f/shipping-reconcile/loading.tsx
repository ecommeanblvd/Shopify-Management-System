export default function Loading() {
  return (
    <div className="space-y-6 p-6 animate-pulse">
      <div>
        <div className="h-8 w-56 rounded bg-muted" />
        <div className="mt-2 h-4 w-96 rounded bg-muted/60" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-muted/30" />
        ))}
      </div>
      <div className="h-9 w-full rounded bg-muted/40" />
      <div className="space-y-px overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-9 bg-muted/20" />
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Đang tính đối soát… lần đầu sau deploy/import có thể mất ~30 giây, các lần sau gần như tức thì.
      </p>
    </div>
  );
}
