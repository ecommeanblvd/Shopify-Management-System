import { describe, it, expect } from 'vitest';
import {
  buildCurrencySettingsInput, CURRENCY_SETTINGS_UPDATE_MUTATION,
} from './currencies';

describe('buildCurrencySettingsInput', () => {
  it('builds input with primary currency only', () => {
    expect(buildCurrencySettingsInput('USD', [])).toEqual({
      baseCurrency: 'USD',
      localCurrencies: false,
    });
  });

  it('sets localCurrencies true when alternatives exist', () => {
    expect(buildCurrencySettingsInput('EUR', ['GBP', 'USD'])).toEqual({
      baseCurrency: 'EUR',
      localCurrencies: true,
    });
  });
});

describe('CURRENCY_SETTINGS_UPDATE_MUTATION', () => {
  it('is a marketCurrencySettingsUpdate mutation', () => {
    expect(CURRENCY_SETTINGS_UPDATE_MUTATION).toContain('marketCurrencySettingsUpdate');
  });
});
