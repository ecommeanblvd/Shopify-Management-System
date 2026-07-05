import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getOrders, getTimeline, type PublicTimeline } from './lib/api';

// Block for `customer-account.order-status.block.render`: a compact tracking
// stepper for the order the buyer is currently viewing.
//
// ID BRIDGING (dev note): the order-status target exposes the order via
// `shopify.order` — a reactive signal whose value has a Shopify GID (`.id`,
// `gid://shopify/Order/<n>`) and merchant number (`.name`, e.g. `#1001`).
// The SMS timeline endpoint (`/orders/:id/timeline`) keys on the *internal*
// order UUID, not the Shopify GID, so we can't call `getTimeline` with `.id`
// directly. Instead we fetch the customer's SMS orders (`getOrders()`, scoped
// by the session token) and match on the order number — SMS stores
// `shopifyOrderNumber = payload.name`, so `#1001` lines up exactly. The matched
// row's `orderId` is the internal UUID we hand to `getTimeline`.
//
// If the order context is missing (pre-authenticated page or not-yet-processed
// order) or no SMS match is found, the block renders nothing rather than an
// error — an order-status block should stay quiet when it has nothing to add.
function OrderStatusBlock() {
  const [timeline, setTimeline] = useState<PublicTimeline | null>(null);
  // `hidden` = we determined there's nothing to show (no context / no match).
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;

    const orderName = shopify.order?.value?.name ?? null;
    if (!orderName) {
      setHidden(true);
      return;
    }

    (async () => {
      try {
        const { orders } = await getOrders();
        const match = orders.find((o) => o.orderNumber === orderName);
        if (!match) {
          if (active) setHidden(true);
          return;
        }
        const { timeline: tl } = await getTimeline(match.orderId);
        if (active) setTimeline(tl);
      } catch {
        // Blocks fail silently — the full account hub surfaces errors instead.
        if (active) setHidden(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (hidden) return null;
  if (!timeline) return <s-spinner accessibilityLabel="Loading tracking" />;

  return (
    <s-section heading="Order tracking">
      <s-stack direction="block" gap="small-100">
        <s-text type="strong">
          {timeline.currentStageLabel}
          {timeline.nextStageLabel ? ` → ${timeline.nextStageLabel}` : ''}
        </s-text>
        {timeline.steps.map((step, i) => (
          <s-stack key={i} direction="inline" gap="small-100" justifyContent="space-between">
            <s-text>{step.label}</s-text>
            {step.at ? <s-time value={step.at} /> : <s-text tone="subdued">—</s-text>}
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}

export default async () => {
  render(<OrderStatusBlock />, document.body);
};
