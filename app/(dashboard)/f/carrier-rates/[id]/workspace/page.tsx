import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { formatDateVN } from '@/features/carrier-rates/lib';
import { loadMatrix } from '@/features/carrier-rates/matrix-actions';
import { listZonesWithCountries } from '@/features/carrier-rates/zones-actions';
import { listRateCardsForAccount, getCurrentCardId } from '@/features/carrier-rates/rate-cards-actions';
import { stageRateCardPdf, commitRateCardFromPdf } from '@/features/carrier-rates/rate-card-upload-actions';
import { RateCardSelect } from '@/components/carrier-rates/RateCardSelect';
import { RateCardPdfButton } from '@/components/carrier-rates/RateCardPdfButton';
import { RateCardUploadDialog } from '@/components/carrier-rates/RateCardUploadDialog';
import { RateWorkspace } from '@/components/carrier-rates/RateWorkspace';

export const dynamic = 'force-dynamic';

async function stageRateCardAction(accountId: string, formData: FormData) {
  'use server';
  const file = formData.get('file') as File;
  return stageRateCardPdf(accountId, file);
}

async function commitRateCardAction(
  accountId: string,
  input: { pdfKey: string; filename: string; effectiveFrom: string; effectiveTo: string | null },
) {
  'use server';
  const r = await commitRateCardFromPdf({ carrierAccountId: accountId, ...input });
  revalidatePath(`/f/carrier-rates/${accountId}/workspace`);
  return r;
}

export default async function WorkspacePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ card?: string }> }) {
  const { id } = await params;
  const { card: cardParam } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const cards = await listRateCardsForAccount(id);
  const selectedCardId = (cardParam && cards.some((c) => c.id === cardParam))
    ? cardParam
    : (await getCurrentCardId(id)) ?? cards[0]?.id ?? null;

  const stageBound = stageRateCardAction.bind(null, id);
  const commitBound = commitRateCardAction.bind(null, id);

  const backLink = (
    <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ChevronLeft className="size-4" />
      {account.name}
    </Link>
  );

  if (!selectedCardId) {
    return (
      <div className="px-6 md:px-10 py-12 space-y-6">
        {backLink}
        <h1 className="text-3xl font-semibold">No rate card yet</h1>
        <p className="text-sm text-muted-foreground">Upload a carrier rate-sheet PDF to create the first card.</p>
        {canManage && (
          <RateCardUploadDialog
            stageAction={stageBound}
            commitAction={commitBound}
            triggerLabel="Upload first rate card"
            triggerVariant="default"
          />
        )}
      </div>
    );
  }

  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
  const { zones: matrixZones, tiers, cells, pakCells, pakTiers } = await loadMatrix(id, selectedCardId);
  const zonesWithCountries = await listZonesWithCountries(id);

  const toolbarStart = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Rate card</span>
      <RateCardSelect accountId={id} cards={cards} selectedCardId={selectedCardId} />
      {selectedCard?.hasPdf && (
        <RateCardPdfButton
          pdfUrl={`/f/carrier-rates/${id}/cards/${selectedCardId}/pdf`}
          title={`${account.name} — ${selectedCard.label}`}
        />
      )}
      {selectedCard && (
        <span className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs whitespace-nowrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Hiệu lực</span>
          <span className="text-foreground">{formatDateVN(selectedCard.effectiveFrom)} → {formatDateVN(selectedCard.effectiveTo, 'nay')}</span>
        </span>
      )}
    </div>
  );

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      {backLink}

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <LayoutGrid className="size-3.5" />
          Rate workspace
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Zones &amp; rate matrix</h1>
          {canManage && (
            <div className="ml-auto shrink-0">
              <RateCardUploadDialog stageAction={stageBound} commitAction={commitBound} />
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground max-w-xl">
          Chỉ xem. Mọi giá trị đến từ rate card đã upload (source of truth). Tìm country bên dưới để biết nó thuộc zone nào.
        </p>
      </header>

      <RateWorkspace
        matrixZones={matrixZones}
        tiers={tiers.map((t) => ({ id: t.id, upperKg: t.upperKg }))}
        cells={cells
          .filter((c): c is typeof c & { costAmount: string } => c.costAmount !== null)
          .map((c) => ({ zoneId: c.zoneId, tierId: c.tierId, costAmount: c.costAmount }))}
        pakTiers={pakTiers.map((t) => ({ id: t.id, upperKg: t.upperKg }))}
        pakCells={pakCells
          .filter((c): c is typeof c & { costAmount: string } => c.costAmount !== null)
          .map((c) => ({ zoneId: c.zoneId, tierId: c.tierId, costAmount: c.costAmount }))}
        zonesWithCountries={zonesWithCountries.map((z) => ({ id: z.id, label: z.label, countries: z.countries }))}
        costCurrency={account.costCurrency}
        toolbarStart={toolbarStart}
      />
    </div>
  );
}
