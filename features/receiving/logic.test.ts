import { describe, it, expect } from 'vitest';
import {
  decideDisposition, validateQc, inventoryEffect, nextSeqCode, parseSeq,
} from './logic';

describe('decideDisposition', () => {
  it('pass + retail_for_order => allocate_to_order', () => {
    expect(decideDisposition('retail_for_order', 'pass')).toBe('allocate_to_order');
  });
  it('pass + consignment/po => store', () => {
    expect(decideDisposition('consignment', 'pass')).toBe('store');
    expect(decideDisposition('po', 'pass')).toBe('store');
  });
  it('fail => return_to_brand for any source', () => {
    expect(decideDisposition('retail_for_order', 'fail')).toBe('return_to_brand');
    expect(decideDisposition('consignment', 'fail')).toBe('return_to_brand');
  });
  it('pending => pending', () => {
    expect(decideDisposition('po', 'pending')).toBe('pending');
  });
});

describe('validateQc', () => {
  it('fail requires reason and photo', () => {
    expect(validateQc({ qcResult: 'fail', qcFailReason: '', qcFailPhotoKey: '' }).ok).toBe(false);
    expect(validateQc({ qcResult: 'fail', qcFailReason: 'sai màu', qcFailPhotoKey: null }).ok).toBe(false);
    expect(validateQc({ qcResult: 'fail', qcFailReason: 'sai màu', qcFailPhotoKey: 'k/1.jpg' }).ok).toBe(true);
  });
  it('pass is always valid', () => {
    expect(validateQc({ qcResult: 'pass' }).ok).toBe(true);
  });
});

describe('inventoryEffect', () => {
  it('allocate_to_order with sku reserves and sets line in_stock', () => {
    expect(inventoryEffect('allocate_to_order', true)).toEqual({ onHandDelta: 1, reservedDelta: 1, lineStatus: 'in_stock' });
  });
  it('allocate_to_order without sku still sets line in_stock, no stock change', () => {
    expect(inventoryEffect('allocate_to_order', false)).toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: 'in_stock' });
  });
  it('store with sku increments on-hand only', () => {
    expect(inventoryEffect('store', true)).toEqual({ onHandDelta: 1, reservedDelta: 0, lineStatus: null });
  });
  it('return_to_brand and pending touch nothing', () => {
    expect(inventoryEffect('return_to_brand', true)).toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: null });
    expect(inventoryEffect('pending', true)).toEqual({ onHandDelta: 0, reservedDelta: 0, lineStatus: null });
  });
});

describe('seq codes', () => {
  it('formats with 5-digit padding', () => {
    expect(nextSeqCode('WH', 4)).toBe('WH-00005');
    expect(nextSeqCode('GRN', 0)).toBe('GRN-00001');
  });
  it('parses a code back to its number, 0 for invalid/null', () => {
    expect(parseSeq('WH', 'WH-00005')).toBe(5);
    expect(parseSeq('WH', null)).toBe(0);
    expect(parseSeq('WH', 'GRN-00005')).toBe(0);
  });
});
