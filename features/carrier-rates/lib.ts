/**
 * Compute the age in whole days between `now` and a past timestamp.
 *
 * Exposed as a top-level helper (not inlined into a server component) so the
 * react-hooks/purity lint rule does not flag the impure `Date.now()` read.
 * Server components in this app are re-rendered per request, so reading the
 * wall clock here is intentional and safe.
 */
export function daysSince(when: Date | string): number {
  const ts = typeof when === 'string' ? Date.parse(when) : when.getTime();
  // eslint-disable-next-line react-hooks/purity
  const elapsedMs = Date.now() - ts;
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}
