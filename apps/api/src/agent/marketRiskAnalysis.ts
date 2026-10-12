import {
  ARC_MAINNET_EXECUTION_CONFIG,
  ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
} from '../config/arc-mainnet.js';
import type {
  AdminAiInput,
  BucketAllocationRange,
  BucketPolicyAllocationId,
  MarketAnalysisEvidence,
  MarketAnalysisFinding,
  MarketRiskAnalysis,
  SteakhouseMarketSnapshot,
  VerifiedMarketValue,
} from './types.js';

const BASIS_POINTS = 10_000;

const BUCKET_IDS: readonly BucketPolicyAllocationId[] = [
  'liquidOperationalReserve',
  'yieldStrategyBuffer',
  'sweepLiquidityBuffer',
  'automationAgentPool',
];

export interface MarketRiskAnalysisOptions {
  readonly thresholds?: {
    readonly highUtilizationBps?: number;
    readonly lowLiquidityRatioBps?: number;
    readonly highWithdrawalPressureBps?: number;
  };
  readonly allocationBounds?: Partial<Record<
    BucketPolicyAllocationId,
    { readonly minimumBps: number; readonly maximumBps: number }
  >>;
}

interface Observation<T> {
  readonly source: string;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly value: T | null;
  readonly unit: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function observation<T>(value: unknown): Observation<T> {
  const record = asRecord(value);
  if (!record || typeof record.availability !== 'string') {
    return { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE' };
  }
  const available = record.availability === 'AVAILABLE'
    && record.value !== null
    && record.value !== undefined;
  return {
    source: typeof record.source === 'string' ? record.source : 'UNAVAILABLE',
    availability: available ? 'AVAILABLE' : 'UNAVAILABLE',
    value: available ? record.value as T : null,
    unit: typeof record.unit === 'string' ? record.unit : 'UNAVAILABLE',
  };
}

function integer(value: unknown): bigint | null {
  if (typeof value !== 'bigint' && typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function finiteRatio(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scalar(value: unknown): MarketAnalysisEvidence['value'] {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value;
  return null;
}

function evidence(
  field: string,
  item: Observation<unknown>,
  freshness: SteakhouseMarketSnapshot['freshness']['status'],
): MarketAnalysisEvidence {
  return {
    field,
    source: item.source,
    availability: item.availability,
    value: scalar(item.value),
    unit: item.unit,
    freshness,
  };
}

function coreEvidence(
  field: string,
  item: Observation<unknown>,
  freshness: 'CURRENT' | 'UNAVAILABLE',
): MarketAnalysisEvidence {
  return evidence(field, item, freshness);
}

function finding(
  signal: MarketAnalysisFinding['signal'],
  summary: string,
  items: readonly MarketAnalysisEvidence[],
  missingInputs: readonly string[] = [],
  threshold?: MarketAnalysisFinding['threshold'],
): MarketAnalysisFinding {
  return { signal, summary, evidence: items, missingInputs, ...(threshold ? { threshold } : {}) };
}

function configuredThreshold(value: number | undefined, name: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > BASIS_POINTS) {
    throw new Error(`${name} must be an integer between 0 and 10,000 BPS.`);
  }
  return value;
}

function verifiedMarketIdentity(snapshot: SteakhouseMarketSnapshot): boolean {
  return snapshot.chainId === ARC_MAINNET_EXECUTION_CONFIG.chainId
    && snapshot.network === 'Arc Mainnet'
    && snapshot.identityVerified
    && snapshot.assetAddress.toLowerCase() === ARC_MAINNET_EXECUTION_CONFIG.usdcAddress.toLowerCase()
    && snapshot.vaultAddress.toLowerCase() === ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS.toLowerCase()
    && snapshot.protocolId.toLowerCase() === ARC_MAINNET_EXECUTION_CONFIG.protocolId.toLowerCase()
    && ['ARC_MAINNET_RPC', 'MORPHO_GRAPHQL', 'MULTIPLE_VERIFIED_SOURCES'].includes(snapshot.source);
}

function marketFreshness(snapshot: SteakhouseMarketSnapshot): 'CURRENT' | 'STALE' | 'UNAVAILABLE' {
  const freshness = snapshot.freshness;
  if (freshness.status !== 'CURRENT'
    || freshness.ageSeconds === null
    || !Number.isSafeInteger(freshness.ageSeconds)
    || freshness.ageSeconds < 0
    || !Number.isSafeInteger(freshness.maximumAgeSeconds)
    || freshness.maximumAgeSeconds <= 0
    || freshness.ageSeconds > freshness.maximumAgeSeconds
    || !Number.isFinite(Date.parse(freshness.retrievedAt))
    || !/^\d+$/.test(freshness.blockNumber ?? '')
    || !/^\d+$/.test(freshness.blockTimestamp ?? '')
    || !/^\d+$/.test(freshness.sourceHeadBlockNumber ?? '')
    || !/^\d+$/.test(freshness.sourceHeadBlockTimestamp ?? '')) {
    return freshness.status === 'STALE' || (freshness.ageSeconds !== null
      && freshness.ageSeconds > freshness.maximumAgeSeconds)
      ? 'STALE'
      : 'UNAVAILABLE';
  }
  return 'CURRENT';
}

function allocationRanges(
  bounds: MarketRiskAnalysisOptions['allocationBounds'],
): { readonly ranges: readonly BucketAllocationRange[]; readonly compatible: boolean } {
  const ranges = BUCKET_IDS.map((id): BucketAllocationRange => {
    const configured = bounds?.[id];
    if (!configured) return { id, minimumBps: 0, maximumBps: BASIS_POINTS, boundBasis: 'DOMAIN_ONLY' };
    const { minimumBps, maximumBps } = configured;
    if (!Number.isSafeInteger(minimumBps) || !Number.isSafeInteger(maximumBps)
      || minimumBps < 0 || maximumBps > BASIS_POINTS || minimumBps > maximumBps) {
      throw new Error(`Allocation bounds for ${id} must satisfy 0 <= minimumBps <= maximumBps <= 10,000.`);
    }
    return { id, minimumBps, maximumBps, boundBasis: 'CONFIGURED' };
  });
  const minimumTotal = ranges.reduce((sum, range) => sum + range.minimumBps, 0);
  const maximumTotal = ranges.reduce((sum, range) => sum + range.maximumBps, 0);
  return { ranges, compatible: minimumTotal <= BASIS_POINTS && maximumTotal >= BASIS_POINTS };
}

function projectionObservation(value: unknown): Observation<unknown> {
  const result = observation<unknown>(value);
  return {
    ...result,
    source: result.availability === 'AVAILABLE' ? result.source : 'UNAVAILABLE',
    unit: result.unit === 'UNAVAILABLE' ? 'UNAVAILABLE' : result.unit,
  };
}

function unavailableFinding(field: string, summary: string): MarketAnalysisFinding {
  return finding('UNAVAILABLE', summary, [], [field]);
}

export function analyzeMarketRisk(
  projection: AdminAiInput,
  options: MarketRiskAnalysisOptions = {},
): MarketRiskAnalysis {
  const highUtilizationBps = configuredThreshold(options.thresholds?.highUtilizationBps, 'highUtilizationBps');
  const lowLiquidityRatioBps = configuredThreshold(options.thresholds?.lowLiquidityRatioBps, 'lowLiquidityRatioBps');
  const highWithdrawalPressureBps = configuredThreshold(
    options.thresholds?.highWithdrawalPressureBps,
    'highWithdrawalPressureBps',
  );
  const configuredThresholds = {
    highUtilizationBps,
    lowLiquidityRatioBps,
    highWithdrawalPressureBps,
  };
  const ranges = allocationRanges(options.allocationBounds);
  const snapshot = projection.marketRisk;
  const coreBlock = observation<unknown>(projection.treasury.blockNumber);
  const coreFreshness = integer(coreBlock.value) !== null ? 'CURRENT' : 'UNAVAILABLE';
  const unavailableInputs = new Set<string>();

  const snapshotFreshness = snapshot ? marketFreshness(snapshot) : 'UNAVAILABLE';
  const identityValid = snapshot ? verifiedMarketIdentity(snapshot) : false;
  const validSnapshot = Boolean(snapshot && snapshot.status === 'PARTIAL' && identityValid && snapshotFreshness === 'CURRENT');
  if (!snapshot) unavailableInputs.add('verified market snapshot');
  if (snapshot && !identityValid) unavailableInputs.add('configured Arc market identity');
  if (snapshot && snapshotFreshness !== 'CURRENT') unavailableInputs.add('current market snapshot freshness');

  const absentMarket = (): Observation<unknown> => ({
    source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE',
  });
  const marketObservation = <T>(item: VerifiedMarketValue<T> | undefined): Observation<T> => {
    if (!validSnapshot || !item
      || item.availability !== 'AVAILABLE'
      || !['ARC_MAINNET_RPC', 'MORPHO_GRAPHQL'].includes(item.source)
      || item.value === null) return absentMarket() as Observation<T>;
    return { source: item.source, availability: 'AVAILABLE', value: item.value, unit: item.unit };
  };
  const snapshotEvidence = <T>(field: string, item: Observation<T>) =>
    evidence(field, item as Observation<unknown>, snapshotFreshness);

  const totalAssets = marketObservation(snapshot?.vault.totalAssets);
  const vaultLiquidity = marketObservation(snapshot?.vault.availableLiquidity);
  const idleLiquidity = marketObservation(snapshot?.vault.idleLiquidity);
  const underlyingLiquidity = marketObservation(snapshot?.underlyingMarket.liquidity);
  const apy = marketObservation(snapshot?.vault.apy);
  const netApy = marketObservation(snapshot?.vault.netApy);
  const utilization = marketObservation(snapshot?.underlyingMarket.utilizationBps);
  const vaultWarnings = marketObservation(snapshot?.vault.warnings);
  const marketWarnings = marketObservation(snapshot?.underlyingMarket.warnings);
  const badDebt = marketObservation(snapshot?.underlyingMarket.badDebtStatus);
  const liquidationRisk = marketObservation(snapshot?.underlyingMarket.liquidationRisk);

  const totalAssetsValue = integer(totalAssets.value);
  const vaultLiquidityValue = integer(vaultLiquidity.value);
  const underlyingLiquidityValue = integer(underlyingLiquidity.value);
  const utilizationValue = typeof utilization.value === 'number'
    && Number.isSafeInteger(utilization.value)
    && utilization.value >= 0
    && utilization.value <= BASIS_POINTS
    ? utilization.value
    : null;
  const liquidityValue = vaultLiquidityValue ?? underlyingLiquidityValue;
  const liquidityEvidence = vaultLiquidityValue !== null
    ? snapshotEvidence('vault.availableLiquidity', vaultLiquidity)
    : snapshotEvidence('underlyingMarket.liquidity', underlyingLiquidity);
  const liquidityRatioBps = totalAssetsValue !== null
    && totalAssetsValue > 0n
    && vaultLiquidityValue !== null
    ? Number(vaultLiquidityValue * BigInt(BASIS_POINTS) / totalAssetsValue)
    : null;

  if (totalAssetsValue === null) unavailableInputs.add('verified vault totalAssets');
  if (liquidityValue === null) unavailableInputs.add('verified vault or underlying-market liquidity');
  if (apy.availability !== 'AVAILABLE') unavailableInputs.add('verified vault APY');
  if (utilization.availability !== 'AVAILABLE') unavailableInputs.add('verified underlying-market utilization');

  const liquidityEvidenceSet = [
    snapshotEvidence('vault.totalAssets', totalAssets),
    liquidityEvidence,
    ...(idleLiquidity.availability === 'AVAILABLE' ? [snapshotEvidence('vault.idleLiquidity', idleLiquidity)] : []),
    ...(liquidityRatioBps === null ? [] : [snapshotEvidence('derived.vaultLiquidityRatioBps', {
      source: 'API_DERIVED',
      availability: 'AVAILABLE',
      value: liquidityRatioBps,
      unit: 'BPS',
    })]),
    ...(utilizationValue === null ? [] : [snapshotEvidence('underlyingMarket.utilizationBps', utilization)]),
    ...(vaultWarnings.availability === 'AVAILABLE' ? [snapshotEvidence('vault.warnings', vaultWarnings)] : []),
    ...(marketWarnings.availability === 'AVAILABLE' ? [snapshotEvidence('underlyingMarket.warnings', marketWarnings)] : []),
    ...(badDebt.availability === 'AVAILABLE' ? [snapshotEvidence('underlyingMarket.badDebtStatus', badDebt)] : []),
    ...(liquidationRisk.availability === 'AVAILABLE' ? [snapshotEvidence('underlyingMarket.liquidationRisk', liquidationRisk)] : []),
  ];
  const adverseWarnings = [vaultWarnings, marketWarnings].some((item) =>
    item.availability === 'AVAILABLE'
    && Array.isArray(item.value)
    && item.value.some((warning) => /\b(high|critical|severe|error|impaired|bad debt)\b/i.test(warning)),
  );
  const badDebtReported = badDebt.availability === 'AVAILABLE'
    && typeof badDebt.value === 'string'
    && !/no bad debt|zero bad debt|bad debt.{0,20}\b0\b/i.test(badDebt.value);
  const liquidityThresholdHit = (lowLiquidityRatioBps !== null
      && liquidityRatioBps !== null
      && liquidityRatioBps <= lowLiquidityRatioBps)
    || (highUtilizationBps !== null
      && utilizationValue !== null
      && utilizationValue >= highUtilizationBps);
  const liquidityRiskSignal: MarketAnalysisFinding['signal'] = !validSnapshot
    ? 'UNAVAILABLE'
    : totalAssetsValue === null || liquidityValue === null
      ? 'INSUFFICIENT_EVIDENCE'
      : adverseWarnings || badDebtReported || liquidityThresholdHit
        ? 'ADVERSE_EVIDENCE'
        : lowLiquidityRatioBps === null && highUtilizationBps === null
          ? 'THRESHOLD_UNCONFIGURED'
          : 'NO_ADVERSE_EVIDENCE_REPORTED';
  const liquidityRisk = finding(
    liquidityRiskSignal,
    liquidityRiskSignal === 'THRESHOLD_UNCONFIGURED'
      ? 'Verified liquidity observations are present; project thresholds are not configured, so a categorical liquidity-risk score is unavailable.'
      : liquidityRiskSignal === 'ADVERSE_EVIDENCE'
        ? 'Verified adverse market warnings, reported bad debt, or configured liquidity thresholds indicate adverse liquidity evidence.'
        : 'Liquidity observations are reported without a configured adverse signal.',
    liquidityEvidenceSet,
    [
      ...(totalAssetsValue === null ? ['vault.totalAssets'] : []),
      ...(liquidityValue === null ? ['vault or underlying-market liquidity'] : []),
      ...(utilizationValue === null ? ['underlying-market utilization'] : []),
    ],
    {
      value: lowLiquidityRatioBps ?? highUtilizationBps,
      unit: lowLiquidityRatioBps !== null ? 'LIQUIDITY_RATIO_BPS' : 'UTILIZATION_BPS',
      status: lowLiquidityRatioBps !== null || highUtilizationBps !== null ? 'CONFIGURED' : 'UNAVAILABLE',
    },
  );

  const apyValue = apy.availability === 'AVAILABLE' ? finiteRatio(apy.value) : null;
  const netApyValue = netApy.availability === 'AVAILABLE' ? finiteRatio(netApy.value) : null;
  const yieldOpportunity = !validSnapshot || (apyValue === null && netApyValue === null)
    ? unavailableFinding('vault APY/net APY', 'A verified yield opportunity cannot be assessed without a verified APY observation.')
    : finding(
        (netApyValue ?? apyValue)! > 0 ? 'OPPORTUNITY_EVIDENCE' : 'NO_ADVERSE_EVIDENCE_REPORTED',
        (netApyValue ?? apyValue)! > 0
          ? 'A positive verified vault APY observation is present; this is not a forecast or a recommendation to deploy.'
          : 'Verified vault APY does not show a positive yield opportunity.',
        [
          ...(apy.availability === 'AVAILABLE' ? [snapshotEvidence('vault.apy', apy)] : []),
          ...(netApy.availability === 'AVAILABLE' ? [snapshotEvidence('vault.netApy', netApy)] : []),
        ],
        [],
      );

  const strategy = asRecord(projection.strategy);
  const strategyValue = (field: string) => projectionObservation(strategy?.[field]);
  const strategyValuation = strategyValue('valuationStatusLabel');
  const strategyShortfall = strategyValue('withdrawalShortfall');
  const strategyValueObs = strategyValue('currentValue');
  const strategyFields = [
    ['strategy.valuationStatusLabel', strategyValuation],
    ['strategy.withdrawalShortfall', strategyShortfall],
    ['strategy.currentValue', strategyValueObs],
    ['strategy.principal', strategyValue('principal')],
    ['strategy.realizedYield', strategyValue('realizedYield')],
    ['strategy.realizedLoss', strategyValue('realizedLoss')],
    ['strategy.unrealizedYield', strategyValue('unrealizedYield')],
    ['strategy.unrealizedLoss', strategyValue('unrealizedLoss')],
    ['strategy.totalPnl', strategyValue('totalPnl')],
    ['strategy.protocolExposure', strategyValue('protocolExposure')],
    ['strategy.assetExposure', strategyValue('assetExposure')],
  ] as const;
  const strategyRiskEvidence = strategyFields
    .map(([field, item]) => coreEvidence(field, item, coreFreshness))
    .filter((item) => item.availability === 'AVAILABLE');
  const valuationStatus = typeof strategyValuation.value === 'string' ? strategyValuation.value.toLowerCase() : '';
  const strategyRisk = strategyRiskEvidence.length === 0
    ? unavailableFinding('configured strategy market-risk evidence', 'Configured strategy valuation, performance, position, and withdrawal-risk observations are unavailable.')
    : finding(
        valuationStatus === 'impaired' || valuationStatus === 'stale'
          || integer(strategyShortfall.value) !== null && integer(strategyShortfall.value)! > 0n
          ? 'ADVERSE_EVIDENCE'
          : strategyValuation.availability === 'AVAILABLE'
            ? 'NO_ADVERSE_EVIDENCE_REPORTED'
            : 'INSUFFICIENT_EVIDENCE',
        'Only verified configured-strategy valuation, performance, position, exposure, and withdrawal-shortfall facts are included; Core approval, enablement, and cap constraints are excluded from market-risk scoring.',
        strategyRiskEvidence,
        [
          ...(strategyValuation.availability === 'UNAVAILABLE' ? ['strategy valuation status'] : []),
        ],
      );

  const userLiabilities = observation<unknown>(projection.treasury.totalUserLiabilities);
  const coreLiquid = observation<unknown>(projection.treasury.liquidUSDC);
  const treasuryAvailable = observation<unknown>(projection.treasury.availableLiquidity);
  const userLiabilitiesValue = integer(userLiabilities.value);
  const coreLiquidValue = integer(coreLiquid.value);
  const withdrawalGap = userLiabilitiesValue !== null && coreLiquidValue !== null
    ? (userLiabilitiesValue > coreLiquidValue ? userLiabilitiesValue - coreLiquidValue : 0n)
    : null;
  const withdrawalPressureBps = userLiabilitiesValue !== null
    && userLiabilitiesValue > 0n
    && coreLiquidValue !== null
    ? Number((withdrawalGap! * BigInt(BASIS_POINTS) + userLiabilitiesValue - 1n) / userLiabilitiesValue)
    : null;
  if (withdrawalGap === null) unavailableInputs.add('verified Core liquidUSDC and totalUserLiabilities');
  const withdrawalEvidence = [
    coreEvidence('treasury.liquidUSDC', coreLiquid, coreFreshness),
    coreEvidence('treasury.totalUserLiabilities', userLiabilities, coreFreshness),
    coreEvidence('treasury.availableLiquidity', treasuryAvailable, coreFreshness),
    coreEvidence('treasury.totalDeployed', observation(projection.treasury.totalDeployed), coreFreshness),
    coreEvidence('treasury.totalManagedAssets', observation(projection.treasury.totalManagedAssets), coreFreshness),
    ...(withdrawalGap === null ? [] : [coreEvidence('derived.reserveCoverageGapBaseUnits', {
      source: 'API_DERIVED',
      availability: 'AVAILABLE',
      value: withdrawalGap,
      unit: 'USDC_BASE_UNITS',
    }, coreFreshness)]),
    ...(withdrawalPressureBps === null ? [] : [coreEvidence('derived.reserveGapRatioBps', {
      source: 'API_DERIVED',
      availability: 'AVAILABLE',
      value: withdrawalPressureBps,
      unit: 'BPS',
    }, coreFreshness)]),
  ];
  const withdrawalSignal = withdrawalGap === null
    ? 'UNAVAILABLE'
    : withdrawalGap > 0n
      ? 'ADVERSE_EVIDENCE'
      : highWithdrawalPressureBps === null
        ? 'THRESHOLD_UNCONFIGURED'
        : 'NO_ADVERSE_EVIDENCE_REPORTED';
  const withdrawalLiquidityPressure = finding(
    withdrawalSignal,
    withdrawalGap === null
      ? 'Withdrawal-liquidity coverage cannot be calculated because verified Core liquidUSDC or totalUserLiabilities is unavailable.'
      : withdrawalGap > 0n
        ? `Core liquidUSDC is below totalUserLiabilities by ${withdrawalGap.toString()} base units.`
        : 'Verified Core liquidUSDC meets or exceeds totalUserLiabilities.',
    withdrawalEvidence,
    withdrawalGap === null ? ['liquidUSDC', 'totalUserLiabilities'] : [],
    {
      value: highWithdrawalPressureBps,
      unit: 'RESERVE_GAP_RATIO_BPS',
      status: highWithdrawalPressureBps === null ? 'UNAVAILABLE' : 'CONFIGURED',
    },
  );

  const classifications = observation<unknown>(projection.liquidBucketClassifications);
  const classificationValues = Array.isArray(classifications.value)
    ? classifications.value.map(integer)
    : null;
  const sweepAmount = classificationValues && classificationValues.length >= 2
    ? classificationValues[1]
    : null;
  const sweepLiquidity = sweepAmount === null
    ? unavailableFinding('liquidBucketClassifications.sweepLiquidityBuffer', 'Verified existing sweep-liquidity classification is unavailable; future sweep demand is not inferred.')
    : finding(
        'NO_ADVERSE_EVIDENCE_REPORTED',
        'An existing on-chain amount is explicitly classified as Sweep Liquidity Buffer; it does not establish additional future sweep demand.',
        [coreEvidence('liquidBucketClassifications.sweepLiquidityBuffer', {
          ...classifications,
          value: sweepAmount,
        }, coreFreshness)],
      );
  if (sweepAmount === null) unavailableInputs.add('verified sweep-liquidity classification or demand');

  const automationAuth = observation<unknown>(projection.authorization.automation);
  const automationPool = automationAuth.availability === 'AVAILABLE'
    ? finding(
        automationAuth.value === true ? 'OPPORTUNITY_EVIDENCE' : 'NO_ADVERSE_EVIDENCE_REPORTED',
        automationAuth.value === true
          ? 'Automation role is verified for the authenticated Admin; this does not establish a separate agent-pool capacity or demand.'
          : 'Automation role is not verified for the authenticated Admin; system-wide agent-pool demand/capacity is not established.',
        [coreEvidence('authorization.automation', automationAuth, coreFreshness)],
        ['verified automation-pool capacity or demand'],
      )
    : unavailableFinding('automation authorization and pool capacity/demand', 'Automation authorization and a verified agent-pool capacity or demand measure are unavailable.');
  if (automationAuth.availability !== 'AVAILABLE') unavailableInputs.add('automation authorization');
  unavailableInputs.add('verified automation-pool capacity or demand');

  const marketEvidenceCount = [
    totalAssets.availability,
    vaultLiquidity.availability,
    underlyingLiquidity.availability,
    apy.availability,
    utilization.availability,
  ].filter((availability) => availability === 'AVAILABLE').length;
  const requiredMarketFactsAvailable = totalAssetsValue !== null && liquidityValue !== null;
  const status: MarketRiskAnalysis['status'] = snapshot && !identityValid
    ? 'INVALID_MARKET_IDENTITY'
    : snapshot && snapshotFreshness !== 'CURRENT'
      ? snapshotFreshness === 'STALE' ? 'STALE_MARKET_DATA' : 'INSUFFICIENT_EVIDENCE'
      : !requiredMarketFactsAvailable
        ? 'INSUFFICIENT_EVIDENCE'
        : marketEvidenceCount === 5 ? 'ANALYZED' : 'PARTIAL';
  const confidence: MarketRiskAnalysis['confidence'] = status === 'ANALYZED'
    ? 'HIGH'
    : status === 'PARTIAL'
      ? 'MEDIUM'
      : 'UNAVAILABLE';

  return {
    status,
    confidence,
    sourceFreshness: snapshot?.freshness ?? {
      status: 'UNAVAILABLE',
      blockNumber: null,
      blockTimestamp: null,
      retrievedAt: '',
      ageSeconds: null,
      maximumAgeSeconds: 0,
      sourceHeadBlockNumber: null,
      sourceHeadBlockTimestamp: null,
    },
    findings: {
      liquidityRisk,
      yieldOpportunity,
      strategyProtocolRisk: strategyRisk,
      withdrawalLiquidityPressure,
      sweepLiquidity,
      automationPool,
    },
    allocationRanges: ranges.ranges,
    allocationCompatibility: {
      totalBps: BASIS_POINTS,
      compatible: ranges.compatible,
      status: ranges.compatible ? 'COMPATIBLE' : 'INCOMPATIBLE',
    },
    unavailableInputs: [...unavailableInputs],
    configuredThresholds,
  };
}
