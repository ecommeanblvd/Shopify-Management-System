import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getConfig, getOrders, type OrderRow } from './lib/api';
import { renderPlan } from './lib/render-plan';
import {
  getJourney,
  postCancelRequest,
  postClaimRequest,
  postTracking,
  uploadPhoto,
  CLAIM_REASON_CODES,
  type ClaimReasonCode,
  type JourneyResponse,
} from './lib/journey-api';
import { stageChip, cancelCopy, requestStatusLabel, fmtMoney } from './lib/journey-vm';

const CLAIM_REASON_LABELS: Record<ClaimReasonCode, string> = {
  damaged_package: 'Damaged package',
  damaged_product: 'Damaged or defective product',
  wrong_item: 'Wrong item',
  wrong_size: 'Wrong size',
  missing_item: 'Missing item',
  other: 'Other',
};

type View = { name: 'list' } | { name: 'detail'; orderId: string } | { name: 'claim'; orderId: string };

function Hub() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'list' });

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
  if (!config) return <s-spinner accessibilityLabel="Loading your account" />;
  if (!config.enabled) {
    return (
      <s-section heading="My account">
        <s-text tone="subdued">Account hub is not enabled for this store.</s-text>
      </s-section>
    );
  }

  // renderPlan() reserved for future modules; the order journey view below is always shown when enabled.
  renderPlan(config);

  return (
    <s-stack direction="block" gap="large-100">
      <s-heading>My account</s-heading>
      {config.branding.announcement ? (
        <s-banner>
          <s-text>{config.branding.announcement}</s-text>
        </s-banner>
      ) : null}
      {view.name === 'list' ? (
        <OrdersList onSelect={(orderId) => setView({ name: 'detail', orderId })} />
      ) : view.name === 'detail' ? (
        <OrderDetail
          orderId={view.orderId}
          onBack={() => setView({ name: 'list' })}
          onClaim={() => setView({ name: 'claim', orderId: view.orderId })}
        />
      ) : (
        <ClaimWizard orderId={view.orderId} onDone={() => setView({ name: 'detail', orderId: view.orderId })} />
      )}
    </s-stack>
  );
}

