import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Pool/drizzle do not open a connection at construction — only on first query —
// so reading DATABASE_URL directly here is build-safe even when it is unset.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export { schema };
