import { useEffect, useState } from 'preact/hooks';
import { customerGraphql } from '../lib/customer-graphql';
import { resolveShopDomain } from '../lib/shop';
import { Section } from './Section';

interface WishlistItem {
  productId?: string | null;
  title: string;
  imageUrl?: string | null;
  url?: string | null;
}

const EMAIL_QUERY = `
  query CustomerEmail {
    customer { emailAddress { emailAddress } }
  }
`;

interface EmailResponse {
  customer: { emailAddress?: { emailAddress?: string | null } | null } | null;
}

export function WishlistCard({
  title,
  icon,
  supportEmail,
}: {
  title: string;
  icon: string | null;
  supportEmail: string | null;
}) {
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const base = shopify.settings.backend_url;
        if (!base) throw new Error('backend_url not configured');

        const [emailRes, shop] = await Promise.all([
          customerGraphql<EmailResponse>(EMAIL_QUERY),
          resolveShopDomain(),
        ]);
        const email = emailRes.customer?.emailAddress?.emailAddress ?? null;
        if (!email || !shop) {
          if (active) setItems([]);
          return;
        }

        // Public storefront wishlist API — intentionally NOT session-token authed.
        const url = `${base}/api/storefront/wishlist?shop=${encodeURIComponent(shop)}&email=${encodeURIComponent(email)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Wishlist: ${res.status}`);
        const body = (await res.json()) as { items?: WishlistItem[] };
        if (active) setItems(Array.isArray(body.items) ? body.items : []);
      } catch (e) {
        if (active) setError(String((e as Error)?.message ?? e));
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <Section title={title} icon={icon}>
      {error ? (
        <s-stack direction="block" gap="small-100">
          <s-text tone="subdued">No saved items.</s-text>
          {supportEmail ? <s-text tone="subdued">Need help? Contact {supportEmail}.</s-text> : null}
        </s-stack>
      ) : !items ? (
        <s-spinner accessibilityLabel="Loading wishlist" />
      ) : items.length === 0 ? (
        <s-text tone="subdued">No saved items.</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          {items.map((item, i) => (
            <s-stack key={item.productId ?? i} direction="inline" gap="base" alignItems="center">
              {item.imageUrl ? (
                <s-product-thumbnail src={item.imageUrl} alt={item.title} />
              ) : null}
              {item.url ? (
                <s-link href={item.url}>{item.title}</s-link>
              ) : (
                <s-text>{item.title}</s-text>
              )}
            </s-stack>
          ))}
        </s-stack>
      )}
    </Section>
  );
}
