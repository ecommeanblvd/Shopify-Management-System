import { useEffect, useState } from 'preact/hooks';
import { customerGraphql } from '../lib/customer-graphql';
import { Section } from './Section';

interface ProfileData {
  displayName: string | null;
  email: string | null;
  address: string | null;
}

const PROFILE_QUERY = `
  query CustomerProfile {
    customer {
      displayName
      emailAddress { emailAddress }
      defaultAddress { formatted }
    }
  }
`;

interface ProfileResponse {
  customer: {
    displayName?: string | null;
    emailAddress?: { emailAddress?: string | null } | null;
    defaultAddress?: { formatted?: string[] | null } | null;
  } | null;
}

export function ProfileCard({ title, icon }: { title: string; icon: string | null }) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    customerGraphql<ProfileResponse>(PROFILE_QUERY)
      .then((res) => {
        if (!active) return;
        const c = res.customer;
        setData({
          displayName: c?.displayName ?? null,
          email: c?.emailAddress?.emailAddress ?? null,
          address: c?.defaultAddress?.formatted?.filter(Boolean).join(', ') ?? null,
        });
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
          <s-text>We couldn't load your profile right now.</s-text>
        </s-banner>
      ) : !data ? (
        <s-spinner accessibilityLabel="Loading profile" />
      ) : (
        <s-stack direction="block" gap="small-100">
          {data.displayName ? <s-text type="strong">{data.displayName}</s-text> : null}
          {data.email ? <s-text tone="subdued">{data.email}</s-text> : null}
          {data.address ? (
            <s-text tone="subdued">{data.address}</s-text>
          ) : (
            <s-text tone="subdued">No default address on file.</s-text>
          )}
        </s-stack>
      )}
    </Section>
  );
}
