export interface BackfillRow { id: string; code: string; mmpRef: string | null; source: string }
export interface CodeBackfillPlan {
  updates: { id: string; from: string; to: string }[];
  collisions: { id: string; mmpRef: string }[];
}

/** THUẦN: đơn MMP có mmpRef khác code → đổi code=mmpRef, TRỪ khi mmpRef trùng
 *  code của đơn khác (giữ unique). */
export function planCodeBackfill(rows: BackfillRow[]): CodeBackfillPlan {
  const codeOwner = new Map(rows.map((r) => [r.code, r.id]));
  const updates: CodeBackfillPlan['updates'] = [];
  const collisions: CodeBackfillPlan['collisions'] = [];
  for (const r of rows) {
    if (r.source !== 'mmp' || !r.mmpRef || r.mmpRef === r.code) continue;
    const owner = codeOwner.get(r.mmpRef);
    if (owner && owner !== r.id) { collisions.push({ id: r.id, mmpRef: r.mmpRef }); continue; }
    updates.push({ id: r.id, from: r.code, to: r.mmpRef });
  }
  return { updates, collisions };
}
