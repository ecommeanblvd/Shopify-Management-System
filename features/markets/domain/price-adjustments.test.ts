import { describe, it, expect } from 'vitest';
import {
  buildPriceListInput, PRICE_LIST_CREATE_MUTATION, PRICE_LIST_UPDATE_MUTATION, PRICE_LIST_DELETE_MUTATION,
} from './price-adjustments';

describe('buildPriceListInput', () => {
  it('builds input for a markup price list (+12%)', () => {
    expect(buildPriceListInput({
      marketId: 'gid://shopify/Market/1',
      marketName: 'Europe',
      currency: 'EUR',
      adjustmentValue: 12,
    })).toEqual({
      name: 'Markets sync – Europe',
      currency: 'EUR',
      parent: {
        adjustment: { type: 'PERCENTAGE_INCREASE', value: 12 },
      },
      contextRule: { marketId: 'gid://shopify/Market/1' },
    });
  });

  it('builds input for a discount price list (-5%) using PERCENTAGE_DECREASE', () => {
    expect(buildPriceListInput({
      marketId: 'gid://shopify/Market/2',
      marketName: 'Asia',
      currency: 'USD',
      adjustmentValue: -5,
    })).toEqual({
      name: 'Markets sync – Asia',
      currency: 'USD',
      parent: {
        adjustment: { type: 'PERCENTAGE_DECREASE', value: 5 },
      },
      contextRule: { marketId: 'gid://shopify/Market/2' },
    });
  });
});

describe('price list mutations', () => {
  it('all are valid GraphQL mutations', () => {
    expect(PRICE_LIST_CREATE_MUTATION).toContain('priceListCreate');
    expect(PRICE_LIST_UPDATE_MUTATION).toContain('priceListUpdate');
    expect(PRICE_LIST_DELETE_MUTATION).toContain('priceListDelete');
  });
});
