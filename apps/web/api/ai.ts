import type { Address } from 'viem';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGeminiAdapter, createVeloxAiService } from '../../api/src/agent/index.js';
import type { AdminAiInput, BucketPolicySuggestion, SteakhouseMarketSnapshot, UserAiInput, UserStrategyStatus } from '../../api/src/agent/types.js';
import {
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  type WalletAuthRequest,
  WalletAuthError,
} from '../server/wallet-auth';
import {
  BucketPolicyRegenerationError,
  postgresBucketPolicyRecommendationStore,
  type BucketPolicyRecommendationStore,
} from '../server/adminBucketPolicyRecommendationStore';
import { createServerClient, readUserProjection, resolveUserAccount, serializeApiData } from './core-state';
import { readUserStrategyPosition } from './strategy-state';
import { readAuthorizedAdminProjection, verifyAdminRole } from './admin-projection';

const webApiDirectory = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(webApiDirectory, '../.env') });
loadEnv({ path: resolve(webApiDirectory, '../../api/.env') });

export interface AiResponse {
  status(code: number): AiResponse;
  setHeader(name: string, value: string): AiResponse;
  json(body: unknown): void;
}

export interface UserAiRouteDependencies {
  readonly resolveUserProjection?: (walletAddress: Address) => Promise<UserAiInput>;
  readonly resolvePersonalStrategyStatus?: (walletAddress: Address) => Promise<UserStrategyStatus>;
  readonly createService?: () => {
    readonly generateUserAnalysis: (input: UserAiInput, userQuery?: string) => Promise<string>;
  };
}

export interface AdminAiRouteDependencies {
  readonly resolveAdminProjection?: (walletAddress: Address) => Promise<AdminAiInput>;
  readonly resolveMarketRiskSnapshot?: (projection: AdminAiInput) => Promise<SteakhouseMarketSnapshot>;
  readonly createService?: () => {
    readonly generateAdminRecommendation: (
      projection: AdminAiInput,
      authContext: { readonly authenticatedWalletAddress: Address; readonly chainId: number; readonly policyAdminRoleVerified: boolean; },
      options?: { readonly prompt?: string; readonly createdAt?: Date | string | number; readonly recommendationId?: string; },
    ) => Promise<unknown>;
    readonly generateBucketPolicySuggestion: (
      projection: AdminAiInput,
      authContext: { readonly authenticatedWalletAddress: Address; readonly chainId: number; readonly policyAdminRoleVerified: boolean; },
    ) => Promise<BucketPolicySuggestion>;
  };
  readonly bucketPolicyRecommendationStore?: BucketPolicyRecommendationStore;
}

function isBucketPolicySuggestionRequest(body: unknown): boolean {
  return body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && (body as Record<string, unknown>).task === 'SUGGEST_BUCKET_POLICY';
}

function isBucketPolicyRegenerationRequest(body: unknown): boolean {
  return body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && (body as Record<string, unknown>).action === 'REGENERATE_AI_RECOMMENDATION';
}

