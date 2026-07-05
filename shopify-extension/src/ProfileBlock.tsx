import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getLoyalty } from './lib/api';

// Mini block for `customer-account.profile.block.render`: a compact membership
// summary (loyalty tier badge) with a nudge toward the full account hub, where
// store credit, tracking, wishlist and returns live. Kept intentionally light —
// blocks render inline on the profile page, so we avoid heavy data loads.
function ProfileBlock() {
  const [tier, setTier] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getLoyalty()
      .then((res) => {
        if (!active) return;
        setTier(res.tier);
        setNote(res.note ?? null);
      })
      .catch((e) => {
        if (active) setError(String(e?.message ?? e));
      });
    return () => {
      active = false;
    };
  }, []);

  // Fail quietly on a block — never surface a raw error in the profile chrome.
  if (error) return null;
  if (tier === undefined) return <s-spinner accessibilityLabel="Loading membership" />;

  return (
    <s-section heading="Membership">
      <s-stack direction="block" gap="small-100">
        {tier ? (
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-text tone="subdued">Tier</s-text>
            <s-badge tone="info">{tier}</s-badge>
          </s-stack>
        ) : (
          <s-text tone="subdued">No membership tier yet.</s-text>
        )}
        {note ? <s-text tone="subdued">{note}</s-text> : null}
        <s-text tone="subdued">
          Visit your account hub for store credit, order tracking, wishlist and returns.
        </s-text>
      </s-stack>
    </s-section>
  );
}

export default async () => {
  render(<ProfileBlock />, document.body);
};
