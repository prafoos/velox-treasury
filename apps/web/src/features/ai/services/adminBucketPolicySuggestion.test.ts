import { describe, expect, it, vi } from 'vitest';

import { isAdminBucketPolicySuggestion, requestAdminBucketPolicySuggestion } from './adminBucketPolicySuggestion';

const validSuggestion = {
  advisoryLabel: 'AI recommendation — Admin review required.',
  recommendationStatus: 'AVAILABLE',
  marketDataStatus: 'PARTIAL',
  marketData: {
    source: 'MORPHO_GRAPHQL',
    status: 'PARTIAL',
    network: 'Arc Mainnet',
    chainId: 5042,
    assetAddress: '0x3600000000000000000000000000000000000000',
    vaultAddress: '0xbeef0016cb2fd5c352ea7ca08a9f54739dfa7298',
    protocolName: 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2',
    protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
    identityVerified: true,
    freshness: {
      status: 'CURRENT',
      blockNumber: '100',
      blockTimestamp: String(Math.floor(Date.now() / 1000)),
      retrievedAt: new Date().toISOString(),
      ageSeconds: 0,
      maximumAgeSeconds: 600,
      sourceHeadBlockNumber: '100',
      sourceHeadBlockTimestamp: String(Math.floor(Date.now() / 1000)),
    },
    vault: {
      totalAssets: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '1000000', unit: 'USDC_BASE_UNITS' },
      availableLiquidity: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '250000', unit: 'USDC_BASE_UNITS' },
      idleLiquidity: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '250000', unit: 'USDC_BASE_UNITS' },
      utilizationBps: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'BPS' },
      totalSupply: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '900000', unit: 'SHARES' },
      apy: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0.0325', unit: 'RATIO' },
      netApy: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0.031', unit: 'RATIO' },
      allocation: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE' },
      depositAvailability: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE' },
      depositGateStatus: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: 'receiveAssetsGate address=null; abdicated=true', unit: 'GATE_CONFIG' },
      timelock: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'SECONDS' },
    },
    underlyingMarket: {
      allocation: { availability: 'UNAVAILABLE', value: null },
      liquidity: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '250000', unit: 'USDC_BASE_UNITS' },
      utilizationBps: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: 7500, unit: 'BPS' },
      collateralExposure: { availability: 'UNAVAILABLE', value: null },
      lltv: { availability: 'UNAVAILABLE', value: null },
      oracleStatus: { availability: 'UNAVAILABLE', value: null },
      badDebtStatus: { availability: 'UNAVAILABLE', value: null },
      liquidationRisk: { availability: 'UNAVAILABLE', value: null },
      warnings: { availability: 'UNAVAILABLE', value: null },
      marketId: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: `0x${'1'.repeat(64)}`, unit: 'MARKET_ID' },
      stateBlockNumber: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '100', unit: 'BLOCK' },
      stateTimestamp: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: String(Math.floor(Date.now() / 1000)), unit: 'UNIX_SECONDS' },
      collateralAssetAddress: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0x5555555555555555555555555555555555555555', unit: 'ADDRESS' },
      collateralAssetDecimals: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: 18, unit: 'DECIMALS' },
    },
    unavailableData: ['Underlying Morpho market facts unavailable.'],
  },
  coreConstraints: { status: 'AVAILABLE', maximumYieldStrategyBufferBps: 8000, minimumLiquidOperationalReserveBps: 1000 },
  veloxFacts: {
    treasury: {},
    currentBucketPolicy: {
      liquidOperationalReserveBps: { source: 'CORE', availability: 'AVAILABLE', value: 5_000, unit: 'BPS' },
      yieldStrategyBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 2_500, unit: 'BPS' },
      sweepLiquidityBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_500, unit: 'BPS' },
      automationAgentPoolBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_000, unit: 'BPS' },
    },
    strategy: {},
  },
  bucketPolicyValidation: { status: 'AVAILABLE', exceededBuckets: [] },
  allocations: [
    { id: 'liquidOperationalReserve', name: 'Liquid Operational Reserve', percentage: '50.00%', bps: 5_000, reasoning: 'Protect operational liquidity.' },
    { id: 'yieldStrategyBuffer', name: 'Yield Strategy Buffer', percentage: '25.00%', bps: 2_500, reasoning: 'Limit strategy exposure.' },
    { id: 'sweepLiquidityBuffer', name: 'Sweep Liquidity Buffer', percentage: '15.00%', bps: 1_500, reasoning: 'Preserve operational sweep liquidity.' },
    { id: 'automationAgentPool', name: 'Automation / AI Agent Pool', percentage: '10.00%', bps: 1_000, reasoning: 'Bound future authorized automation.' },
  ],
  totalPercentage: '100%',
  totalBps: 10_000,
  missingVerifiedData: [],
  evidenceReferences: ['underlyingMarket.liquidity'],
  keyRiskAssumptions: ['No market feed is available; this is conditional on the current projection.'],
  unavailableData: ['Verified live market data are unavailable.'],
  executionStatus: 'NOT_EXECUTABLE',
} as const;

