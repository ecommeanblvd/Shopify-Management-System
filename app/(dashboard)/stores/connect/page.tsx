import Link from 'next/link';
import { ChevronLeft, Store, ShieldCheck, Plug } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ShopHandleInput } from '@/components/stores/ShopHandleInput';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { laMaLoi, tenGon, THONG_DIEP_LOI } from '@/features/stores/ket-qua-noi';
import { conSong } from '@/features/shopify-orders/backfill/ket';

export default async function ConnectStorePage({ searchParams }: { searchParams: Promise<{ kq?: string; ma?: string; shop?: string }> }) {
  const sp = await searchParams;
  /* Phản hồi sau lượt nối. Trước nay luồng OAuth hỏng thì ném JSON thô giữa màn hình, còn xong
   * thì đẩy về dashboard KHÔNG nói một chữ — CEO nối store rồi không biết được hay chưa
   * (CEO 30/09/2026). */
  const loi = sp.kq === 'loi' && laMaLoi(sp.ma) ? THONG_DIEP_LOI[sp.ma] : null;
  const xong = sp.kq === 'ok' ? (sp.shop ?? '').trim() : null;

  // Hiện luôn store ĐANG CÓ và tiến độ nạp lịch sử: câu hỏi ngay sau khi nối là "vào chưa".
  const dsStore = await db
    .select({
      dom: schema.stores.shopDomain, ten: schema.stores.name, tt: schema.stores.status,
      noiLuc: schema.stores.connectedAt, napTt: schema.shopifySyncState.backfillStatus,
      napXong: schema.shopifySyncState.backfillIngested, napTong: schema.shopifySyncState.backfillTotal,
      napNhip: schema.shopifySyncState.backfillProgressAt, napBatDau: schema.shopifySyncState.backfillStartedAt,
    })
    .from(schema.stores)
    .leftJoin(schema.shopifySyncState, eq(schema.shopifySyncState.storeId, schema.stores.id))
    .orderBy(schema.stores.connectedAt);

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Dashboard
      </Link>

      {loi && (
        <div className="rounded-xl border border-red-600/40 bg-red-600/10 px-4 py-3 text-sm">
          <b className="text-red-700 dark:text-red-400">Nối store KHÔNG thành công</b>
          <p className="mt-0.5 text-xs text-muted-foreground">{loi}</p>
        </div>
      )}
      {xong && (
        <div className="rounded-xl border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm">
          <b className="text-emerald-700 dark:text-emerald-400">Đã nối {tenGon(xong)}</b>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Nạp lịch sử đơn đang chạy nền — mất vài phút tới vài giờ tuỳ số đơn. Xem tiến độ ở bảng bên dưới.
          </p>
        </div>
      )}

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Plug className="size-3.5" />
          Store connection
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Connect a Shopify store</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          We&rsquo;ll redirect to Shopify so you can install the management app under the store&rsquo;s admin and grant the scopes Settings Sync and Markets need.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-6 py-3 text-sm font-semibold">
            Store đã nối ({dsStore.length})
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-6 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                <th>Store</th><th>Trạng thái</th><th>Nối lúc</th><th>Nạp lịch sử</th>
              </tr>
            </thead>
            <tbody>
              {dsStore.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-6 text-center text-muted-foreground">Chưa nối store nào.</td></tr>
              )}
              {dsStore.map((s) => (
                <tr key={s.dom} className="border-t border-border/60 [&>td]:px-6 [&>td]:py-2">
                  <td className="font-medium">{tenGon(s.dom)}</td>
                  <td className={s.tt === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{s.tt}</td>
                  <td className="text-muted-foreground">{s.noiLuc ? s.noiLuc.toISOString().slice(0, 10) : '—'}</td>
                  <td className="text-muted-foreground">
                    {/* 'running' mà không nhúc nhích là XÁC CHẾT giữ chỗ, không phải đang chạy —
                        phải nói đúng thế, nếu không người đọc cứ ngồi đợi một việc đã chết. */}
                    {s.napTt === 'done' ? `xong (${s.napXong ?? 0} đơn)`
                      : s.napTt === 'running' && conSong(s.napTt, s.napNhip, s.napBatDau) ? `đang chạy ${s.napXong ?? 0}/${s.napTong ?? '?'}`
                      : s.napTt === 'running' ? <span className="text-amber-600 dark:text-amber-400">KẸT ở {s.napXong ?? 0}/{s.napTong ?? '?'} từ {s.napNhip ? s.napNhip.toISOString().slice(0, 10) : '—'} · nối lại để chạy tiếp</span>
                      : s.napTt === 'failed' ? 'HỎNG — nối lại để chạy lại'
                      : 'chưa chạy'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6">
        {/* Form */}
        <Card>
          <CardContent className="p-6 md:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Store className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Shop handle</h2>
                <p className="text-xs text-muted-foreground">Just the handle — we attach .myshopify.com for you.</p>
              </div>
            </div>
            <ShopHandleInput installPath="/api/auth/shopify/install" />
          </CardContent>
        </Card>

        {/* What happens next */}
        <Card>
          <CardContent className="p-6 md:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center">
                <ShieldCheck className="size-4" />
              </div>
              <h2 className="text-base font-semibold">What happens next</h2>
            </div>
            <ol className="space-y-3 text-sm">
              <Step n={1} title="Shopify OAuth consent" body="The store owner reviews the requested scopes and approves." />
              <Step n={2} title="Token stored encrypted" body="Access token is encrypted at rest before we ever persist it." />
              <Step n={3} title="Health check" body="We immediately validate the connection and surface missing scopes on the dashboard." />
            </ol>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Need to grant more scopes later? Re-install with the same form — Shopify prompts the owner to approve the additions.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="size-6 rounded-full bg-muted text-muted-foreground text-xs font-medium flex items-center justify-center shrink-0">
        {n}
      </span>
      <div>
        <div className="font-medium leading-tight">{title}</div>
        <div className="text-xs text-muted-foreground leading-tight mt-0.5">{body}</div>
      </div>
    </li>
  );
}
