import { describe, expect, it } from 'vitest';

import {
  ARC_MAINNET_EXECUTION_CONFIG,
  ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
} from '../config/arc-mainnet.js';
import type { AdminAiInput, SteakhouseMarketSnapshot } from './types.js';
import { analyzeMarketRisk } from './marketRiskAnalysis.js';

const timestamp = '1791011806';
const retrievedAt = new Date(Number(timestamp) * 1_000 + 10_000).toISOString();

function marketValue<T>(value: T, unit: string, source: 'ARC_MAINNET_RPC' | 'MORPHO_GRAPHQL' = 'MORPHO_GRAPHQL') {
  return { source, availability: 'AVAILABLE' as const, value, unit };
}

function missingMarketValue(unit: string) {
  return { source: 'UNAVAILABLE' as const, availability: 'UNAVAILABLE' as const, value: null, unit };
}

function createSnapshot(
  overrides: Partial<SteakhouseMarketSnapshot> = {},
): SteakhouseMarketSnapshot {
  return {
    source: 'MORPHO_GRAPHQL',
    status: 'PARTIAL',
    network: 'Arc Mainnet',
    chainId: 5042,
    assetAddress: ARC_MAINNET_EXECUTION_CONFIG.usdcAddress,
    vaultAddress: ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
    protocolName: 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2',
    protocolId: ARC_MAINNET_EXECUTION_CONFIG.protocolId,
    identityVerified: true,
    freshness: {
      status: 'CURRENT',
      blockNumber: '24012943',
      blockTimestamp: timestamp,
      retrievedAt,
      ageSeconds: 10,
      maximumAgeSeconds: 600,
      sourceHeadBlockNumber: '24012943',
      sourceHeadBlockTimestamp: timestamp,
    },
    vault: {
      totalAssets: marketValue('2585144861917', 'USDC_BASE_UNITS'),
      availableLiquidity: marketValue('1949748811823', 'USDC_BASE_UNITS'),
      idleLiquidity: marketValue('1949748811823', 'USDC_BASE_UNITS'),
      utilizationBps: missingMarketValue('BPS'),
      totalSupply: marketValue('2585144861917', 'SHARES'),
      apy: marketValue('0.0036463103898303384', 'RATIO'),
      netApy: marketValue('0.0036463103898303384', 'RATIO'),
      allocation: missingMarketValue('UNAVAILABLE'),
      depositAvailability: missingMarketValue('USDC_BASE_UNITS'),
      depositGateStatus: missingMarketValue('GATE_CONFIG'),
      timelock: missingMarketValue('SECONDS'),
      warnings: marketValue([] as readonly string[], 'NONE'),
    },
    underlyingMarket: {
      allocation: missingMarketValue('UNAVAILABLE'),
      liquidity: marketValue('453541207958', 'USDC_BASE_UNITS'),
      utilizationBps: marketValue(9976, 'BPS'),
      collateralExposure: missingMarketValue('COLLATERAL_BASE_UNITS'),
      lltv: missingMarketValue('WAD'),
      oracleStatus: missingMarketValue('ORACLE_IDENTITY'),
      badDebtStatus: marketValue('Morpho reports no bad debt (0 underlying base units).', 'MORPHO_BAD_DEBT_REPORT'),
      liquidationRisk: missingMarketValue('UNAVAILABLE'),
      warnings: marketValue([] as readonly string[], 'NONE'),
      marketId: marketValue(`0x${'1'.repeat(64)}`, 'MARKET_ID'),
      stateBlockNumber: marketValue('24012914', 'BLOCK'),
      stateTimestamp: marketValue(timestamp, 'UNIX_SECONDS'),
      collateralAssetAddress: missingMarketValue('ADDRESS'),
      collateralAssetDecimals: missingMarketValue('DECIMALS'),
    },
    unavailableData: [],
    ...overrides,
  };
}

