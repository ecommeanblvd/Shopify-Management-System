export interface PriceListInputArgs {
  marketId: string;
  marketName: string;
  currency: string;
  adjustmentValue: number;
}

export interface PriceListInput {
  name: string;
  currency: string;
  parent: {
    adjustment: {
      type: 'PERCENTAGE_INCREASE' | 'PERCENTAGE_DECREASE';
      value: number;
    };
  };
  contextRule: { marketId: string };
}

export function buildPriceListInput(args: PriceListInputArgs): PriceListInput {
  const isDecrease = args.adjustmentValue < 0;
  return {
    name: `Markets sync – ${args.marketName}`,
    currency: args.currency,
    parent: {
      adjustment: {
        type: isDecrease ? 'PERCENTAGE_DECREASE' : 'PERCENTAGE_INCREASE',
        value: Math.abs(args.adjustmentValue),
      },
    },
    contextRule: { marketId: args.marketId },
  };
}

export const PRICE_LIST_CREATE_MUTATION = `
  mutation PriceListCreate($input: PriceListCreateInput!) {
    priceListCreate(input: $input) {
      priceList { id }
      userErrors { field message }
    }
  }
`;

export const PRICE_LIST_UPDATE_MUTATION = `
  mutation PriceListUpdate($id: ID!, $input: PriceListUpdateInput!) {
    priceListUpdate(id: $id, input: $input) {
      priceList { id }
      userErrors { field message }
    }
  }
`;

export const PRICE_LIST_DELETE_MUTATION = `
  mutation PriceListDelete($id: ID!) {
    priceListDelete(id: $id) {
      deletedId
      userErrors { field message }
    }
  }
`;
