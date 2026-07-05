import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getConfig, getWishlist, postRemove, type WishlistData, type WishlistItem, type WishlistRec } from './lib/api';
import { fmtMoney, soldOutBadge } from './lib/wishlist-vm';

function Wishlist() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getConfig()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch((e) => {
        if (active) setError(String(e?.message ?? e));
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <s-banner tone="critical">
        <s-text>{error}</s-text>
      </s-banner>
    );
  }
  if (!config) return <s-spinner accessibilityLabel="Loading your wishlist" />;
  if (!config.enabled || !config.modules.some((m) => m.key === 'wishlist')) {
    return (
      <s-section heading="Wishlist">
        <s-text tone="subdued">Wishlist is not enabled for this store.</s-text>
      </s-section>
    );
  }

  return (
    <s-stack direction="block" gap="large-100">
      <s-heading>Wishlist</s-heading>
      {config.branding.announcement ? (
        <s-banner>
          <s-text>{config.branding.announcement}</s-text>
        </s-banner>
      ) : null}
      <WishlistBody />
    </s-stack>
  );
}

function WishlistBody() {
  const [data, setData] = useState<WishlistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => getWishlist().then(setData);
  const reload = () => {
    setData(null);
    load().catch((e) => setError(String((e as Error)?.message ?? e)));
  };

  useEffect(() => {
    let active = true;
    load().catch((e) => {
      if (active) setError(String(e?.message ?? e));
    });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <s-banner tone="critical">
        <s-text>We couldn't load your wishlist right now.</s-text>
      </s-banner>
    );
  }
  if (!data) return <s-spinner accessibilityLabel="Loading your wishlist" />;

  if (data.items.length === 0) {
    return (
      <s-section heading="Your wishlist is empty">
        <s-text tone="subdued">Tap the heart on any product to save it here.</s-text>
      </s-section>
    );
  }

  return (
    <s-stack direction="block" gap="large">
      <s-section heading="Saved products">
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(180px, 1fr))" gap="base">
          {data.items.map((it) => (
            <SavedCard key={`${it.shopifyProductId}:${it.variantId ?? ''}`} item={it} onRemoved={reload} />
          ))}
        </s-grid>
      </s-section>

      {data.recommendations.length > 0 ? (
        <s-section heading="You may also like">
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(180px, 1fr))" gap="base">
            {data.recommendations.map((r) => (
              <RecCard key={r.shopifyProductId} rec={r} />
            ))}
          </s-grid>
        </s-section>
      ) : null}
    </s-stack>
  );
}

function SavedCard({ item, onRemoved }: { item: WishlistItem; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removeInFlight = useRef(false);
  const badge = soldOutBadge(item.availableForSale);
  const href = `/products/${item.productHandle}`;

  const remove = async () => {
    if (removeInFlight.current) return;
    removeInFlight.current = true;
    setRemoving(true);
    setError(null);
    try {
      const res = await postRemove(item.shopifyProductId, item.variantId ?? undefined);
      if (!res.removed) throw new Error('Could not remove item.');
      onRemoved();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setRemoving(false);
      removeInFlight.current = false;
    }
  };

  return (
    <s-stack direction="block" gap="small-500">
      <s-link href={href} target="_blank">
        {item.imageUrl ? (
          <s-image src={item.imageUrl} alt={item.productTitle} aspectRatio="3/4" objectFit="contain" />
        ) : null}
      </s-link>
      <s-link href={href} target="_blank">
        <s-text type="strong">{item.productTitle}</s-text>
      </s-link>
      {item.variantTitle ? <s-text tone="subdued">{item.variantTitle}</s-text> : null}
      <s-stack direction="inline" gap="small">
        {item.price ? <s-text>{fmtMoney(item.price, item.currency)}</s-text> : null}
        {badge ? <s-badge tone="critical">{badge}</s-badge> : null}
      </s-stack>
      {error ? <s-text tone="critical">{error}</s-text> : null}
      {!confirming ? (
        <s-link tone="neutral" onClick={() => setConfirming(true)}>
          Remove
        </s-link>
      ) : removing ? (
        <s-text tone="subdued">Removing…</s-text>
      ) : (
        <s-stack direction="inline" gap="small">
          <s-text tone="subdued">Remove?</s-text>
          <s-link tone="neutral" onClick={remove}>
            Yes
          </s-link>
          <s-text tone="subdued">·</s-text>
          <s-link tone="neutral" onClick={() => setConfirming(false)}>
            No
          </s-link>
        </s-stack>
      )}
    </s-stack>
  );
}

function RecCard({ rec }: { rec: WishlistRec }) {
  const href = `/products/${rec.handle}`;
  return (
    <s-stack direction="block" gap="small-500">
      <s-link href={href} target="_blank">
        {rec.imageUrl ? <s-image src={rec.imageUrl} alt={rec.title} aspectRatio="3/4" objectFit="contain" /> : null}
      </s-link>
      <s-link href={href} target="_blank">
        <s-text type="strong">{rec.title}</s-text>
      </s-link>
      {rec.vendor ? <s-text tone="subdued">{rec.vendor}</s-text> : null}
      {rec.price ? <s-text>{fmtMoney(rec.price, rec.currency)}</s-text> : null}
    </s-stack>
  );
}

export default async () => {
  render(<Wishlist />, document.body);
};