function projection(snapshot: SteakhouseMarketSnapshot | undefined = createSnapshot()): AdminAiInput {
  const coreValue = <T>(value: T | null, unit: string, available = value !== null) => ({
    source: 'CORE',
    availability: available ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
    unit,
    zeroMeaning: available ? 'AUTHORITATIVE_ZERO' as const : 'UNAVAILABLE' as const,
    value: available ? value : null,
  });
  return {
    scope: 'ADMIN',
    authenticatedWalletAddress: '0x1111111111111111111111111111111111111111',
    chainId: 5042,
    coreAddress: ARC_MAINNET_EXECUTION_CONFIG.coreAddress,
    authorization: {
      policyAdmin: coreValue(true, 'BOOLEAN'),
      automation: coreValue(false, 'BOOLEAN'),
    },
    treasury: {
      totalUserLiabilities: coreValue(1_000_000n, 'USDC_BASE_UNITS'),
      liquidUSDC: coreValue(400_000n, 'USDC_BASE_UNITS'),
      requiredLiquidReserve: coreValue(100_000n, 'USDC_BASE_UNITS'),
      availableLiquidity: coreValue(300_000n, 'USDC_BASE_UNITS'),
      totalDeployed: coreValue(600_000n, 'USDC_BASE_UNITS'),
      totalManagedAssets: coreValue(1_000_000n, 'USDC_BASE_UNITS'),
      paused: coreValue(false, 'BOOLEAN'),
      blockNumber: coreValue(24012943n, 'BLOCK'),
    },
    riskPolicy: {
      minimumLiquidReserve: coreValue(100_000n, 'USDC_BASE_UNITS'),
      minimumLiquidReserveBps: coreValue(1_000, 'BPS'),
      maximumTotalDeployed: coreValue(800_000n, 'USDC_BASE_UNITS'),
    },
    bucketPolicy: {
      liquidOperationalReserveBps: coreValue(5_000n, 'BPS'),
      yieldStrategyBufferBps: coreValue(2_500n, 'BPS'),
      sweepLiquidityBufferBps: coreValue(1_500n, 'BPS'),
      automationAgentPoolBps: coreValue(1_000n, 'BPS'),
    },
    liquidBucketClassifications: coreValue([250_000n, 50_000n], 'USDC_BASE_UNITS'),
    yieldStrategyBufferCapacity: coreValue(200_000n, 'USDC_BASE_UNITS'),
    strategy: {
      approved: coreValue(true, 'BOOLEAN'),
      enabled: coreValue(true, 'BOOLEAN'),
      valuationStatusLabel: { source: 'API_DERIVED', availability: 'AVAILABLE', unit: 'NONE', zeroMeaning: 'NOT_APPLICABLE', value: 'current' },
      currentValue: coreValue(600_000n, 'USDC_BASE_UNITS'),
      absoluteCap: coreValue(800_000n, 'USDC_BASE_UNITS'),
      withdrawalShortfall: coreValue(0n, 'USDC_BASE_UNITS'),
    },
    marketRisk: snapshot,
  };
}

function arcOnlySnapshot(): SteakhouseMarketSnapshot {
  const current = createSnapshot();
  return {
    ...current,
    source: 'ARC_MAINNET_RPC',
    vault: {
      ...current.vault,
      totalAssets: marketValue('2585144861917', 'USDC_BASE_UNITS', 'ARC_MAINNET_RPC'),
      availableLiquidity: marketValue('1949748811823', 'USDC_BASE_UNITS', 'ARC_MAINNET_RPC'),
      apy: missingMarketValue('RATIO'),
      netApy: missingMarketValue('RATIO'),
    },
    underlyingMarket: {
      ...current.underlyingMarket,
      liquidity: missingMarketValue('USDC_BASE_UNITS'),
      utilizationBps: missingMarketValue('BPS'),
      badDebtStatus: missingMarketValue('MORPHO_BAD_DEBT_REPORT'),
      warnings: missingMarketValue('NONE'),
      marketId: missingMarketValue('MARKET_ID'),
    },
    unavailableData: ['Morpho observations unavailable.'],
  };
}

