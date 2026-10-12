import { describe, expect, it, vi } from 'vitest';

import { createWalletSessionToken, WalletAuthError } from '../../server/wallet-auth';
import type { BucketPolicySuggestion } from '../../../api/src/agent/types';
import {
  BucketPolicyRegenerationError,
  type BucketPolicyRecommendationStore,
} from '../../server/adminBucketPolicyRecommendationStore';
import { classifyAiFailure, handleAdminAiRequest, handleUserAiRequest } from '../../api/ai';

const sessionSecret = 'ai-boundary-session-secret-at-least-32-bytes';
const walletAddress = '0x1111111111111111111111111111111111111111' as const;
process.env.AUTH_SESSION_SECRET = sessionSecret;

function createResponse() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

function createMemoryRecommendationStore(): BucketPolicyRecommendationStore {
  let active: any = null;
  return {
    async getOrCreate(_wallet, createSuggestion) {
      if (active) return { suggestion: active, disposition: 'ACTIVE_EXISTING' };
      active = await createSuggestion();
      return { suggestion: active, disposition: 'GENERATED' };
    },
    async regenerate(_wallet, createSuggestion) {
      const next = await createSuggestion();
      if (next.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA'
        || next.recommendationStatus === 'UNAVAILABLE'
        || !next.lineage) {
        throw new BucketPolicyRegenerationError(
          next.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA' ? 'INSUFFICIENT_VERIFIED_DATA' : 'UNAVAILABLE',
        );
      }
      active = next;
      return next;
    },
  };
}

