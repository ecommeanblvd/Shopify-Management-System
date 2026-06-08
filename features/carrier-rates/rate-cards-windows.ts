// Pure window helpers for rate cards. Kept out of the 'use server' actions
// file so it can export a synchronous function (server-action modules may
// only export async functions).

export interface WindowLike { effectiveFrom: string; effectiveTo: string | null }

/** Inclusive-day overlap test. An open-ended card (effectiveTo null) extends
 *  to +∞. Used to forbid creating overlapping cards for one account. ISO
 *  date strings compare lexicographically, so plain string comparison works. */
export function windowsOverlap(existing: WindowLike[], next: WindowLike): boolean {
  const nf = next.effectiveFrom;
  const nt = next.effectiveTo ?? '9999-12-31';
  for (const e of existing) {
    const ef = e.effectiveFrom;
    const et = e.effectiveTo ?? '9999-12-31';
    // [ef,et] ∩ [nf,nt] non-empty.
    if (ef <= nt && nf <= et) return true;
  }
  return false;
}
