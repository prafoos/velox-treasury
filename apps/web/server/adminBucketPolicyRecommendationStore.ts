import pg from 'pg';
import type { BucketPolicySuggestion } from '../../api/src/agent/types';

const { Client } = pg;
type PgClient = InstanceType<typeof Client>;
const ARC_MAINNET_CHAIN_ID = 5042n;

export interface BucketPolicyRecommendationStore {
  getOrCreate(
    adminWallet: string,
    createSuggestion: () => Promise<BucketPolicySuggestion>,
  ): Promise<{ readonly suggestion: BucketPolicySuggestion; readonly disposition: 'GENERATED' | 'ACTIVE_EXISTING' }>;
  regenerate(
    adminWallet: string,
    createSuggestion: () => Promise<BucketPolicySuggestion>,
  ): Promise<BucketPolicySuggestion>;
}

export class BucketPolicyRegenerationError extends Error {
  constructor(readonly category: 'INSUFFICIENT_VERIFIED_DATA' | 'UNAVAILABLE') {
    super(category === 'INSUFFICIENT_VERIFIED_DATA'
      ? 'Gemini could not produce a replacement because verified evidence is insufficient. The current recommendation was preserved.'
      : 'A valid replacement recommendation was unavailable. The current recommendation was preserved.');
    this.name = 'BucketPolicyRegenerationError';
  }
}

interface StoredRecommendationRow {
  suggestion: BucketPolicySuggestion;
}

function hasReadyAllocation(suggestion: BucketPolicySuggestion): boolean {
  return suggestion.allocations.length === 4
    && suggestion.totalBps === 10_000
    && suggestion.recommendationStatus !== 'INSUFFICIENT_VERIFIED_DATA'
    && suggestion.recommendationStatus !== 'UNAVAILABLE';
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl?.trim()) {
    throw new Error('POSTGRES_URL is required for the Admin recommendation lifecycle store.');
  }
  return databaseUrl;
}

async function withLockedRecommendation<T>(
  adminWallet: string,
  operation: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${ARC_MAINNET_CHAIN_ID}:${adminWallet.toLowerCase()}`,
    ]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function getStoredRecommendation(client: PgClient, adminWallet: string): Promise<BucketPolicySuggestion | null> {
  const result = await client.query<StoredRecommendationRow>(
    `SELECT suggestion
     FROM admin_bucket_policy_recommendations
     WHERE chain_id = $1 AND admin_wallet = $2
     FOR UPDATE`,
    [ARC_MAINNET_CHAIN_ID.toString(), adminWallet.toLowerCase()],
  );
  const suggestion = result.rows[0]?.suggestion;
  if (suggestion === undefined) return null;
  if (!suggestion || typeof suggestion !== 'object' || !Array.isArray(suggestion.allocations)) {
    throw new Error('Stored Admin bucket policy recommendation is invalid; refusing to regenerate implicitly.');
  }
  return suggestion;
}

async function saveRecommendation(
  client: PgClient,
  adminWallet: string,
  suggestion: BucketPolicySuggestion,
): Promise<void> {
  const generatedAt = suggestion.lineage?.generatedAt ?? new Date().toISOString();
  await client.query(
    `INSERT INTO admin_bucket_policy_recommendations
       (chain_id, admin_wallet, suggestion, generated_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (chain_id, admin_wallet) DO UPDATE
       SET suggestion = EXCLUDED.suggestion,
           generated_at = EXCLUDED.generated_at,
           updated_at = now()`,
    [
      ARC_MAINNET_CHAIN_ID.toString(),
      adminWallet.toLowerCase(),
      JSON.stringify(suggestion, (_, value) => (typeof value === 'bigint' ? value.toString() : value)),
      generatedAt,
    ],
  );
}

export const postgresBucketPolicyRecommendationStore: BucketPolicyRecommendationStore = {
  async getOrCreate(adminWallet, createSuggestion) {
    return withLockedRecommendation(adminWallet, async (client) => {
      const stored = await getStoredRecommendation(client, adminWallet);
      if (stored) return { suggestion: stored, disposition: 'ACTIVE_EXISTING' };

      const suggestion = await createSuggestion();
      if (suggestion.lineage) await saveRecommendation(client, adminWallet, suggestion);
      return { suggestion, disposition: 'GENERATED' };
    });
  },

  async regenerate(adminWallet, createSuggestion) {
    return withLockedRecommendation(adminWallet, async (client) => {
      const suggestion = await createSuggestion();
      if (!hasReadyAllocation(suggestion) || !suggestion.lineage) {
        throw new BucketPolicyRegenerationError(
          suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA'
            ? 'INSUFFICIENT_VERIFIED_DATA'
            : 'UNAVAILABLE',
        );
      }
      await saveRecommendation(client, adminWallet, suggestion);
      return suggestion;
    });
  },
};
