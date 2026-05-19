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
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.parse(source);
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
