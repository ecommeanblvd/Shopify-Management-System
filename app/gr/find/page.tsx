import { notFound } from 'next/navigation';
import { Gift } from 'lucide-react';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { GiftRegistryRecoveryForm } from '@/components/functions/GiftRegistryRecoveryForm';
import { LocaleSwitcher } from '@/components/functions/LocaleSwitcher';
import { getMessages, resolveLocale } from '@/features/functions/gift-registry/i18n';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Find your gift registry',
  robots: { index: false, follow: false },
};

export default async function FindGiftRegistryPage({
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

  const currentPath = `/gr/find?shop=${encodeURIComponent(shop)}&lang=${locale}`;

  return (
    <main className="min-h-screen bg-amber-50/30 text-neutral-900">
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="flex justify-end mb-6">
          <LocaleSwitcher currentPath={currentPath} current={locale} />
        </div>
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
            <Gift className="size-3.5" />
            {msg.findPage.eyebrow(store.name)}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            {msg.findPage.title}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {msg.findPage.subtitle(store.name)}
          </p>
        </header>
        <GiftRegistryRecoveryForm
          shopDomain={store.shopDomain}
          msg={msg.findPage}
          lang={locale}
        />
      </div>
    </main>
  );
}
