/** THUẦN: view helpers cho Wishlist Page extension. */
export function fmtMoney(amount: string | null, currency: string | null): string {
  if (amount === null) return '';
  if (currency === 'USD') return `$${amount}`;
  return currency ? `${amount} ${currency}` : amount;
}

export function productUrl(shopDomain: string, handle: string): string {
  return `https://${shopDomain}/products/${handle}`;
}

export function soldOutBadge(availableForSale: boolean | null): string | null {
  return availableForSale === false ? 'Sold out' : null;
}
