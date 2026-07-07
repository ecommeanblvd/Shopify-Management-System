import { describe, it, expect } from 'vitest';
import { extractProductAttributes } from './extract';
import type { CatalogProduct } from '../recommend';

function prod(over: Partial<CatalogProduct> & { title: string }): CatalogProduct {
  return {
    shopifyProductId: 'gid://1', handle: 'h', vendor: 'Cici', productType: null, tags: [],
    imageUrl: 'x', priceMin: '100', currency: 'VND', availableForSale: true, status: 'ACTIVE',
    syncedAt: new Date('2026-07-01'), ...over,
  };
}

describe('extractProductAttributes (real cici-style products)', () => {
  it('Off-Shoulder Midi Dress in Black → dress, Winter color, off_shoulder', () => {
    const a = extractProductAttributes(prod({ title: 'Noelle Off-Shoulder Dress', productType: 'Midi Dress', tags: ['Black', 'Midi Dress', 'Prom'] }));
    expect(a.category).toBe('dress');
    expect(a.colorFamilies).toContain('Winter'); // black
    expect(a.necklines).toContain('off_shoulder');
    expect(a.features).toContain('off_shoulder');
  });

  it('Wide Leg Pants → bottom, relaxed fit', () => {
    const a = extractProductAttributes(prod({ title: 'Athena Wide Leg Pants', productType: 'Pants' }));
    expect(a.category).toBe('bottom');
    expect(a.fits).toContain('relaxed'); // "wide" → relaxed
  });

  it('Red Mini Dress → dress, Winter+Spring color families', () => {
    const a = extractProductAttributes(prod({ title: 'Anita Mini Dress', productType: 'Mini Dress', tags: ['Red', 'Prom', 'Festive'] }));
    expect(a.category).toBe('dress');
    expect(a.colorFamilies).toEqual(expect.arrayContaining(['Winter', 'Spring'])); // red
  });

  it('Floral Lace Peplum Top → romantic mood, peplum, top', () => {
    const a = extractProductAttributes(prod({ title: 'Eirlys Floral Lace Peplum Top', productType: 'Top' }));
    expect(a.category).toBe('top');
    expect(a.moods).toContain('romantic'); // floral/lace/peplum
    expect(a.silhouettes).toContain('peplum');
  });

  it('Leather Moto Jacket → outerwear, edgy mood', () => {
    const a = extractProductAttributes(prod({ title: 'Rebel Leather Moto Jacket', productType: 'Jacket' }));
    expect(a.category).toBe('outerwear');
    expect(a.moods).toContain('edgy');
  });

  it('missing metadata → nulls, not fabricated attributes', () => {
    const a = extractProductAttributes(prod({ title: 'Evadne 32 Skorts', productType: 'Skorts', tags: [] }));
    expect(a.colorFamilies).toBeNull(); // no color word
    expect(a.moods).toBeNull();
    expect(a.category).toBe('bottom'); // skort → bottom (productType still usable)
  });

  it('Tailored Blazer → classic mood + structured fit + outerwear', () => {
    const a = extractProductAttributes(prod({ title: 'Office Tailored Blazer', productType: 'Blazer', tags: ['Office', 'Navy'] }));
    expect(a.category).toBe('outerwear');
    expect(a.moods).toContain('classic');
    expect(a.fits).toContain('structured');
    expect(a.colorFamilies).toEqual(expect.arrayContaining(['Winter', 'Summer'])); // navy
  });
});