function OrdersList({ onSelect }: { onSelect: (orderId: string) => void }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOrders()
      .then((r) => {
        if (active) setOrders(r.orders);
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
        <s-text>We couldn't load your orders right now.</s-text>
      </s-banner>
    );
  }
  if (!orders) return <s-spinner accessibilityLabel="Loading your orders" />;
  if (orders.length === 0) {
    return (
      <s-section heading="Your orders">
        <s-text tone="subdued">No orders yet.</s-text>
      </s-section>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      {orders.map((o) => {
        const chip = stageChip(o.currentStage);
        return (
          <s-section key={o.orderId} heading={`Order ${o.orderNumber}`}>
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
                <s-text tone="subdued">{o.placedAt}</s-text>
                <s-badge tone={chip.tone}>{chip.label}</s-badge>
              </s-stack>
              <s-text>{fmtMoney(o.total, o.currency)}</s-text>
              <s-button onClick={() => onSelect(o.orderId)}>View order</s-button>
            </s-stack>
          </s-section>
        );
      })}
    </s-stack>
  );
}

function OrderDetail({
  orderId,
  onBack,
  onClaim,
}: {
  orderId: string;
  onBack: () => void;
  onClaim: () => void;
}) {
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'critical'; message: string } | null>(null);

  const load = () =>
    getJourney(orderId).then((r) => {
      setData(r);
    });

  useEffect(() => {
    let active = true;
    load().catch((e) => {
      if (active) setError(String(e?.message ?? e));
    });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (error) {
    return (
      <s-stack direction="block" gap="base">
        <s-button onClick={onBack}>Back to orders</s-button>
        <s-banner tone="critical">
          <s-text>We couldn't load this order right now.</s-text>
        </s-banner>
      </s-stack>
    );
  }
  if (!data) return <s-spinner accessibilityLabel="Loading order" />;

  const { order, timeline, productionEta, policy, requests } = data;
  const cancelMessage = cancelCopy(policy);

  const confirmCancel = async () => {
    setCancelling(true);
    setFeedback(null);
    try {
      const res = await postCancelRequest(orderId);
      if (!res.ok) throw new Error(res.error ?? 'Cancellation request failed.');
      setFeedback({ tone: 'success', message: 'Your cancellation request has been submitted.' });
      setShowCancelConfirm(false);
      await load();
    } catch (e) {
      setFeedback({ tone: 'critical', message: String((e as Error)?.message ?? e) });
    } finally {
      setCancelling(false);
    }
  };

  const claimWindowClosed = !policy.canClaim && policy.claimDeadline !== null;

  return (
    <s-stack direction="block" gap="large">
      <s-button onClick={onBack}>Back to orders</s-button>

      <s-section heading={`Order ${order.orderNumber}`}>
        <s-stack direction="block" gap="base">
          <s-text>{fmtMoney(order.total, order.currency)}</s-text>

          {timeline ? (
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{timeline.currentStageLabel}</s-text>
              {timeline.steps.map((step) => (
                <s-stack key={step.label} direction="inline" gap="base" justifyContent="space-between">
                  <s-text type={step.label === timeline.currentStageLabel ? 'strong' : undefined}>
                    {step.label}
                  </s-text>
                  <s-text tone="subdued">{step.at ?? '—'}</s-text>
                </s-stack>
              ))}
              {productionEta ? <s-text tone="subdued">Estimated completion: {productionEta}</s-text> : null}
            </s-stack>
          ) : null}

          {feedback ? (
            <s-banner tone={feedback.tone}>
              <s-text>{feedback.message}</s-text>
            </s-banner>
          ) : null}

          <s-divider />

          <s-stack direction="block" gap="base">
            {policy.canCancel && cancelMessage ? (
              <s-stack direction="block" gap="small-500">
                <s-text>{cancelMessage}</s-text>
                {!showCancelConfirm ? (
                  <s-button tone="critical" onClick={() => setShowCancelConfirm(true)}>
                    Cancel order
                  </s-button>
                ) : (
                  <s-stack direction="block" gap="small-500">
                    <s-banner tone="warning">
                      <s-text>{cancelMessage}</s-text>
                    </s-banner>
                    <s-stack direction="inline" gap="base">
                      <s-button tone="critical" disabled={cancelling} onClick={confirmCancel}>
                        {cancelling ? 'Cancelling…' : 'Confirm cancellation'}
                      </s-button>
                      <s-button disabled={cancelling} onClick={() => setShowCancelConfirm(false)}>
                        Keep order
                      </s-button>
                    </s-stack>
                  </s-stack>
                )}
              </s-stack>
            ) : null}

            {policy.canClaim ? (
              <s-button onClick={onClaim}>Report a problem</s-button>
            ) : claimWindowClosed ? (
              <s-text tone="subdued">Claim window closed — please contact support for help.</s-text>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      {requests.length > 0 ? (
        <s-section heading="Requests">
          <s-stack direction="block" gap="large">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} onTrackingSaved={load} />
            ))}
          </s-stack>
        </s-section>
      ) : null}
    </s-stack>
  );
}

