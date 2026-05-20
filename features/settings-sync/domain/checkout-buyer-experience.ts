export interface BuyerExperienceTree {
  requirePhoneNumber: boolean;
  marketingConsentDefault: boolean;
}

const DEFAULTS: BuyerExperienceTree = {
  requirePhoneNumber: false,
  marketingConsentDefault: false,
};

/** Verify field path against the deployed Shopify Admin API version at implement time. */
export const BUYER_EXPERIENCE_QUERY = `
  query BuyerExperience {
    shop {
      buyerExperienceConfiguration {
        checkoutConfiguration {
          requirePhoneNumber
          marketingConsentDefault
        }
      }
    }
  }
`;

export function normalizeBuyerExperience(data: unknown): BuyerExperienceTree {
  const cfg = (data as { shop?: { buyerExperienceConfiguration?: { checkoutConfiguration?: Partial<BuyerExperienceTree> } } })
    ?.shop?.buyerExperienceConfiguration?.checkoutConfiguration;
  return {
    requirePhoneNumber: cfg?.requirePhoneNumber ?? DEFAULTS.requirePhoneNumber,
    marketingConsentDefault: cfg?.marketingConsentDefault ?? DEFAULTS.marketingConsentDefault,
  };
}

export function denormalizeBuyerExperience(
  current: BuyerExperienceTree,
  effective: BuyerExperienceTree,
): Partial<BuyerExperienceTree> {
  const out: Partial<BuyerExperienceTree> = {};
  for (const k of Object.keys(effective) as Array<keyof BuyerExperienceTree>) {
    if (current[k] !== effective[k]) out[k] = effective[k];
  }
  return out;
}

/** Verify mutation name and input shape against the deployed Shopify Admin API version. */
export const BUYER_EXPERIENCE_MUTATION = `
  mutation BuyerExperienceUpdate($input: ShopBuyerExperienceConfigurationInput!) {
    shopBuyerExperienceConfigurationUpdate(input: $input) {
      buyerExperienceConfiguration { checkoutConfiguration { requirePhoneNumber marketingConsentDefault } }
      userErrors { field message }
    }
  }
`;
