import { describe, expect, test } from 'vitest';
import { normaliseShopHandle } from './ShopHandleInput';

describe('normaliseShopHandle', () => {
  test('bare handle passes through', () => {
    expect(normaliseShopHandle('mirer-shop')).toBe('mirer-shop');
  });

  test('strips trailing .myshopify.com', () => {
    expect(normaliseShopHandle('mirer-shop.myshopify.com')).toBe('mirer-shop');
  });

  test('strips https:// prefix', () => {
    expect(normaliseShopHandle('https://mirer-shop.myshopify.com')).toBe('mirer-shop');
  });

  test('strips http:// prefix', () => {
    expect(normaliseShopHandle('http://mirer-shop.myshopify.com')).toBe('mirer-shop');
  });

  test('strips path after first slash', () => {
    expect(normaliseShopHandle('https://mirer-shop.myshopify.com/admin')).toBe('mirer-shop');
    expect(normaliseShopHandle('https://mirer-shop.myshopify.com/admin/orders')).toBe('mirer-shop');
  });

  test('lowercases', () => {
    expect(normaliseShopHandle('Mirer-Shop')).toBe('mirer-shop');
    expect(normaliseShopHandle('MIRER-SHOP.myshopify.com')).toBe('mirer-shop');
  });

  test('trims whitespace', () => {
    expect(normaliseShopHandle('  mirer-shop  ')).toBe('mirer-shop');
  });

  test('drops invalid characters (e.g. dots in the middle)', () => {
    // Someone typing "mirer.shop" by mistake — drop the dot, not silently
    // smuggle a bad domain into the install URL.
    expect(normaliseShopHandle('mirer.shop')).toBe('mirershop');
    expect(normaliseShopHandle('mirer_shop')).toBe('mirershop');
    expect(normaliseShopHandle('mirer shop')).toBe('mirershop');
  });

  test('empty input → empty output', () => {
    expect(normaliseShopHandle('')).toBe('');
    expect(normaliseShopHandle('   ')).toBe('');
  });
});