describe('Admin bucket policy suggestion request', () => {
  it('requests only the advisory task from the authenticated Admin endpoint', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ scope: 'ADMIN', bucketPolicySuggestion: validSuggestion }),
    })) as unknown as typeof fetch;

    const result = await requestAdminBucketPolicySuggestion(fetcher);

    expect(fetcher).toHaveBeenCalledWith('/api/ai/admin', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        task: 'SUGGEST_BUCKET_POLICY',
        action: 'GET_CURRENT_RECOMMENDATION',
      }),
    }));
    expect(isAdminBucketPolicySuggestion(result)).toBe(true);
    expect(result.totalBps).toBe(10_000);
  });

  it('uses a distinct explicit action for regeneration', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ scope: 'ADMIN', bucketPolicySuggestion: validSuggestion }),
    })) as unknown as typeof fetch;

    await requestAdminBucketPolicySuggestion(fetcher, 'REGENERATE_AI_RECOMMENDATION');

    expect(fetcher).toHaveBeenCalledWith('/api/ai/admin', expect.objectContaining({
      body: JSON.stringify({
        task: 'SUGGEST_BUCKET_POLICY',
        action: 'REGENERATE_AI_RECOMMENDATION',
      }),
    }));
  });

  it('rejects responses with missing buckets or a non-exact total', () => {
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      allocations: validSuggestion.allocations.slice(0, 3),
    })).toBe(false);
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      allocations: validSuggestion.allocations.map((allocation, index) => ({
        ...allocation,
        bps: index === 3 ? allocation.bps - 1 : allocation.bps,
      })),
    })).toBe(false);
  });

  it('accepts an explicit unavailable status only when no allocation is provided', () => {
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      recommendationStatus: 'UNAVAILABLE',
      marketDataStatus: 'UNAVAILABLE',
      marketData: null,
      allocations: [],
      totalPercentage: null,
      totalBps: null,
    })).toBe(true);
  });

  it('accepts INSUFFICIENT_VERIFIED_DATA only with missing evidence and no percentages', () => {
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      recommendationStatus: 'INSUFFICIENT_VERIFIED_DATA',
      allocations: [],
      totalPercentage: null,
      totalBps: null,
      missingVerifiedData: ['automationAgentPool.verifiedDemandOrCapacity'],
    })).toBe(true);
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      recommendationStatus: 'INSUFFICIENT_VERIFIED_DATA',
      allocations: validSuggestion.allocations,
      missingVerifiedData: ['automationAgentPool.verifiedDemandOrCapacity'],
    })).toBe(false);
  });

  it('accepts the normalized insufficient-data response without generating allocation values', () => {
    const missingData = {
      ...validSuggestion,
      recommendationStatus: 'INSUFFICIENT_VERIFIED_DATA',
      allocations: [],
      totalPercentage: null,
      totalBps: null,
      missingVerifiedData: ['treasury.totalManagedAssets'],
    };

    expect(isAdminBucketPolicySuggestion(missingData)).toBe(true);
    expect(missingData.allocations).toEqual([]);
    expect(missingData.totalBps).toBeNull();
  });

  it('accepts an unchanged over-limit recommendation only as requiring Admin adjustment', () => {
    const allocations = validSuggestion.allocations.map((allocation) => {
      const values = {
        liquidOperationalReserve: { percentage: '10.00%', bps: 1_000 },
        yieldStrategyBuffer: { percentage: '81.00%', bps: 8_100 },
        sweepLiquidityBuffer: { percentage: '5.00%', bps: 500 },
        automationAgentPool: { percentage: '4.00%', bps: 400 },
      } as const;
      return { ...allocation, ...values[allocation.id] };
    });
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      recommendationStatus: 'REQUIRES_ADMIN_ADJUSTMENT',
      allocations,
      bucketPolicyValidation: { status: 'AVAILABLE', exceededBuckets: ['yieldStrategyBuffer'] },
    })).toBe(true);
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      recommendationStatus: 'AVAILABLE',
      allocations,
      bucketPolicyValidation: { status: 'AVAILABLE', exceededBuckets: ['yieldStrategyBuffer'] },
    })).toBe(false);
  });

  it('accepts exact Gemini allocations with unavailable Core limits for display only', () => {
    const suggestion = {
      ...validSuggestion,
      recommendationStatus: 'CORE_CONSTRAINTS_UNAVAILABLE',
      coreConstraints: {
        status: 'UNAVAILABLE',
        maximumYieldStrategyBufferBps: null,
        minimumLiquidOperationalReserveBps: null,
        reason: 'Core strategy exposure is unavailable.',
      },
    };
    expect(isAdminBucketPolicySuggestion(suggestion)).toBe(true);
    expect(suggestion.allocations.map(({ percentage, bps }) => [percentage, bps])).toEqual([
      ['50.00%', 5_000],
      ['25.00%', 2_500],
      ['15.00%', 1_500],
      ['10.00%', 1_000],
    ]);
    expect(isAdminBucketPolicySuggestion({
      ...suggestion,
      recommendationStatus: 'AVAILABLE',
    })).toBe(false);
  });

  it('accepts a current Arc RPC snapshot without Morpho-only APY and utilization fields', () => {
    const unavailable = { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE' };
    const marketData = {
      ...validSuggestion.marketData,
      source: 'ARC_MAINNET_RPC',
      vault: {
        ...validSuggestion.marketData.vault,
        totalAssets: { source: 'ARC_MAINNET_RPC', availability: 'AVAILABLE', value: '1000000', unit: 'USDC_BASE_UNITS' },
        availableLiquidity: { source: 'ARC_MAINNET_RPC', availability: 'AVAILABLE', value: '250000', unit: 'USDC_BASE_UNITS' },
        apy: unavailable,
      },
      underlyingMarket: {
        ...validSuggestion.marketData.underlyingMarket,
        utilizationBps: unavailable,
        marketId: unavailable,
      },
    };
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      marketData,
    })).toBe(true);
  });

  it('rejects a recommendation without verified live vault assets or liquidity', () => {
    const unavailable = { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE' };
    const marketData = {
      ...validSuggestion.marketData,
      vault: {
        ...validSuggestion.marketData.vault,
        totalAssets: unavailable,
        availableLiquidity: unavailable,
      },
      underlyingMarket: {
        ...validSuggestion.marketData.underlyingMarket,
        liquidity: unavailable,
      },
    };
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      marketData,
    })).toBe(false);
  });

  it('accepts a blocked recommendation when required market facts are unavailable, with no allocation', () => {
    expect(isAdminBucketPolicySuggestion({
      ...validSuggestion,
      recommendationStatus: 'UNAVAILABLE',
      marketDataStatus: 'PARTIAL',
      marketData: {
        ...validSuggestion.marketData,
        vault: {
          ...validSuggestion.marketData.vault,
          totalAssets: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'USDC_BASE_UNITS' },
          apy: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'RATIO' },
        },
      },
      allocations: [],
      totalPercentage: null,
      totalBps: null,
    })).toBe(true);
  });

  it('does not return suggestion-shaped success when the endpoint denies access', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Wallet is not an Admin.' }),
    })) as unknown as typeof fetch;

    await expect(requestAdminBucketPolicySuggestion(fetcher))
      .rejects.toThrow(/Admin authorization is required/);
  });
});
