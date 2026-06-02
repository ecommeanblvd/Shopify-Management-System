import { notFound } from 'next/navigation';
import { Gift } from 'lucide-react';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { GiftRegistryCreateForm } from '@/components/functions/GiftRegistryCreateForm';
import { LocaleSwitcher } from '@/components/functions/LocaleSwitcher';
import { getMessages, resolveLocale } from '@/features/functions/gift-registry/i18n';

export const dynamic = 'force-dynamic';

export default async function CreateGiftRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string; lang?: string }>;
}) {
  const sp = await searchParams;
  const shop = sp.shop?.trim().toLowerCase();
  if (!shop) notFound();
  const locale = resolveLocale(sp.lang);
  const msg = getMessages(locale);

  const [store] = await db
    .select({ id: schema.stores.id, name: schema.stores.name, shopDomain: schema.stores.shopDomain })
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, shop));
  if (!store) notFound();

  const [setting] = await db
    .select({ enabled: schema.storeFunctionSettings.enabled })
    .from(schema.storeFunctionSettings)
    .where(and(
      eq(schema.storeFunctionSettings.storeId, store.id),
      eq(schema.storeFunctionSettings.functionKey, 'gift-registry'),
    ));
  if (!setting?.enabled) notFound();

  const currentPath = `/gr/new?shop=${encodeURIComponent(shop)}&lang=${locale}`;

  return (
    <main className="min-h-screen bg-amber-50/30 text-neutral-900">
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="flex justify-end mb-6">
          <LocaleSwitcher currentPath={currentPath} current={locale} />
        </div>
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
            <Gift className="size-3.5" />
            {msg.newPage.eyebrow(store.name)}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            {msg.newPage.title}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {msg.newPage.subtitle}
          </p>
        </header>
        <GiftRegistryCreateForm shopDomain={store.shopDomain} msg={msg.newPage} />
        <p className="mt-8 text-center text-xs text-neutral-500">
          {msg.newPage.recoveryHint}{' '}
          <a
            href={`/gr/find?shop=${encodeURIComponent(store.shopDomain)}&lang=${locale}`}
            className="underline hover:text-neutral-700"
          >
            {msg.newPage.recoveryLink}
          </a>
        </p>
      </div>
    </main>
  );
}