function RequestRow({
  request,
  onTrackingSaved,
}: {
  request: JourneyResponse['requests'][number];
  onTrackingSaved: () => Promise<void> | void;
}) {
  const [carrier, setCarrier] = useState(request.returnCarrier ?? '');
  const [tracking, setTracking] = useState(request.returnTrackingNumber ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = requestStatusLabel(request.kind, request.status);

  const saveTracking = async () => {
    if (!carrier.trim() || !tracking.trim()) {
      setError('Please enter both carrier and tracking number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await postTracking(request.id, carrier.trim(), tracking.trim());
      if (!res.ok) throw new Error(res.error ?? 'Could not save tracking.');
      await onTrackingSaved();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <s-stack direction="block" gap="small-500">
      <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
        <s-text type="strong">{label}</s-text>
        <s-text tone="subdued">{request.createdAt}</s-text>
      </s-stack>
      {request.rejectedReason ? <s-text tone="critical">{request.rejectedReason}</s-text> : null}
      {request.refundAmount ? <s-text>{fmtMoney(request.refundAmount, request.currency)}</s-text> : null}

      {request.status === 'approved' && request.returnHub ? (
        <s-stack direction="block" gap="small-500">
          <s-text type="strong">Return to</s-text>
          <s-text>{request.returnHub.label}</s-text>
          <s-text>{request.returnHub.recipientName}</s-text>
          <s-text>{request.returnHub.addressLine1}</s-text>
          {request.returnHub.addressLine2 ? <s-text>{request.returnHub.addressLine2}</s-text> : null}
          <s-text>
            {request.returnHub.city}, {request.returnHub.state} {request.returnHub.postalCode}
          </s-text>
          <s-text>{request.returnHub.country}</s-text>
          <s-text>{request.returnHub.phone}</s-text>
          {request.returnShippingPayer ? (
            <s-text tone="subdued">{request.returnShippingPayer} pays return shipping</s-text>
          ) : null}

          {error ? (
            <s-banner tone="critical">
              <s-text>{error}</s-text>
            </s-banner>
          ) : null}
          <s-text-field
            label="Carrier"
            name="carrier"
            value={carrier}
            onChange={(e: any) => setCarrier(e?.currentTarget?.value ?? e?.target?.value ?? '')}
          />
          <s-text-field
            label="Tracking number"
            name="tracking"
            value={tracking}
            onChange={(e: any) => setTracking(e?.currentTarget?.value ?? e?.target?.value ?? '')}
          />
          <s-button disabled={saving} onClick={saveTracking}>
            {saving ? 'Saving…' : 'Save tracking'}
          </s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

function ClaimWizard({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reasons, setReasons] = useState<Set<ClaimReasonCode>>(new Set());
  const [description, setDescription] = useState('');
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleReason = (code: ClaimReasonCode) => {
    setReasons((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const onFilesChosen = async (e: any) => {
    const files: FileList | undefined = e?.currentTarget?.files ?? e?.target?.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const keys: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i);
        if (!file) continue;
        const { key } = await uploadPhoto(file);
        keys.push(key);
      }
      setPhotoKeys((prev) => [...prev, ...keys]);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await postClaimRequest(orderId, Array.from(reasons), photoKeys, description.trim() || undefined);
      if (!res.ok) throw new Error(res.error ?? 'Claim submission failed.');
      onDone();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <s-section heading="Report a problem">
      <s-stack direction="block" gap="large">
        {error ? (
          <s-banner tone="critical">
            <s-text>{error}</s-text>
          </s-banner>
        ) : null}

        {step === 1 ? (
          <s-stack direction="block" gap="base">
            <s-text type="strong">What went wrong?</s-text>
            {CLAIM_REASON_CODES.map((code) => (
              <label key={code} style="display:flex;align-items:center;gap:8px;">
                <input
                  type="checkbox"
                  checked={reasons.has(code)}
                  onChange={() => toggleReason(code)}
                />
                {CLAIM_REASON_LABELS[code]}
              </label>
            ))}
            <s-text-field
              label="Additional details (optional)"
              name="description"
              value={description}
              onChange={(e: any) => setDescription(e?.currentTarget?.value ?? e?.target?.value ?? '')}
            />
            <s-stack direction="inline" gap="base">
              <s-button onClick={onDone}>Cancel</s-button>
              <s-button variant="primary" disabled={reasons.size === 0} onClick={() => setStep(2)}>
                Next
              </s-button>
            </s-stack>
          </s-stack>
        ) : step === 2 ? (
          <s-stack direction="block" gap="base">
            <s-text type="strong">Add photos</s-text>
            <input type="file" accept="image/png,image/jpeg" multiple onChange={onFilesChosen} />
            {uploading ? <s-spinner accessibilityLabel="Uploading photos" /> : null}
            <s-text tone="subdued">{photoKeys.length} photo(s) uploaded</s-text>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => setStep(1)}>Back</s-button>
              <s-button variant="primary" onClick={() => setStep(3)}>
                Next
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-text type="strong">Review</s-text>
            <s-text>Reasons: {Array.from(reasons).map((c) => CLAIM_REASON_LABELS[c]).join(', ')}</s-text>
            {description ? <s-text>Details: {description}</s-text> : null}
            <s-text tone="subdued">{photoKeys.length} photo(s) attached</s-text>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => setStep(2)}>Back</s-button>
              <s-button variant="primary" disabled={submitting} onClick={submit}>
                {submitting ? 'Submitting…' : 'Submit'}
              </s-button>
            </s-stack>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

export default async () => {
  render(<Hub />, document.body);
};