describe('AI request boundary', () => {
  it('requires an authenticated session before invoking User AI', async () => {
    const response = createResponse();
    const service = { generateUserAnalysis: vi.fn(), generateAdminRecommendation: vi.fn() };

    await handleUserAiRequest({ method: 'POST', body: { prompt: 'Explain my balance' } }, response, {
      resolveUserProjection: vi.fn(async () => ({
        scope: 'USER' as const,
        authenticatedWalletAddress: walletAddress,
        chainId: 5042 as const,
        walletUSDC: 500n,
        userBalance: 100n,
        treasuryFinancialState: null,
        publicOperationalStatus: { paused: false, blockNumber: 42n },
        immediateWithdrawalLiquidity: { source: 'UNAVAILABLE' as const, availability: 'UNAVAILABLE' as const, status: 'UNAVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, value: null },
      })),
      createService: vi.fn(() => service as never),
    });

    expect(response.statusCode).toBe(401);
    expect(service.generateUserAnalysis).not.toHaveBeenCalled();
  });

  it('uses the authenticated wallet for a user AI request and passes through the user prompt', async () => {
    const response = createResponse();
    const userProjection = {
      scope: 'USER' as const,
      authenticatedWalletAddress: walletAddress,
      chainId: 5042 as const,
      walletUSDC: 500n,
      userBalance: 100n,
      treasuryFinancialState: {
        principal: 100n,
        currentValue: 110n,
        unrealizedPnl: 10n,
        realizedPnl: 0n,
        totalPnl: 10n,
      },
      publicOperationalStatus: { paused: false, blockNumber: 42n },
      immediateWithdrawalLiquidity: { source: 'CORE' as const, availability: 'AVAILABLE' as const, status: 'CONSTRAINED' as const, unit: 'USDC_BASE_UNITS' as const, value: 50n },
    };
    const service = {
      generateUserAnalysis: vi.fn(async () => 'Your balance looks healthy.'),
      generateAdminRecommendation: vi.fn(),
    };
    const resolveUserProjection = vi.fn(async () => userProjection);
    const createService = vi.fn(() => service as never);

    await handleUserAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { prompt: 'How is my balance?' },
    }, response, { resolveUserProjection, createService });

    expect(response.statusCode).toBe(200);
    expect(resolveUserProjection).toHaveBeenCalledWith(walletAddress);
    expect(service.generateUserAnalysis).toHaveBeenCalledWith(userProjection, 'How is my balance?');
    expect(response.body).toMatchObject({ scope: 'USER', answer: 'Your balance looks healthy.' });
  });

  it('binds the User AI strategy facts to the server-authenticated wallet resolver', async () => {
    const response = createResponse();
    const strategyStatus = {
      source: 'CORE' as const,
      availability: 'AVAILABLE' as const,
      reason: 'VALUATION_STALE' as const,
      approved: true,
      enabled: true,
      paused: false,
      positionShares: 0n,
      positionValue: 0n,
      valuationStatus: 'STALE' as const,
      valuationBlock: 25_416_075n,
      verifiedAtBlock: 25_561_179n,
    };
    const service = {
      generateUserAnalysis: vi.fn(async () => 'The approved strategy is blocked by its stale valuation.'),
      generateAdminRecommendation: vi.fn(),
    };
    const resolveUserProjection = vi.fn(async () => ({
      scope: 'USER' as const,
      authenticatedWalletAddress: walletAddress,
      chainId: 5042 as const,
      walletUSDC: null,
      userBalance: null,
      treasuryFinancialState: null,
      publicOperationalStatus: { paused: false, blockNumber: 42n },
      immediateWithdrawalLiquidity: {
        source: 'UNAVAILABLE' as const,
        availability: 'UNAVAILABLE' as const,
        status: 'UNAVAILABLE' as const,
        unit: 'USDC_BASE_UNITS' as const,
        value: null,
      },
    }));
    const resolvePersonalStrategyStatus = vi.fn(async (account: string) => {
      expect(account).toBe(walletAddress);
      return strategyStatus;
    });

    await handleUserAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { prompt: 'What is my strategy status?' },
    }, response, {
      resolveUserProjection,
      resolvePersonalStrategyStatus,
      createService: vi.fn(() => service as never),
    });

    expect(response.statusCode).toBe(200);
    expect(service.generateUserAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedWalletAddress: walletAddress,
        personalStrategyStatus: strategyStatus,
      }),
      'What is my strategy status?',
    );
    expect(JSON.stringify(response.body)).not.toMatch(/totalDeployed|totalManagedAssets|otherUsers/i);
  });

  it('requires admin role metadata for Admin AI and rejects query-param spoofing', async () => {
    const response = createResponse();
    const adminProjection = {
      scope: 'ADMIN' as const,
      authenticatedWalletAddress: walletAddress,
      chainId: 5042 as const,
      coreAddress: '0x8B7a9B8C4f4dE6F8a1F4f0d2C3A4E5A6b7c8d9e0' as const,
      treasury: {
        totalUserLiabilities: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '1000' },
        liquidUSDC: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '900' },
        requiredLiquidReserve: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '100' },
        availableLiquidity: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '800' },
        totalDeployed: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '700' },
        totalManagedAssets: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '1000' },
        paused: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'BOOLEAN' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: false },
        blockNumber: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'BLOCK' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: '42' },
      },
      authorization: {
        policyAdmin: { source: 'CORE' as const, availability: 'AVAILABLE' as const, unit: 'BOOLEAN' as const, zeroMeaning: 'AUTHORITATIVE_ZERO' as const, value: true },
      },
      exposure: { source: 'CORE' as const, availability: 'PARTIAL' as const, data: { configuredStrategyCurrentValue: { source: 'CORE' as const, availability: 'AVAILABLE' as const, value: '700', unit: 'USDC_BASE_UNITS' as const } }, reason: 'partial read' },
    };
    const service = {
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(async () => ({
        actor: 'AI',
        executionStatus: 'NOT_EXECUTABLE',
        recommendationId: 'rec-1',
        target: adminProjection.coreAddress,
        rationale: ['Keep exposure in check.'],
        expectedEffect: 'Reduce risk.',
        riskClassification: 'MEDIUM',
        requiredApproval: 'ADMIN',
      })),
    };

    await handleAdminAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      query: { account: '0x2222222222222222222222222222222222222222' },
      body: { prompt: 'Reduce exposure' },
    }, response, {
      resolveAdminProjection: vi.fn(async () => adminProjection),
      createService: vi.fn(() => service as never),
    });

    expect(response.statusCode).toBe(403);
    expect(service.generateAdminRecommendation).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('GEMINI_API_KEY is required for Gemini provider.'), 503, 'AI_PROVIDER_NOT_CONFIGURED', 'AI provider is not configured.'],
    [new Error('Gemini request timed out after 15000ms.'), 504, 'AI_PROVIDER_TIMEOUT', 'AI provider request timed out.'],
    [new Error('Gemini API error (HTTP 429): private provider detail'), 429, 'AI_PROVIDER_RATE_LIMITED', 'AI provider rate limit reached.'],
    [new Error('Gemini API error (HTTP 401): private provider detail'), 503, 'AI_PROVIDER_CONFIGURATION', 'AI provider configuration is unavailable.'],
    [new Error('Gemini API error (HTTP 404): private provider detail'), 502, 'AI_PROVIDER_MODEL_UNAVAILABLE', 'Configured AI model or endpoint is unavailable.'],
    [new Error('Gemini provider network error: private provider detail'), 502, 'AI_PROVIDER_NETWORK_ERROR', 'AI provider request failed due to a network error.'],
    [new Error('Gemini response body was not valid JSON.'), 502, 'AI_PROVIDER_INVALID_RESPONSE', 'AI provider returned an invalid response.'],
  ])('maps provider failures safely', (error, status, category, safeMessage) => {
    const failure = classifyAiFailure(error);

    expect(failure).toEqual({ status, category, error: safeMessage });
    expect(JSON.stringify(failure)).not.toContain('private provider detail');
    expect(JSON.stringify(failure)).not.toContain('GEMINI_API_KEY');
  });

  it('returns a categorized sanitized provider failure from User AI without exposing provider details', async () => {
    const response = createResponse();
    const service = {
      generateUserAnalysis: vi.fn(async () => { throw new Error('Gemini API error (HTTP 429): private provider response'); }),
      generateAdminRecommendation: vi.fn(),
    };

    await handleUserAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { prompt: 'Explain my P/L' },
    }, response, {
      resolveUserProjection: vi.fn(async () => ({
        scope: 'USER' as const,
        authenticatedWalletAddress: walletAddress,
        chainId: 5042 as const,
        walletUSDC: null,
        userBalance: null,
        treasuryFinancialState: null,
        publicOperationalStatus: { paused: null, blockNumber: null },
        immediateWithdrawalLiquidity: { source: 'UNAVAILABLE' as const, availability: 'UNAVAILABLE' as const, status: 'UNAVAILABLE' as const, unit: 'USDC_BASE_UNITS' as const, value: null },
      })),
      createService: vi.fn(() => service as never),
    });

    expect(response.statusCode).toBe(429);
    expect(response.body).toEqual({ status: 429, category: 'AI_PROVIDER_RATE_LIMITED', error: 'AI provider rate limit reached.' });
    expect(JSON.stringify(response.body)).not.toContain('private provider response');
  });

  it('reports only safe validation paths when Admin Gemini output fails schema validation', async () => {
    const response = createResponse();
    const validationError = Object.assign(new Error('private generated recommendation value'), {
      name: 'ZodError',
      issues: [{ path: ['actionType'], message: 'private invalid model value' }],
    });
    const service = {
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(async () => { throw validationError; }),
    };

    await handleAdminAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { prompt: 'Analyze current Treasury state' },
    }, response, {
      resolveAdminProjection: vi.fn(async () => ({ scope: 'ADMIN' as const }) as never),
      createService: vi.fn(() => service as never),
    });

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({
      status: 502,
      category: 'AI_RECOMMENDATION_VALIDATION_FAILED',
      error: 'AI recommendation did not match the required format.',
      validationPaths: ['actionType'],
    });
    expect(JSON.stringify(response.body)).not.toContain('private generated recommendation value');
    expect(JSON.stringify(response.body)).not.toContain('private invalid model value');
  });

  it('allows an authenticated POLICY_ADMIN projection to request a bucket policy suggestion', async () => {
    const response = createResponse();
    const adminProjection = {
      scope: 'ADMIN' as const,
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
    };
    const marketRisk = { status: 'UNAVAILABLE', reason: 'No configured Core strategy identity.', freshness: { status: 'UNAVAILABLE' } };
    const suggestion = {
      advisoryLabel: 'AI recommendation — Admin review required.',
      recommendationStatus: 'UNAVAILABLE',
      marketDataStatus: 'UNAVAILABLE',
      marketData: null,
      coreConstraints: { status: 'UNAVAILABLE', maximumYieldStrategyBufferBps: null, minimumLiquidOperationalReserveBps: null },
      veloxFacts: { treasury: {}, currentBucketPolicy: {}, strategy: {} },
      allocations: [],
      totalPercentage: null,
      totalBps: null,
      keyRiskAssumptions: ['Market information is unavailable.'],
      unavailableData: ['Verified market data are unavailable.'],
      executionStatus: 'NOT_EXECUTABLE',
    };
    const service = {
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(),
      generateBucketPolicySuggestion: vi.fn(async () => suggestion),
    };

    await handleAdminAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { task: 'SUGGEST_BUCKET_POLICY' },
    }, response, {
      resolveAdminProjection: vi.fn(async () => adminProjection as never),
      resolveMarketRiskSnapshot: vi.fn(async () => marketRisk as never),
      createService: vi.fn(() => service as never),
      bucketPolicyRecommendationStore: createMemoryRecommendationStore(),
    });

    expect(response.statusCode).toBe(200);
    expect(service.generateBucketPolicySuggestion).toHaveBeenCalledWith(expect.objectContaining({ ...adminProjection, marketRisk }), {
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      policyAdminRoleVerified: true,
    });
    expect(service.generateAdminRecommendation).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      scope: 'ADMIN',
      bucketPolicySuggestion: { recommendationStatus: 'UNAVAILABLE', totalBps: null, executionStatus: 'NOT_EXECUTABLE' },
    });
  });

  it('denies a normal User wallet before invoking the Admin bucket suggestion service', async () => {
    const response = createResponse();
    const service = {
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(),
      generateBucketPolicySuggestion: vi.fn(),
    };

    await handleAdminAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { task: 'SUGGEST_BUCKET_POLICY' },
    }, response, {
      resolveAdminProjection: vi.fn(async () => {
        throw new WalletAuthError(403, 'Connected wallet is not the Treasury POLICY_ADMIN.');
      }),
      createService: vi.fn(() => service as never),
    });

    expect(response.statusCode).toBe(403);
    expect(service.generateBucketPolicySuggestion).not.toHaveBeenCalled();
  });

  it('does not return a success-shaped suggestion when model allocations fail exact-total validation', async () => {
    const response = createResponse();
    const service = {
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(),
      generateBucketPolicySuggestion: vi.fn(async () => {
        throw new Error('Bucket policy suggestion must total exactly 10,000 BPS.');
      }),
    };

    await handleAdminAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { task: 'SUGGEST_BUCKET_POLICY' },
    }, response, {
      resolveAdminProjection: vi.fn(async () => ({ scope: 'ADMIN' as const }) as never),
      resolveMarketRiskSnapshot: vi.fn(async () => ({ status: 'UNAVAILABLE' }) as never),
      createService: vi.fn(() => service as never),
      bucketPolicyRecommendationStore: createMemoryRecommendationStore(),
    });

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({
      status: 502,
      category: 'AI_BUCKET_POLICY_SUGGESTION_INVALID',
      error: 'AI bucket policy suggestion did not meet the required format or allocation total.',
    });
    expect(service.generateAdminRecommendation).not.toHaveBeenCalled();
  });

  it('returns valid Gemini allocations with unavailable Core constraints for advisory display', async () => {
    const response = createResponse();
    const suggestion = {
      recommendationStatus: 'CORE_CONSTRAINTS_UNAVAILABLE',
      coreConstraints: {
        status: 'UNAVAILABLE',
        maximumYieldStrategyBufferBps: null,
        minimumLiquidOperationalReserveBps: null,
      },
      allocations: [
        { id: 'liquidOperationalReserve', bps: 5_000, percentage: '50.00%' },
        { id: 'yieldStrategyBuffer', bps: 2_500, percentage: '25.00%' },
        { id: 'sweepLiquidityBuffer', bps: 1_500, percentage: '15.00%' },
        { id: 'automationAgentPool', bps: 1_000, percentage: '10.00%' },
      ],
      totalBps: 10_000,
    };
    const service = {
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(),
      generateBucketPolicySuggestion: vi.fn(async () => suggestion),
    };

    await handleAdminAiRequest({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { task: 'SUGGEST_BUCKET_POLICY' },
    }, response, {
      resolveAdminProjection: vi.fn(async () => ({ scope: 'ADMIN' as const }) as never),
      resolveMarketRiskSnapshot: vi.fn(async () => ({ status: 'PARTIAL' }) as never),
      createService: vi.fn(() => service as never),
      bucketPolicyRecommendationStore: createMemoryRecommendationStore(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      scope: 'ADMIN',
      bucketPolicySuggestion: suggestion,
    });
    expect(service.generateBucketPolicySuggestion).toHaveBeenCalledOnce();
  });

  it('reuses the active recommendation on ordinary requests and regenerates only on explicit action', async () => {
    const store = createMemoryRecommendationStore();
    const makeSuggestion = (bps: number, rawGeminiResponse: string) => ({
      recommendationStatus: 'CORE_CONSTRAINTS_UNAVAILABLE',
      marketData: {
        freshness: {
          status: 'CURRENT',
          retrievedAt: '2026-10-03T10:00:00.000Z',
          maximumAgeSeconds: 600,
        },
      },
      allocations: [
        { id: 'liquidOperationalReserve', bps, percentage: `${(bps / 100).toFixed(2)}%` },
        { id: 'yieldStrategyBuffer', bps: 10_000 - bps, percentage: `${((10_000 - bps) / 100).toFixed(2)}%` },
        { id: 'sweepLiquidityBuffer', bps: 0, percentage: '0.00%' },
        { id: 'automationAgentPool', bps: 0, percentage: '0.00%' },
      ],
      totalBps: 10_000,
      lineage: {
        model: 'gemini-test-model',
        generatedAt: '2026-10-03T10:00:00.000Z',
        evidenceSnapshotId: 'a'.repeat(64),
        rawGeminiResponse,
        evidenceSnapshot: { treasury: { totalManagedAssets: 'verified' }, market: { block: '500' } },
      },
    });
    const firstGeminiResult = makeSuggestion(6_200, '{"allocations":{"liquidOperationalReserve":6200}}');
    const replacementGeminiResult = {
      ...makeSuggestion(5_900, '{"allocations":{"liquidOperationalReserve":5900}}'),
      lineage: {
        ...makeSuggestion(5_900, '{}').lineage,
        evidenceSnapshotId: 'b'.repeat(64),
      },
    };
    const service = {
      generateBucketPolicySuggestion: vi.fn()
        .mockResolvedValueOnce(firstGeminiResult)
        .mockResolvedValueOnce(replacementGeminiResult),
      generateUserAnalysis: vi.fn(),
      generateAdminRecommendation: vi.fn(),
    };
    const dependencies = {
      resolveAdminProjection: vi.fn(async () => ({ scope: 'ADMIN' as const }) as never),
      resolveMarketRiskSnapshot: vi.fn(async () => ({ status: 'PARTIAL' }) as never),
      createService: vi.fn(() => service as never),
      bucketPolicyRecommendationStore: store,
    };
    const request = (action: string) => ({
      method: 'POST',
      headers: { cookie: `velox_session=${createWalletSessionToken(walletAddress, sessionSecret)}` },
      body: { task: 'SUGGEST_BUCKET_POLICY', action },
    });

    const firstResponse = createResponse();
    await handleAdminAiRequest(request('GET_CURRENT_RECOMMENDATION'), firstResponse, dependencies);
    const firstBody = firstResponse.body as { bucketPolicySuggestion: BucketPolicySuggestion };
    expect(firstResponse.statusCode).toBe(200);
    expect(firstBody.bucketPolicySuggestion.allocations[0].bps).toBe(6_200);
    expect(firstBody.bucketPolicySuggestion.lineage?.evidenceSnapshotId).toBe('a'.repeat(64));
    expect(firstBody.bucketPolicySuggestion.lifecycle?.disposition).toBe('GENERATED');

    for (let index = 0; index < 5; index += 1) {
      const repeatedResponse = createResponse();
      await handleAdminAiRequest(request('GET_CURRENT_RECOMMENDATION'), repeatedResponse, dependencies);
      const repeated = repeatedResponse.body as { bucketPolicySuggestion: BucketPolicySuggestion };
      expect(repeated.bucketPolicySuggestion.allocations[0].bps).toBe(6_200);
      expect(repeated.bucketPolicySuggestion.lineage?.rawGeminiResponse).toBe(
        firstBody.bucketPolicySuggestion.lineage?.rawGeminiResponse,
      );
      expect(repeated.bucketPolicySuggestion.lifecycle?.disposition).toBe('ACTIVE_EXISTING');
    }
    expect(service.generateBucketPolicySuggestion).toHaveBeenCalledOnce();
    expect(dependencies.resolveMarketRiskSnapshot).toHaveBeenCalledOnce();

    const regenerateResponse = createResponse();
    await handleAdminAiRequest(request('REGENERATE_AI_RECOMMENDATION'), regenerateResponse, dependencies);
    const regenerated = regenerateResponse.body as { bucketPolicySuggestion: BucketPolicySuggestion };
    expect(regenerateResponse.statusCode).toBe(200);
    expect(regenerated.bucketPolicySuggestion.allocations[0].bps).toBe(5_900);
    expect(regenerated.bucketPolicySuggestion.lifecycle?.disposition).toBe('REGENERATED');
    expect(regenerated.bucketPolicySuggestion.lineage?.evidenceSnapshotId).toBe('b'.repeat(64));
    expect(service.generateBucketPolicySuggestion).toHaveBeenCalledTimes(2);
    expect(dependencies.resolveMarketRiskSnapshot).toHaveBeenCalledTimes(2);

    const insufficientSuggestion = {
      ...makeSuggestion(0, '{"status":"missingVerifiedData"}'),
      recommendationStatus: 'INSUFFICIENT_VERIFIED_DATA',
      allocations: [],
      totalBps: null,
    };
    service.generateBucketPolicySuggestion.mockResolvedValueOnce(insufficientSuggestion);
    const failedRegenerationResponse = createResponse();
    await handleAdminAiRequest(request('REGENERATE_AI_RECOMMENDATION'), failedRegenerationResponse, dependencies);
    expect(failedRegenerationResponse.statusCode).toBe(422);
    expect(failedRegenerationResponse.body).toMatchObject({
      category: 'AI_BUCKET_POLICY_REGENERATION_INSUFFICIENT_VERIFIED_DATA',
    });

    const finalCurrentResponse = createResponse();
    await handleAdminAiRequest(request('GET_CURRENT_RECOMMENDATION'), finalCurrentResponse, dependencies);
    const finalCurrent = finalCurrentResponse.body as { bucketPolicySuggestion: BucketPolicySuggestion };
    expect(finalCurrent.bucketPolicySuggestion.allocations[0].bps).toBe(5_900);
    expect(finalCurrent.bucketPolicySuggestion.lineage?.evidenceSnapshotId).toBe('b'.repeat(64));
    expect(service.generateBucketPolicySuggestion).toHaveBeenCalledTimes(3);
    expect(dependencies.resolveMarketRiskSnapshot).toHaveBeenCalledTimes(3);
  });
});
