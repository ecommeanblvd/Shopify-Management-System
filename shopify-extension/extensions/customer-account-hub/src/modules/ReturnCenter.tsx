import { useEffect, useState } from 'preact/hooks';
import {
  getReturns,
  getOrders,
  createReturn,
  type ReturnRow,
  type OrderRow,
} from '../lib/api';
import { Section } from './Section';

type Feedback = { tone: 'success' | 'critical'; message: string } | null;

function statusTone(status: string): 'info' | 'success' | 'warning' | 'critical' {
  const s = status.toLowerCase();
  if (s.includes('approv') || s.includes('complete') || s.includes('refund')) return 'success';
  if (s.includes('reject') || s.includes('declin') || s.includes('cancel')) return 'critical';
  if (s.includes('pending') || s.includes('review')) return 'warning';
  return 'info';
}

export function ReturnCenter({ title, icon }: { title: string; icon: string | null }) {
  const [returns, setReturns] = useState<ReturnRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [orderId, setOrderId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = async () => {
    const [ret, ord] = await Promise.all([getReturns(), getOrders()]);
    setReturns(ret.returns);
    setOrders(ord.orders);
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

  const submit = async () => {
    if (!orderId || !reason.trim()) {
      setFeedback({ tone: 'critical', message: 'Please select an order and describe the reason.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await createReturn(orderId, reason.trim());
      if (!res.ok) throw new Error(res.error ?? 'Return request failed.');
      setFeedback({ tone: 'success', message: 'Your return request has been submitted.' });
      setOrderId('');
      setReason('');
      await load();
    } catch (e) {
      setFeedback({ tone: 'critical', message: String((e as Error)?.message ?? e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Section title={title} icon={icon}>
      {error ? (
        <s-banner tone="critical">
          <s-text>We couldn't load your returns right now.</s-text>
        </s-banner>
      ) : !returns ? (
        <s-spinner accessibilityLabel="Loading returns" />
      ) : (
        <s-stack direction="block" gap="large">
          {returns.length === 0 ? (
            <s-text tone="subdued">No returns yet.</s-text>
          ) : (
            <s-stack direction="block" gap="base">
              {returns.map((r) => (
                <s-stack
                  key={r.id}
                  direction="inline"
                  gap="base"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack direction="block" gap="small-500">
                    <s-text type="strong">
                      {r.orderNumber ? `Order ${r.orderNumber}` : `Order ${r.orderId}`}
                    </s-text>
                    <s-text tone="subdued">{r.reason}</s-text>
                  </s-stack>
                  <s-badge tone={statusTone(r.status)}>{r.status}</s-badge>
                </s-stack>
              ))}
            </s-stack>
          )}

          <s-stack direction="block" gap="base">
            <s-text type="strong">Request a return</s-text>
            {feedback ? (
              <s-banner tone={feedback.tone}>
                <s-text>{feedback.message}</s-text>
              </s-banner>
            ) : null}
            <s-select
              label="Order"
              name="order"
              value={orderId}
              onChange={(e: any) => setOrderId(e?.currentTarget?.value ?? e?.target?.value ?? '')}
            >
              <s-option value="">Select an order</s-option>
              {orders.map((o) => (
                <s-option key={o.orderId} value={o.orderId}>
                  Order {o.orderNumber}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              label="Reason"
              name="reason"
              value={reason}
              onChange={(e: any) => setReason(e?.currentTarget?.value ?? e?.target?.value ?? '')}
            />
            <s-button variant="primary" disabled={submitting} onClick={submit}>
              {submitting ? 'Submitting…' : 'Submit return'}
            </s-button>
          </s-stack>
        </s-stack>
      )}
    </Section>
  );
}
