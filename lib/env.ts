import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY_V1: z.string().length(64),
  ENCRYPTION_KEY_CURRENT: z.string().min(1),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SHOPIFY_API_VERSION: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.parse(source);
  // The zod schema only declares ENCRYPTION_KEY_V1. This cross-check reads directly from
  // `source` so future versions (e.g. ENCRYPTION_KEY_V2) can be introduced without touching
  // the cross-check logic — but each new version MUST also be added to the zod schema above so its format is validated.
  const versionKey = `ENCRYPTION_KEY_${parsed.ENCRYPTION_KEY_CURRENT.toUpperCase()}`;
  if (!source[versionKey]) {
    throw new Error(`ENCRYPTION_KEY_CURRENT="${parsed.ENCRYPTION_KEY_CURRENT}" has no matching ${versionKey}`);
  }
  return parsed;
}

// Lazily memoized accessor — avoids crashing at import time when process.env is incomplete (e.g. in tests).
let _env: Env | undefined;
export function getEnv(): Env {
  if (!_env) {
    _env = parseEnv(process.env);
  }
  return _env;
}

/** For use in tests only. Clears the memoized env so the next getEnv() re-validates. */
export function _resetEnvForTesting(): void {
  _env = undefined;
}
