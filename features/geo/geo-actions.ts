'use server';
import { requireManageShipHo } from '@/features/ship-ho/require-manage';
import { lookupPostcode } from './queries';

export async function lookupPostcodeAction(country: string, code: string) {
  await requireManageShipHo();
  if (!/^[A-Z]{2}$/.test(country) || !code.trim()) return { valid: false as boolean | null, city: null, stateCode: null, candidates: [] };
  return lookupPostcode(country, code.trim());
}