function getPrompt(body: unknown): string {
  if (body && typeof body === 'object') {
    const value = (body as Record<string, unknown>).prompt
      ?? (body as Record<string, unknown>).question
      ?? (body as Record<string, unknown>).message
      ?? (body as Record<string, unknown>).query;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (typeof body === 'string' && body.trim()) return body.trim();
  throw new WalletAuthError(400, 'A non-empty AI prompt is required.');
}

export interface SafeAiFailure {
  readonly status: number;
  readonly category: string;
  readonly error: string;
}

export function classifyAiFailure(error: unknown): SafeAiFailure {
  const message = error instanceof Error ? error.message : '';
  if (/GEMINI_API_KEY is required/i.test(message)) {
    return { status: 503, category: 'AI_PROVIDER_NOT_CONFIGURED', error: 'AI provider is not configured.' };
  }
  if (/timed out|timeout/i.test(message)) {
    return { status: 504, category: 'AI_PROVIDER_TIMEOUT', error: 'AI provider request timed out.' };
  }
  if (/Gemini API error \(HTTP (\d+)\)/i.test(message)) {
    const providerStatus = Number(message.match(/Gemini API error \(HTTP (\d+)\)/i)?.[1]);
    if (providerStatus === 429) {
      return { status: 429, category: 'AI_PROVIDER_RATE_LIMITED', error: 'AI provider rate limit reached.' };
    }
    if (providerStatus === 401 || providerStatus === 403) {
      return { status: 503, category: 'AI_PROVIDER_CONFIGURATION', error: 'AI provider configuration is unavailable.' };
    }
    if (providerStatus === 404) {
      return { status: 502, category: 'AI_PROVIDER_MODEL_UNAVAILABLE', error: 'Configured AI model or endpoint is unavailable.' };
    }
    return { status: 502, category: 'AI_PROVIDER_REQUEST_FAILED', error: 'AI provider could not complete the request.' };
  }
  if (/Gemini provider network error/i.test(message)) {
    return { status: 502, category: 'AI_PROVIDER_NETWORK_ERROR', error: 'AI provider request failed due to a network error.' };
  }
  if (/Gemini response|Gemini structured response/i.test(message)) {
    return { status: 502, category: 'AI_PROVIDER_INVALID_RESPONSE', error: 'AI provider returned an invalid response.' };
  }
  if (/^Bucket policy suggestion (?:must|contains|did not|exceeds)/i.test(message)) {
    return {
      status: 502,
      category: 'AI_BUCKET_POLICY_SUGGESTION_INVALID',
      error: 'AI bucket policy suggestion did not meet the required format or allocation total.',
    };
  }
  return { status: 500, category: 'AI_SERVER_ERROR', error: 'User AI is temporarily unavailable.' };
}

export async function handleUserAiRequest(
  request: WalletAuthRequest,
  response: AiResponse,
  dependencies: UserAiRouteDependencies = {},
  clientFactory: () => Parameters<typeof readUserProjection>[0] = createServerClient,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method && request.method.toUpperCase() !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let account: Address;
  try {
    account = resolveUserAccount(requireAuthenticatedWallet(request).authenticatedWalletAddress, request.query?.account);
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  try {
    const prompt = getPrompt(request.body);
    const service = dependencies.createService ?? (() => createVeloxAiService(createGeminiAdapter({
      apiKey: process.env.GEMINI_API_KEY,
    })));
    let projection: UserAiInput;
    if (dependencies.resolveUserProjection) {
      projection = await dependencies.resolveUserProjection(account);
      if (dependencies.resolvePersonalStrategyStatus) {
        projection = {
          ...projection,
          personalStrategyStatus: await dependencies.resolvePersonalStrategyStatus(account),
        };
      }
    } else {
      const client = clientFactory();
      const [financialProjection, position] = await Promise.all([
        readUserProjection(client, account),
        readUserStrategyPosition(client, account),
      ]);
      projection = {
        ...financialProjection,
        personalStrategyStatus: {
          source: 'CORE',
          availability: 'AVAILABLE',
          ...position.strategyStatus,
        },
      } as UserAiInput;
    }
    const answer = await service().generateUserAnalysis(projection, prompt);
    response.status(200).json(serializeApiData({
      scope: 'USER',
      authenticatedWalletAddress: account,
      answer,
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    const failure = classifyAiFailure(error);
    response.status(failure.status).json(failure);
  }
}

export async function handleAdminAiRequest(
  request: WalletAuthRequest,
  response: AiResponse,
  dependencies: AdminAiRouteDependencies = {},
  clientFactory: () => Parameters<typeof readAuthorizedAdminProjection>[0] = createServerClient,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method && request.method.toUpperCase() !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let account: Address;
  try {
    account = resolveUserAccount(requireAuthenticatedWallet(request).authenticatedWalletAddress, request.query?.account);
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  try {
    const suggestBucketPolicy = isBucketPolicySuggestionRequest(request.body);
    const regenerateBucketPolicy = suggestBucketPolicy && isBucketPolicyRegenerationRequest(request.body);
    const prompt = suggestBucketPolicy ? undefined : getPrompt(request.body);
    const resolveAdminProjection = dependencies.resolveAdminProjection ?? (async (walletAddress: Address) => {
      const client = clientFactory();
      await verifyAdminRole(client, walletAddress as `0x${string}`);
      return await readAuthorizedAdminProjection(client, walletAddress as `0x${string}`) as AdminAiInput;
    });
    const service = dependencies.createService ?? (() => createVeloxAiService(createGeminiAdapter({
      apiKey: process.env.GEMINI_API_KEY,
    })));
    const projection = await resolveAdminProjection(account);
    const authContext = {
      authenticatedWalletAddress: account,
      chainId: 5042,
      policyAdminRoleVerified: true,
    };
    if (suggestBucketPolicy) {
      const resolveMarketRiskSnapshot = dependencies.resolveMarketRiskSnapshot
        ?? (async (authorizedProjection: AdminAiInput) => {
          const {
            readVerifiedSteakhouseMarketSnapshot,
          } = await import('./steakhouse-market-data');
          return await readVerifiedSteakhouseMarketSnapshot(
            authorizedProjection,
            fetch,
            new Date(),
            createServerClient(),
          );
        });
      const createSuggestion = async () => {
        const marketRisk = await resolveMarketRiskSnapshot(projection);
        return service().generateBucketPolicySuggestion({ ...projection, marketRisk }, authContext);
      };
      const store = dependencies.bucketPolicyRecommendationStore ?? postgresBucketPolicyRecommendationStore;
      let bucketPolicySuggestion;
      let disposition: 'GENERATED' | 'ACTIVE_EXISTING' | 'REGENERATED';
      try {
        if (regenerateBucketPolicy) {
          bucketPolicySuggestion = await store.regenerate(account, createSuggestion);
          disposition = 'REGENERATED';
        } else {
          const active = await store.getOrCreate(account, createSuggestion);
          bucketPolicySuggestion = active.suggestion;
          disposition = active.disposition;
        }
      } catch (error) {
        if (error instanceof BucketPolicyRegenerationError) {
          response.status(422).json({
            status: 422,
            category: `AI_BUCKET_POLICY_REGENERATION_${error.category}`,
            error: error.message,
          });
          return;
        }
        throw error;
      }
      const freshness = bucketPolicySuggestion.marketData?.freshness;
      const retrievedAt = freshness ? Date.parse(freshness.retrievedAt) : Number.NaN;
      const evidenceStatus = !freshness || freshness.status === 'UNAVAILABLE' || !Number.isFinite(retrievedAt)
        ? 'UNAVAILABLE'
        : freshness.status === 'STALE'
          || Date.now() - retrievedAt > freshness.maximumAgeSeconds * 1000
          ? 'STALE'
          : 'CURRENT';
      response.status(200).json(serializeApiData({
        scope: 'ADMIN',
        authenticatedWalletAddress: account,
        bucketPolicySuggestion: {
          ...bucketPolicySuggestion,
          lifecycle: { disposition, evidenceStatus },
        },
      }));
    } else {
      const recommendation = await service().generateAdminRecommendation(projection, authContext, { prompt });
      response.status(200).json(serializeApiData({
        scope: 'ADMIN',
        authenticatedWalletAddress: account,
        recommendation,
      }));
    }
  } catch (error) {
    if (error instanceof WalletAuthError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.name === 'ZodError') {
      const issues = (error as Error & { issues?: unknown[] }).issues ?? [];
      const validationPaths = issues.flatMap((issue) => {
        if (!issue || typeof issue !== 'object' || !('path' in issue)) return [];
        const path = (issue as { path?: unknown }).path;
        return Array.isArray(path) ? [path.map((segment) => String(segment)).join('.')] : [];
      });
      response.status(502).json({
        status: 502,
        category: 'AI_RECOMMENDATION_VALIDATION_FAILED',
        error: 'AI recommendation did not match the required format.',
        validationPaths,
      });
      return;
    }
    const failure = classifyAiFailure(error);
    response.status(failure.status).json(failure);
  }
}

export default function handler(request: WalletAuthRequest, response: AiResponse): Promise<void> {
  return handleUserAiRequest(request, response);
}
