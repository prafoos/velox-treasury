export type BucketPolicyAllocationId =
  | 'liquidOperationalReserve'
  | 'yieldStrategyBuffer'
  | 'sweepLiquidityBuffer'
  | 'automationAgentPool';

export interface AdminBucketPolicySuggestion {
  readonly advisoryLabel: 'AI recommendation — Admin review required.';
  readonly recommendationStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'INSUFFICIENT_VERIFIED_DATA' | 'REQUIRES_ADMIN_ADJUSTMENT' | 'CORE_CONSTRAINTS_UNAVAILABLE';
  readonly marketDataStatus: 'PARTIAL' | 'UNAVAILABLE';
  readonly marketData: {
    readonly source: 'ARC_MAINNET_RPC' | 'MORPHO_GRAPHQL' | 'MULTIPLE_VERIFIED_SOURCES' | 'UNAVAILABLE';
    readonly network: 'Arc Mainnet';
    readonly chainId: 5042;
    readonly assetAddress: string;
    readonly vaultAddress: string;
    readonly protocolName: 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2';
    readonly protocolId: string;
    readonly identityVerified: boolean;
    readonly freshness: {
      readonly status: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
      readonly blockNumber: string | null;
      readonly blockTimestamp: string | null;
      readonly retrievedAt: string;
      readonly ageSeconds: number | null;
      readonly maximumAgeSeconds: number;
      readonly sourceHeadBlockNumber?: string | null;
      readonly sourceHeadBlockTimestamp?: string | null;
    };
    readonly vault: {
      readonly totalAssets: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly availableLiquidity: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly idleLiquidity: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly utilizationBps: { readonly source: string; readonly availability: string; readonly value: number | null; readonly unit: string };
      readonly totalSupply: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly apy: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly netApy: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly allocation: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly depositAvailability: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly depositGateStatus: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly timelock: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly warnings: { readonly source: string; readonly availability: string; readonly value: readonly string[] | null; readonly unit: string };
    };
    readonly underlyingMarket: {
      readonly allocation: { readonly availability: string; readonly value: string | null };
      readonly liquidity: { readonly availability: string; readonly value: string | null };
      readonly utilizationBps: { readonly availability: string; readonly value: number | null };
      readonly collateralExposure: { readonly availability: string; readonly value: string | null };
      readonly lltv: { readonly availability: string; readonly value: string | null };
      readonly oracleStatus: { readonly availability: string; readonly value: string | null };
      readonly badDebtStatus: { readonly availability: string; readonly value: string | null };
      readonly liquidationRisk: { readonly availability: string; readonly value: string | null };
      readonly warnings: { readonly availability: string; readonly value: readonly string[] | null };
      readonly marketId?: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly stateBlockNumber?: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly stateTimestamp?: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly collateralAssetAddress?: { readonly source: string; readonly availability: string; readonly value: string | null; readonly unit: string };
      readonly collateralAssetDecimals?: { readonly source: string; readonly availability: string; readonly value: number | null; readonly unit: string };
    };
    readonly unavailableData: readonly string[];
    readonly reason?: string;
  } | null;
  readonly veloxFacts: {
    readonly treasury: Record<string, unknown>;
    readonly riskPolicy?: Record<string, unknown>;
    readonly currentBucketPolicy: unknown;
    readonly strategy: unknown;
    readonly coreExecutionConstraints?: Record<string, unknown>;
  };
  readonly coreConstraints: {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE';
    readonly maximumYieldStrategyBufferBps: number | null;
    readonly minimumLiquidOperationalReserveBps: number | null;
    readonly reason?: string;
  };
  readonly bucketPolicyValidation: {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE';
    readonly exceededBuckets: readonly BucketPolicyAllocationId[];
  };
  readonly allocations: readonly {
    readonly id: BucketPolicyAllocationId;
    readonly name: string;
    readonly percentage: string;
    readonly bps: number;
    readonly reasoning: string;
  }[];
  readonly totalPercentage: '100%' | null;
  readonly totalBps: 10_000 | null;
  readonly missingVerifiedData: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly keyRiskAssumptions: readonly string[];
  readonly unavailableData: readonly string[];
  readonly executionStatus: 'NOT_EXECUTABLE';
  readonly lineage?: {
    readonly model: string | null;
    readonly generatedAt: string;
    readonly evidenceSnapshotId: string;
    readonly rawGeminiResponse: string | null;
    readonly evidenceSnapshot: unknown;
  };
  readonly lifecycle?: {
    readonly disposition: 'GENERATED' | 'ACTIVE_EXISTING' | 'REGENERATED';
    readonly evidenceStatus: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
  };
}

