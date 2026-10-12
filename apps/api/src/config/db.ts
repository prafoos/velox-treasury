import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { env } from './env.js';

export function createDatabaseClient() {
  return new Client({
    connectionString: env.POSTGRES_URL,
  });
}

export function createDb() {
  const client = createDatabaseClient();
  return drizzle(client, { logger: false });
}

export type DatabaseInstance = ReturnType<typeof createDb>;