describe('deterministic market risk and allocation analysis', () => {
  it('analyzes complete verified market inputs without assigning allocation percentages', () => {
    const analysis = analyzeMarketRisk(projection());

    expect(analysis.status).toBe('ANALYZED');
    expect(analysis.findings.liquidityRisk.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'underlyingMarket.utilizationBps', value: 9976, source: 'MORPHO_GRAPHQL' }),
      expect.objectContaining({ field: 'vault.totalAssets', value: '2585144861917' }),
    ]));
    expect(analysis.findings.yieldOpportunity.signal).toBe('OPPORTUNITY_EVIDENCE');
    expect(analysis.allocationRanges.every(({ minimumBps, maximumBps }) =>
      minimumBps === 0 && maximumBps === 10_000)).toBe(true);
    expect(analysis.allocationRanges.every(({ boundBasis }) => boundBasis === 'DOMAIN_ONLY')).toBe(true);
    expect(analysis.allocationCompatibility).toEqual({
      totalBps: 10_000,
      compatible: true,
      status: 'COMPATIBLE',
    });
  });

  it('uses partial Morpho and valid Arc-provenance facts by field, without requiring Morpho', () => {
    const input = projection();
    const snapshot = input.marketRisk!;
    const combined: SteakhouseMarketSnapshot = {
      ...snapshot,
      source: 'MULTIPLE_VERIFIED_SOURCES',
      vault: {
        ...snapshot.vault,
        totalAssets: marketValue('2585144861917', 'USDC_BASE_UNITS', 'ARC_MAINNET_RPC'),
        availableLiquidity: marketValue('1949748811823', 'USDC_BASE_UNITS', 'ARC_MAINNET_RPC'),
        apy: snapshot.vault.apy,
      },
      underlyingMarket: {
        ...snapshot.underlyingMarket,
        utilizationBps: missingMarketValue('BPS'),
      },
    };
    const analysis = analyzeMarketRisk(projection(combined));

    expect(analysis.status).toBe('PARTIAL');
    expect(analysis.findings.yieldOpportunity.evidence[0]).toMatchObject({ source: 'MORPHO_GRAPHQL' });
    expect(analysis.findings.liquidityRisk.evidence[0]).toMatchObject({ source: 'ARC_MAINNET_RPC' });
    expect(analysis.findings.liquidityRisk.signal).toBe('THRESHOLD_UNCONFIGURED');
    expect(analysis.unavailableInputs).toContain('verified underlying-market utilization');
  });

  it('supports a valid Arc-only market snapshot with Morpho metrics unavailable', () => {
    const analysis = analyzeMarketRisk(projection(arcOnlySnapshot()));

    expect(analysis.status).toBe('PARTIAL');
    expect(analysis.findings.yieldOpportunity.signal).toBe('UNAVAILABLE');
    expect(analysis.findings.liquidityRisk.evidence[0]).toMatchObject({ source: 'ARC_MAINNET_RPC' });
    expect(analysis.unavailableInputs).toContain('verified vault APY');
    expect(analysis.unavailableInputs).toContain('verified underlying-market utilization');
  });

  it.each([
    ['APY', (snapshot: SteakhouseMarketSnapshot) => ({
      ...snapshot,
      vault: { ...snapshot.vault, apy: missingMarketValue('RATIO'), netApy: missingMarketValue('RATIO') },
    })],
    ['utilization', (snapshot: SteakhouseMarketSnapshot) => ({
      ...snapshot,
      underlyingMarket: { ...snapshot.underlyingMarket, utilizationBps: missingMarketValue('BPS') },
    })],
  ])('keeps missing %s explicitly unavailable', (_label, alter) => {
    const analysis = analyzeMarketRisk(projection(alter(createSnapshot())));
    const missingInput = _label === 'APY' ? 'verified vault APY' : 'verified underlying-market utilization';
    expect(analysis.unavailableInputs).toContain(missingInput);
    expect(analysis.allocationRanges.every(({ boundBasis }) => boundBasis === 'DOMAIN_ONLY')).toBe(true);
    if (_label === 'APY') {
      expect(analysis.findings.yieldOpportunity.signal).toBe('UNAVAILABLE');
      expect(analysis.findings.yieldOpportunity.evidence).toEqual([]);
    } else {
      expect(analysis.findings.liquidityRisk.evidence).not.toContainEqual(expect.objectContaining({
        field: 'underlyingMarket.utilizationBps',
      }));
    }
  });

  it('reports insufficient evidence when vault and underlying liquidity are missing', () => {
    const snapshot = createSnapshot();
    const noLiquidity: SteakhouseMarketSnapshot = {
      ...snapshot,
      vault: {
        ...snapshot.vault,
        availableLiquidity: missingMarketValue('USDC_BASE_UNITS'),
      },
      underlyingMarket: {
        ...snapshot.underlyingMarket,
        liquidity: missingMarketValue('USDC_BASE_UNITS'),
      },
    };
    const analysis = analyzeMarketRisk(projection(noLiquidity));
    expect(analysis.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(analysis.findings.liquidityRisk.signal).toBe('INSUFFICIENT_EVIDENCE');
    expect(analysis.unavailableInputs).toContain('verified vault or underlying-market liquidity');
  });

  it('does not use stale market observations', () => {
    const stale: SteakhouseMarketSnapshot = {
      ...createSnapshot(),
      freshness: { ...createSnapshot().freshness, status: 'STALE', ageSeconds: 601 },
    };
    const analysis = analyzeMarketRisk(projection(stale));
    expect(analysis.status).toBe('STALE_MARKET_DATA');
    expect(analysis.findings.yieldOpportunity.signal).toBe('UNAVAILABLE');
    expect(analysis.findings.liquidityRisk.signal).toBe('UNAVAILABLE');
  });

  it('rejects market identity mismatch without treating it as adverse market evidence', () => {
    const mismatched: SteakhouseMarketSnapshot = {
      ...createSnapshot(),
      vaultAddress: '0x3333333333333333333333333333333333333333',
    };
    const analysis = analyzeMarketRisk(projection(mismatched));
    expect(analysis.status).toBe('INVALID_MARKET_IDENTITY');
    expect(analysis.findings.liquidityRisk.signal).toBe('UNAVAILABLE');
    expect(analysis.findings.liquidityRisk.evidence.every(({ availability }) => availability === 'UNAVAILABLE')).toBe(true);
  });

  it('keeps market findings unchanged when Core constraint inputs are unavailable', () => {
    const input = projection();
    const withoutCoreLimits: AdminAiInput = {
      ...input,
      treasury: {
        ...input.treasury,
        requiredLiquidReserve: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'UNAVAILABLE', value: null },
      },
      riskPolicy: undefined,
      bucketPolicy: undefined,
      coreExecutionConstraints: undefined,
    };
    const withLimits = analyzeMarketRisk(input);
    const withoutLimits = analyzeMarketRisk(withoutCoreLimits);

    expect(withoutLimits.findings.liquidityRisk).toEqual(withLimits.findings.liquidityRisk);
    expect(withoutLimits.findings.yieldOpportunity).toEqual(withLimits.findings.yieldOpportunity);
    expect(withoutLimits.findings.withdrawalLiquidityPressure).toEqual(withLimits.findings.withdrawalLiquidityPressure);
  });

  it('flags high utilization only against an explicit configured threshold', () => {
    const high = analyzeMarketRisk(projection(), { thresholds: { highUtilizationBps: 9_500 } });
    const unconfigured = analyzeMarketRisk(projection());

    expect(high.findings.liquidityRisk.signal).toBe('ADVERSE_EVIDENCE');
    expect(high.findings.liquidityRisk.threshold).toEqual({
      value: 9_500,
      unit: 'UTILIZATION_BPS',
      status: 'CONFIGURED',
    });
    expect(unconfigured.findings.liquidityRisk.signal).toBe('THRESHOLD_UNCONFIGURED');
  });

  it('flags low available liquidity only against an explicit configured threshold', () => {
    const snapshot = createSnapshot();
    const lowLiquidity: SteakhouseMarketSnapshot = {
      ...snapshot,
      vault: {
        ...snapshot.vault,
        totalAssets: marketValue('1000000', 'USDC_BASE_UNITS'),
        availableLiquidity: marketValue('50000', 'USDC_BASE_UNITS'),
      },
    };
    const analysis = analyzeMarketRisk(projection(lowLiquidity), {
      thresholds: { lowLiquidityRatioBps: 1_000 },
    });
    expect(analysis.findings.liquidityRisk.signal).toBe('ADVERSE_EVIDENCE');
    expect(analysis.findings.liquidityRisk.evidence).toContainEqual(expect.objectContaining({
      field: 'vault.availableLiquidity',
      value: '50000',
    }));
  });

  it('reports verified positive APY as opportunity evidence without deriving an allocation', () => {
    const analysis = analyzeMarketRisk(projection());
    expect(analysis.findings.yieldOpportunity.signal).toBe('OPPORTUNITY_EVIDENCE');
    expect(analysis.findings.yieldOpportunity.evidence).toContainEqual(expect.objectContaining({
      field: 'vault.apy',
      value: '0.0036463103898303384',
    }));
    expect(analysis.allocationRanges.find(({ id }) => id === 'yieldStrategyBuffer')).toMatchObject({
      minimumBps: 0,
      maximumBps: 10_000,
      boundBasis: 'DOMAIN_ONLY',
    });
  });

  it('marks sweep need and automation allocation justification unavailable when only capacity/demand are missing', () => {
    const analysis = analyzeMarketRisk(projection());
    expect(analysis.findings.sweepLiquidity.signal).toBe('NO_ADVERSE_EVIDENCE_REPORTED');
    expect(analysis.findings.automationPool.missingInputs).toContain('verified automation-pool capacity or demand');
    expect(analysis.unavailableInputs).toContain('verified automation-pool capacity or demand');
  });

  it('reports insufficient evidence while preserving domain-valid allocation ranges', () => {
    const analysis = analyzeMarketRisk({ ...projection(), marketRisk: undefined });
    expect(analysis.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(analysis.confidence).toBe('UNAVAILABLE');
    expect(analysis.allocationCompatibility.compatible).toBe(true);
    expect(analysis.allocationRanges).toHaveLength(4);
  });

  it('is deterministic for repeated identical inputs', () => {
    const input = projection();
    const options = { thresholds: { highUtilizationBps: 9_500 } };
    expect(analyzeMarketRisk(input, options)).toEqual(analyzeMarketRisk(input, options));
  });

  it('allows evidence-configured zero allocations and verifies exactly 10,000 BPS compatibility', () => {
    const analysis = analyzeMarketRisk(projection(), {
      allocationBounds: {
        liquidOperationalReserve: { minimumBps: 0, maximumBps: 10_000 },
        yieldStrategyBuffer: { minimumBps: 0, maximumBps: 0 },
        sweepLiquidityBuffer: { minimumBps: 0, maximumBps: 10_000 },
        automationAgentPool: { minimumBps: 0, maximumBps: 10_000 },
      },
    });
    expect(analysis.allocationRanges.find(({ id }) => id === 'yieldStrategyBuffer')).toMatchObject({
      minimumBps: 0,
      maximumBps: 0,
      boundBasis: 'CONFIGURED',
    });
    expect(analysis.allocationCompatibility).toEqual({
      totalBps: 10_000,
      compatible: true,
      status: 'COMPATIBLE',
    });
  });

  it('marks impossible configured ranges incompatible rather than silently adjusting them', () => {
    const analysis = analyzeMarketRisk(projection(), {
      allocationBounds: {
        liquidOperationalReserve: { minimumBps: 6_000, maximumBps: 6_000 },
        yieldStrategyBuffer: { minimumBps: 5_000, maximumBps: 5_000 },
        sweepLiquidityBuffer: { minimumBps: 0, maximumBps: 0 },
        automationAgentPool: { minimumBps: 0, maximumBps: 0 },
      },
    });
    expect(analysis.allocationCompatibility).toEqual({
      totalBps: 10_000,
      compatible: false,
      status: 'INCOMPATIBLE',
    });
  });
});
