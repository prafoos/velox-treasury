import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const postgresUrl = process.env.POSTGRES_URL;

if (!postgresUrl) {
  throw new Error('POSTGRES_URL is required for Drizzle migrations.');
}

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: postgresUrl,
  },
  verbose: true,
  strict: true,
} satisfies Config;
