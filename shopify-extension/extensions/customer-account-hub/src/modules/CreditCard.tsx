import { useEffect, useState } from 'preact/hooks';
import { customerGraphql } from '../lib/customer-graphql';
import { getLoyalty } from '../lib/api';
import { Section } from './Section';

interface CreditBalance {
  amount: string;
  currencyCode: string;
}

// NOTE: `storeCreditAccounts` is only exposed on newer Customer Account API
// versions. If the field is missing on the store's pinned version, this query
// throws and we simply hide the credit balance (loyalty tier still renders).
// Verify against the live schema version — see docs/customer-account-deploy.md.
const STORE_CREDIT_QUERY = `
  query StoreCredit {
    customer {
      storeCreditAccounts(first: 5) {
        nodes { balance { amount currencyCode } }
      }
    }
  }
`;

interface StoreCreditResponse {
  customer: {
    storeCreditAccounts?: {
      nodes?: Array<{ balance?: { amount?: string | null; currencyCode?: string | null } | null }>;
    } | null;
  } | null;
}

export function CreditCard({ title, icon }: { title: string; icon: string | null }) {
  const [balances, setBalances] = useState<CreditBalance[] | null>(null);
  const [tier, setTier] = useState<string | null | undefined>(undefined);
  const [loyaltyNote, setLoyaltyNote] = useState<string | null>(null);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Store credit is best-effort: hide silently if the field isn't available.
    customerGraphql<StoreCreditResponse>(STORE_CREDIT_QUERY)
      .then((res) => {
        if (!active) return;
        const nodes = res.customer?.storeCreditAccounts?.nodes ?? [];
        setBalances(
          nodes
            .map((n) => n.balance)
            .filter((b): b is { amount: string; currencyCode: string } => Boolean(b?.amount && b?.currencyCode))
            .map((b) => ({ amount: b.amount, currencyCode: b.currencyCode })),
        );
      })
      .catch(() => {
        if (active) setBalances([]);
      });

    getLoyalty()
      .then((res) => {
        if (!active) return;
        setTier(res.tier);
        setLoyaltyNote(res.note ?? null);
      })
      .catch((e) => {
        if (active) setLoyaltyError(String(e?.message ?? e));
      });

    return () => {
      active = false;
    };
  }, []);

  const loading = balances === null && tier === undefined;

  return (
    <Section title={title} icon={icon}>
      {loading ? (
        <s-spinner accessibilityLabel="Loading store credit" />
      ) : (
        <s-stack direction="block" gap="base">
          {tier ? (
            <s-stack direction="inline" gap="small-100" alignItems="center">
              <s-text tone="subdued">Membership</s-text>
              <s-badge tone="info">{tier}</s-badge>
            </s-stack>
          ) : loyaltyError ? null : (
            <s-text tone="subdued">No membership tier yet.</s-text>
          )}
          {loyaltyNote ? <s-text tone="subdued">{loyaltyNote}</s-text> : null}

          {balances && balances.length > 0 ? (
            <s-stack direction="block" gap="small-100">
              <s-text tone="subdued">Store credit</s-text>
              {balances.map((b, i) => (
                <s-text key={i} type="strong">
                  {b.amount} {b.currencyCode}
                </s-text>
              ))}
            </s-stack>
          ) : (
            <s-text tone="subdued">No store credit available.</s-text>
          )}
        </s-stack>
      )}
    </Section>
  );
}
