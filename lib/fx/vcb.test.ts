import { describe, expect, it } from 'vitest';
import { parseVcbUsd } from './vcb';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<ExrateList>
  <DateTime>7/2/2026 9:00:00 AM</DateTime>
  <Exrate CurrencyCode="AUD" CurrencyName="AUSTRALIAN DOLLAR" Buy="17,000.00" Transfer="17,100.00" Sell="17,500.00" />
  <Exrate CurrencyCode="USD" CurrencyName="US DOLLAR" Buy="26,100.00" Transfer="26,130.00" Sell="26,466.00" />
  <Exrate CurrencyCode="EUR" CurrencyName="EURO" Buy="28,000.00" Transfer="28,100.00" Sell="29,000.00" />
</ExrateList>`;

describe('parseVcbUsd', () => {
  it('bóc đúng Buy/Transfer/Sell của USD', () => {
    expect(parseVcbUsd(XML)).toEqual({ buy: 26100, transfer: 26130, sell: 26466 });
  });
  it('không có USD → null', () => {
    expect(parseVcbUsd('<ExrateList><Exrate CurrencyCode="EUR" Buy="1" Transfer="2" Sell="3"/></ExrateList>')).toBeNull();
  });
  it('rỗng / rác → null', () => {
    expect(parseVcbUsd('')).toBeNull();
    expect(parseVcbUsd('<nope/>')).toBeNull();
  });
  it('thứ tự attribute khác nhau vẫn bóc được', () => {
    const x = '<Exrate Sell="26,500.00" CurrencyCode="USD" Buy="26,000.00" Transfer="26,100.00"/>';
    expect(parseVcbUsd(x)).toEqual({ buy: 26000, transfer: 26100, sell: 26500 });
  });
});
