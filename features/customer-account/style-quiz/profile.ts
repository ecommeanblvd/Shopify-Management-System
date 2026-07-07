/**
 * THUẦN: gộp 3 trục độc lập → StyleProfile. Xem spec §1. Không I/O.
 * archetype (what to show) × color-season (which shade) × body-shape (which fit).
 */
import { scoreColorAxes, deriveColorSeason, type ColorAnswers, type ColorResult } from './color-season';
import { scoreArchetype, type ArchetypeResult } from './archetype';
import { deriveBodyShape, type BodyAnswers, type BodyResult } from './body-shape';

export interface QuizAnswers {
  color?: ColorAnswers;
  archetype?: Record<string, string | string[]>;
  body?: BodyAnswers;
}

export interface StyleProfile {
  color: ColorResult;
  archetype: ArchetypeResult;
  body: BodyResult;
  /** Level cao nhất khách hoàn thành (1 quick, 2 refined). */
  levelReached: number;
}

export function deriveProfile(a: QuizAnswers, opts?: { refined?: boolean; levelReached?: number }): StyleProfile {
  const refined = opts?.refined === true;
  return {
    color: deriveColorSeason(scoreColorAxes(a.color ?? {}), { refined }),
    archetype: scoreArchetype(a.archetype ?? {}, { refined }),
    body: deriveBodyShape(a.body ?? {}, { refined }),
    levelReached: opts?.levelReached ?? (refined ? 2 : 1),
  };
}
