import { useEffect, useState } from 'preact/hooks';
import { getOrders, getTimeline, type OrderRow, type PublicTimeline } from '../lib/api';
import { Section } from './Section';

export function TrackingList({ title, icon }: { title: string; icon: string | null }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOrders()
      .then((res) => {
        if (active) setOrders(res.orders);
      })
      .catch((e) => {
        if (active) setError(String(e?.message ?? e));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Section title={title} icon={icon}>
      {error ? (
        <s-banner tone="critical">
          <s-text>We couldn't load your orders right now.</s-text>
        </s-banner>
      ) : !orders ? (
        <s-spinner accessibilityLabel="Loading orders" />
      ) : orders.length === 0 ? (
        <s-text tone="subdued">No orders yet.</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          {orders.map((o) => (
            <OrderItem
              key={o.orderId}
              order={o}
              expanded={selected === o.orderId}
              onToggle={() => setSelected(selected === o.orderId ? null : o.orderId)}
            />
          ))}
        </s-stack>
      )}
    </Section>
  );
}

function OrderItem({
  order,
  expanded,
  onToggle,
}: {
  order: OrderRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <s-stack direction="block" gap="small-100">
      <s-clickable onClick={onToggle} accessibilityLabel={`Order ${order.orderNumber}`}>
        <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
          <s-stack direction="block" gap="small-500">
            <s-text type="strong">Order {order.orderNumber}</s-text>
            <s-text tone="subdued">
              {order.total} {order.currency}
            </s-text>
          </s-stack>
          {order.currentStage ? <s-badge>{order.currentStage}</s-badge> : null}
        </s-stack>
      </s-clickable>
      {expanded ? <OrderTimeline orderId={order.orderId} /> : null}
    </s-stack>
  );
}

function OrderTimeline({ orderId }: { orderId: string }) {
  const [timeline, setTimeline] = useState<PublicTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTimeline(orderId)
      .then((res) => {
        if (active) setTimeline(res.timeline);
      })
      .catch((e) => {
        if (active) setError(String(e?.message ?? e));
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (error) {
    return (
      <s-banner tone="critical">
        <s-text>We couldn't load the tracking details.</s-text>
      </s-banner>
    );
  }
  if (!timeline) return <s-spinner accessibilityLabel="Loading tracking" />;

  return (
    <s-box padding="base" borderRadius="base" background="subdued">
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
    </s-box>
  );
}