const BUCKETS: readonly { readonly id: BucketPolicyAllocationId; readonly name: string }[] = [
  { id: 'liquidOperationalReserve', name: 'Liquid Operational Reserve' },
  { id: 'yieldStrategyBuffer', name: 'Yield Strategy Buffer' },
  { id: 'sweepLiquidityBuffer', name: 'Sweep Liquidity Buffer' },
  { id: 'automationAgentPool', name: 'Automation / AI Agent Pool' },
];
const CORE_BUCKET_POLICY_FIELDS: Readonly<Record<BucketPolicyAllocationId, string>> = {
  liquidOperationalReserve: 'liquidOperationalReserveBps',
  yieldStrategyBuffer: 'yieldStrategyBufferBps',
  sweepLiquidityBuffer: 'sweepLiquidityBufferBps',
  automationAgentPool: 'automationAgentPoolBps',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function isCurrentConfiguredMarketSnapshot(value: unknown): boolean {
  const marketData = asRecord(value);
  const freshness = asRecord(marketData?.freshness);
  const vault = asRecord(marketData?.vault);
  const underlyingMarket = asRecord(marketData?.underlyingMarket);
  const marketValueAvailable = (observation: unknown, unit: string): boolean => {
    const record = asRecord(observation);
    return Boolean(record
      && record.availability === 'AVAILABLE'
      && ['ARC_MAINNET_RPC', 'MORPHO_GRAPHQL'].includes(String(record.source))
      && record.unit === unit
      && record.value !== null
      && record.value !== undefined);
  };
  const totalAssets = asRecord(vault?.totalAssets);
  const availableLiquidity = asRecord(vault?.availableLiquidity);
  const apy = asRecord(vault?.apy);
  const marketLiquidity = asRecord(underlyingMarket?.liquidity);
  const utilization = asRecord(underlyingMarket?.utilizationBps);
  const marketBlock = asRecord(underlyingMarket?.stateBlockNumber);
  const marketTimestamp = asRecord(underlyingMarket?.stateTimestamp);
  const totalAssetsValue = typeof totalAssets?.value === 'string' && /^\d+$/.test(totalAssets.value)
    ? BigInt(totalAssets.value)
    : null;
  const liquidityValue = typeof availableLiquidity?.value === 'string' && /^\d+$/.test(availableLiquidity.value)
    ? BigInt(availableLiquidity.value)
    : null;
  const underlyingLiquidityValue = typeof marketLiquidity?.value === 'string' && /^\d+$/.test(marketLiquidity.value)
    ? BigInt(marketLiquidity.value)
    : null;
  const retrievedAtSeconds = freshness && typeof freshness.retrievedAt === 'string'
    ? Math.floor(Date.parse(freshness.retrievedAt) / 1000)
    : Number.NaN;
  const ageSeconds = freshness?.ageSeconds;
  const maximumAgeSeconds = freshness?.maximumAgeSeconds;
  const headTimestamp = typeof freshness?.sourceHeadBlockTimestamp === 'string'
    ? Number(freshness.sourceHeadBlockTimestamp)
    : Number.NaN;
  const marketStateTimestamp = typeof marketTimestamp?.value === 'string' ? Number(marketTimestamp.value) : Number.NaN;
  const headBlockNumber = typeof freshness?.sourceHeadBlockNumber === 'string'
    && /^\d+$/.test(freshness.sourceHeadBlockNumber)
    ? BigInt(freshness.sourceHeadBlockNumber)
    : null;
  const marketStateBlockNumber = typeof marketBlock?.value === 'string' && /^\d+$/.test(marketBlock.value)
    ? BigInt(marketBlock.value)
    : null;
  return Boolean(marketData
    && freshness
    && vault
    && marketData.status === 'PARTIAL'
    && ['ARC_MAINNET_RPC', 'MORPHO_GRAPHQL', 'MULTIPLE_VERIFIED_SOURCES'].includes(String(marketData.source))
    && marketData.identityVerified === true
    && marketData.network === 'Arc Mainnet'
    && marketData.chainId === 5042
    && typeof marketData.assetAddress === 'string'
    && marketData.assetAddress.toLowerCase() === '0x3600000000000000000000000000000000000000'
    && typeof marketData.vaultAddress === 'string'
    && marketData.vaultAddress.toLowerCase() === '0xbeef0016cb2fd5c352ea7ca08a9f54739dfa7298'
    && marketData.protocolName === 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2'
    && typeof marketData.protocolId === 'string'
    && marketData.protocolId.toLowerCase() === '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450'
    && freshness.status === 'CURRENT'
    && typeof ageSeconds === 'number'
    && Number.isSafeInteger(ageSeconds)
    && ageSeconds >= 0
    && typeof maximumAgeSeconds === 'number'
    && Number.isSafeInteger(maximumAgeSeconds)
    && maximumAgeSeconds > 0
    && ageSeconds <= maximumAgeSeconds
    && Number.isFinite(retrievedAtSeconds)
    && Number.isSafeInteger(headTimestamp)
    && Number.isSafeInteger(marketStateTimestamp)
    && retrievedAtSeconds >= headTimestamp
    && retrievedAtSeconds - headTimestamp <= maximumAgeSeconds
    && retrievedAtSeconds >= marketStateTimestamp
    && headBlockNumber !== null
    && marketStateBlockNumber !== null
    && headBlockNumber >= marketStateBlockNumber
    && typeof freshness.blockNumber === 'string'
    && freshness.blockNumber === freshness.sourceHeadBlockNumber
    && typeof freshness.blockTimestamp === 'string'
    && Number(freshness.blockTimestamp) === headTimestamp
    && headTimestamp >= marketStateTimestamp
    && marketValueAvailable(vault.totalAssets, 'USDC_BASE_UNITS')
    && totalAssetsValue !== null
    && totalAssetsValue > 0n
    && ((marketValueAvailable(vault.availableLiquidity, 'USDC_BASE_UNITS')
      && liquidityValue !== null
      && liquidityValue <= totalAssetsValue)
      || (marketValueAvailable(marketLiquidity, 'USDC_BASE_UNITS') && underlyingLiquidityValue !== null))
    && (!marketValueAvailable(vault.apy, 'RATIO')
      || (typeof apy?.value === 'string'
        && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(apy.value)
        && Number.isFinite(Number(apy.value))))
    && (!marketValueAvailable(utilization, 'BPS')
      || (typeof utilization?.value === 'number'
        && Number.isSafeInteger(utilization.value)
        && utilization.value >= 0
        && utilization.value <= 10_000)));
}

export function isAdminBucketPolicySuggestion(value: unknown): value is AdminBucketPolicySuggestion {
  const suggestion = asRecord(value);
  const allocations = suggestion?.allocations;
  const lineage = asRecord(suggestion?.lineage);
  const lifecycle = asRecord(suggestion?.lifecycle);
  if (!suggestion
    || suggestion.advisoryLabel !== 'AI recommendation — Admin review required.'
    || suggestion.executionStatus !== 'NOT_EXECUTABLE'
    || !Array.isArray(allocations)
    || !isStringArray(suggestion.keyRiskAssumptions)
    || suggestion.keyRiskAssumptions.length === 0
    || !isStringArray(suggestion.unavailableData)
    || suggestion.unavailableData.length === 0
    || !isStringArray(suggestion.evidenceReferences)
    || suggestion.evidenceReferences.length === 0
    || !['AVAILABLE', 'UNAVAILABLE', 'INSUFFICIENT_VERIFIED_DATA', 'REQUIRES_ADMIN_ADJUSTMENT', 'CORE_CONSTRAINTS_UNAVAILABLE'].includes(String(suggestion.recommendationStatus))
    || !['PARTIAL', 'UNAVAILABLE'].includes(String(suggestion.marketDataStatus))
    || !asRecord(suggestion.coreConstraints)
    || !asRecord(suggestion.bucketPolicyValidation)
    || !asRecord(suggestion.veloxFacts)) {
    return false;
  }
  if (suggestion.lineage !== undefined
    && (!lineage
      || !(typeof lineage.model === 'string' || lineage.model === null)
      || typeof lineage.generatedAt !== 'string'
      || !Number.isFinite(Date.parse(lineage.generatedAt))
      || typeof lineage.evidenceSnapshotId !== 'string'
      || !/^[a-f0-9]{64}$/.test(lineage.evidenceSnapshotId)
      || !(typeof lineage.rawGeminiResponse === 'string' || lineage.rawGeminiResponse === null)
      || !('evidenceSnapshot' in lineage))) {
    return false;
  }
  if (suggestion.lifecycle !== undefined
    && (!lifecycle
      || !['GENERATED', 'ACTIVE_EXISTING', 'REGENERATED'].includes(String(lifecycle.disposition))
      || !['CURRENT', 'STALE', 'UNAVAILABLE'].includes(String(lifecycle.evidenceStatus)))) {
    return false;
  }
  const constraints = asRecord(suggestion.coreConstraints)!;
  const bucketPolicyValidation = asRecord(suggestion.bucketPolicyValidation)!;
  const currentBucketPolicy = asRecord(asRecord(suggestion.veloxFacts)?.currentBucketPolicy);
  const exceededBuckets = bucketPolicyValidation.exceededBuckets;
  if (!Array.isArray(exceededBuckets)
    || exceededBuckets.some((id) => !BUCKETS.some((bucket) => bucket.id === id))
    || new Set(exceededBuckets).size !== exceededBuckets.length) {
    return false;
  }
  const currentLimits = BUCKETS.map(({ id }) => {
    const observation = asRecord(currentBucketPolicy?.[CORE_BUCKET_POLICY_FIELDS[id]]);
    const value = observation?.value;
    const bps = typeof value === 'number'
      ? value
      : typeof value === 'bigint'
        ? Number(value)
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : null;
    return {
      id,
      bps: observation?.source === 'CORE'
        && observation.availability === 'AVAILABLE'
        && observation.unit === 'BPS'
        && bps !== null
        && Number.isSafeInteger(bps)
        && bps >= 0
        && bps <= 10_000
        ? bps
        : null,
    };
  });
  const currentBucketPolicyAvailable = currentLimits.every(({ bps }) => bps !== null)
    && currentLimits.reduce((sum, { bps }) => sum + (bps ?? 0), 0) === 10_000;
  if (bucketPolicyValidation.status !== (currentBucketPolicyAvailable ? 'AVAILABLE' : 'UNAVAILABLE')) {
    return false;
  }
  const marketData = asRecord(suggestion.marketData);
  const marketFreshness = asRecord(marketData?.freshness);
  if (!isStringArray(suggestion.missingVerifiedData)) return false;
  if (suggestion.recommendationStatus === 'UNAVAILABLE') {
    return allocations.length === 0
      && suggestion.totalPercentage === null
      && suggestion.totalBps === null
      && (constraints.status !== 'AVAILABLE'
        || suggestion.marketDataStatus === 'UNAVAILABLE'
        || !isCurrentConfiguredMarketSnapshot(suggestion.marketData)
        || marketFreshness?.status !== 'CURRENT');
  }
  if (suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA') {
    return allocations.length === 0
      && suggestion.totalPercentage === null
      && suggestion.totalBps === null
      && suggestion.missingVerifiedData.length > 0
      && suggestion.marketDataStatus === 'PARTIAL'
      && isCurrentConfiguredMarketSnapshot(suggestion.marketData)
      && marketFreshness?.status === 'CURRENT';
  }
  if (suggestion.marketDataStatus !== 'PARTIAL'
    || suggestion.totalPercentage !== '100%'
    || suggestion.totalBps !== 10_000
    || allocations.length !== BUCKETS.length
    || !isCurrentConfiguredMarketSnapshot(suggestion.marketData)) {
    return false;
  }
  const constraintsUnavailable = constraints.status === 'UNAVAILABLE';
  if (constraintsUnavailable
    ? constraints.maximumYieldStrategyBufferBps !== null
      || constraints.minimumLiquidOperationalReserveBps !== null
    : constraints.status !== 'AVAILABLE'
      || typeof constraints.maximumYieldStrategyBufferBps !== 'number'
      || !Number.isSafeInteger(constraints.maximumYieldStrategyBufferBps)
      || constraints.maximumYieldStrategyBufferBps < 0
      || constraints.maximumYieldStrategyBufferBps > 10_000
      || typeof constraints.minimumLiquidOperationalReserveBps !== 'number'
      || !Number.isSafeInteger(constraints.minimumLiquidOperationalReserveBps)
      || constraints.minimumLiquidOperationalReserveBps < 0
      || constraints.minimumLiquidOperationalReserveBps > 10_000) {
    return false;
  }
  const records = allocations.map(asRecord);
  if (records.some((allocation) => !allocation)) return false;
  const typedAllocations = records as Record<string, unknown>[];
  if (typedAllocations.some((allocation, index) => allocation.id !== BUCKETS[index]?.id
    || allocation.name !== BUCKETS[index]?.name
    || typeof allocation.percentage !== 'string'
    || typeof allocation.bps !== 'number'
    || !Number.isSafeInteger(allocation.bps)
    || allocation.bps < 0
    || allocation.bps > 10_000
    || typeof allocation.reasoning !== 'string'
    || !allocation.reasoning.trim())) {
    return false;
  }
  const total = typedAllocations.reduce((sum, allocation) => sum + (allocation.bps as number), 0);
  const yieldAllocation = typedAllocations.find((allocation) => allocation.id === 'yieldStrategyBuffer');
  const operationalAllocation = typedAllocations.find((allocation) => allocation.id === 'liquidOperationalReserve');
  const exceedsCoreConstraints = !constraintsUnavailable
    && ((yieldAllocation?.bps as number) > (constraints.maximumYieldStrategyBufferBps as number)
      || (operationalAllocation?.bps as number) < (constraints.minimumLiquidOperationalReserveBps as number));
  const currentLimitById = new Map(currentLimits.map(({ id, bps }) => [id, bps]));
  const exceedsCurrentBucketPolicy = currentBucketPolicyAvailable
    ? typedAllocations
      .filter((allocation) => (allocation.bps as number) > (currentLimitById.get(allocation.id as BucketPolicyAllocationId) ?? -1))
      .map((allocation) => allocation.id)
    : [];
  if (exceededBuckets.length !== exceedsCurrentBucketPolicy.length
    || exceededBuckets.some((id, index) => id !== exceedsCurrentBucketPolicy[index])) {
    return false;
  }
  const requiresAdminAdjustment = exceedsCoreConstraints || exceedsCurrentBucketPolicy.length > 0;
  const anyConstraintsUnavailable = constraintsUnavailable || !currentBucketPolicyAvailable;
  return total === 10_000
    && (requiresAdminAdjustment
      ? suggestion.recommendationStatus === 'REQUIRES_ADMIN_ADJUSTMENT'
      : anyConstraintsUnavailable
        ? suggestion.recommendationStatus === 'CORE_CONSTRAINTS_UNAVAILABLE'
        : suggestion.recommendationStatus === 'AVAILABLE')
    && typedAllocations.every((allocation) => allocation.percentage === `${Math.floor((allocation.bps as number) / 100)}.${String((allocation.bps as number) % 100).padStart(2, '0')}%`);
}

export type AdminBucketPolicySuggestionAction = 'GET_CURRENT_RECOMMENDATION' | 'REGENERATE_AI_RECOMMENDATION';

export async function requestAdminBucketPolicySuggestion(
  fetcher: typeof fetch = fetch,
  action: AdminBucketPolicySuggestionAction = 'GET_CURRENT_RECOMMENDATION',
): Promise<AdminBucketPolicySuggestion> {
  const response = await fetcher('/api/ai/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ task: 'SUGGEST_BUCKET_POLICY', action }),
  });
  const body = await response.json().catch(() => null) as unknown;
  const payload = asRecord(body);
  if (!response.ok) {
    const detail = typeof payload?.error === 'string' ? payload.error : '';
    throw new Error(response.status === 403
      ? 'Admin authorization is required to request a bucket policy suggestion.'
      : response.status === 401
        ? 'Wallet authentication is required to request a bucket policy suggestion.'
        : detail || 'Admin AI could not generate a bucket policy suggestion.');
  }
  if (payload?.scope !== 'ADMIN' || !isAdminBucketPolicySuggestion(payload.bucketPolicySuggestion)) {
    throw new Error('Admin AI returned an invalid bucket policy suggestion. No values were added to the policy draft.');
  }
  return payload.bucketPolicySuggestion;
}
