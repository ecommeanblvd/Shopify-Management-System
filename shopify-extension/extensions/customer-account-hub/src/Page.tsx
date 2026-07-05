import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getConfig } from './lib/api';
import { renderPlan, DEFAULT_TITLES, type ConfigModule, type AccountConfig } from './lib/render-plan';
import { ProfileCard } from './modules/ProfileCard';
import { CreditCard } from './modules/CreditCard';
import { TrackingList } from './modules/TrackingList';
import { WishlistCard } from './modules/WishlistCard';
import { ReturnCenter } from './modules/ReturnCenter';

function Hub() {
  const [config, setConfig] = useState<AccountConfig | null>(null);
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
  if (!config) return <s-spinner accessibilityLabel="Loading your account" />;
  if (!config.enabled) {
    return (
      <s-section heading="My account">
        <s-text tone="subdued">Account hub is not enabled for this store.</s-text>
      </s-section>
    );
  }

  const plan = renderPlan(config);
  return (
    <s-stack direction="block" gap="large-100">
      <s-heading>My account</s-heading>
      {config.branding.announcement ? (
        <s-banner>
          <s-text>{config.branding.announcement}</s-text>
        </s-banner>
      ) : null}
      <s-stack direction="block" gap="large">
        {plan.map((m) => (
          <Module key={m.key} m={m} branding={config.branding} />
        ))}
      </s-stack>
    </s-stack>
  );
}

function Module({ m, branding }: { m: ConfigModule; branding: AccountConfig['branding'] }) {
  const title = m.title ?? DEFAULT_TITLES[m.key];
  switch (m.key) {
    case 'profile':
      return <ProfileCard title={title} icon={m.iconUrl} />;
    case 'credit':
      return <CreditCard title={title} icon={m.iconUrl} />;
    case 'tracking':
      return <TrackingList title={title} icon={m.iconUrl} />;
    case 'wishlist':
      return <WishlistCard title={title} icon={m.iconUrl} supportEmail={branding.supportEmail} />;
    case 'returns':
      return <ReturnCenter title={title} icon={m.iconUrl} />;
    default:
      return null;
  }
}

export default async () => {
  render(<Hub />, document.body);
};
