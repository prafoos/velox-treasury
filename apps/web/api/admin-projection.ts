import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_CORE_ADDRESS,
  createServerClient,
  coreStateAbi,
  readOptionalContract,
  serializeApiData,
  type CoreStateClient,
} from './core-state.js';
import {
  ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
  AUTOMATION_ROLE,
  EMERGENCY_ROLE,
  POLICY_ADMIN_ROLE,
  TIMELOCK_EXECUTOR_ROLE,
} from '../src/contracts/treasury.js';
import {
  WalletAuthConfigurationError,
  WalletAuthError,
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  type WalletAuthRequest,
} from '../server/wallet-auth.js';
import type { Address } from 'viem';
import { readStrategyState } from './strategy-state.js';

type RawExposureCap = readonly [absoluteCap: bigint, relativeCapBps: number, approved: boolean, enabled: boolean];

interface AdminProjectionResponse {
  status(code: number): AdminProjectionResponse;
  setHeader(name: string, value: string): AdminProjectionResponse;
  json(body: unknown): void;
}

export type AdminProjectionSource = 'CORE' | 'API_DERIVED' | 'LOCAL_CONFIGURATION' | 'INDEXER' | 'LOCAL_DRAFT';
export type AdminProjectionAvailability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
export type AdminProjectionUnit = 'USDC_BASE_UNITS' | 'SHARES' | 'BPS' | 'BLOCK' | 'COUNT' | 'BOOLEAN' | 'ADDRESS' | 'BYTES32' | 'ENUM' | 'NONE';
export type AdminProjectionZeroMeaning = 'AUTHORITATIVE_ZERO' | 'NOT_APPLICABLE' | 'UNAVAILABLE';

export interface AdminProjectionValue<T> {
  readonly source: AdminProjectionSource;
  readonly availability: AdminProjectionAvailability;
  readonly unit: AdminProjectionUnit;
  readonly zeroMeaning: AdminProjectionZeroMeaning;
  readonly value: T | null;
}

/**
 * A collection/status boundary.  Unlike a value read, a missing collection must
 * never be represented as an empty array: an empty array would claim that the
 * application successfully enumerated zero entries.
 */
export interface AdminProjectionSection<T> {
  readonly source: AdminProjectionSource;
  readonly availability: AdminProjectionAvailability;
  readonly data: T | null;
  readonly reason?: string;
}

interface AdminExposureCapProjection {
  readonly absoluteCap: AdminProjectionValue<bigint>;
  readonly relativeCapBps: AdminProjectionValue<number>;
  readonly approved: AdminProjectionValue<boolean>;
  readonly enabled: AdminProjectionValue<boolean>;
}

type RiskPolicyFields = {
  readonly minimumLiquidReserve: AdminProjectionValue<bigint>;
  readonly minimumLiquidReserveBps: AdminProjectionValue<number>;
  readonly maximumTotalDeployed: AdminProjectionValue<bigint>;
};

type BucketPolicyFields = {
  readonly liquidOperationalReserveBps: AdminProjectionValue<bigint>;
  readonly yieldStrategyBufferBps: AdminProjectionValue<bigint>;
  readonly sweepLiquidityBufferBps: AdminProjectionValue<bigint>;
  readonly automationAgentPoolBps: AdminProjectionValue<bigint>;
};

function hasNumericZeroSemantics(unit: AdminProjectionUnit): boolean {
  return ['USDC_BASE_UNITS', 'SHARES', 'BPS', 'BLOCK', 'COUNT'].includes(unit);
}

function calculateTotalPnl(
  realizedYield: bigint | number,
  realizedLoss: bigint | number,
  unrealizedYield: bigint | number,
  unrealizedLoss: bigint | number,
): bigint | number {
  if (
    typeof realizedYield === 'bigint'
    && typeof realizedLoss === 'bigint'
    && typeof unrealizedYield === 'bigint'
    && typeof unrealizedLoss === 'bigint'
  ) {
    return (realizedYield - realizedLoss) + (unrealizedYield - unrealizedLoss);
  }
  if (
    typeof realizedYield === 'number'
    && typeof realizedLoss === 'number'
    && typeof unrealizedYield === 'number'
    && typeof unrealizedLoss === 'number'
  ) {
    return (realizedYield - realizedLoss) + (unrealizedYield - unrealizedLoss);
  }
  throw new TypeError('Strategy P&L amounts must use a consistent numeric type.');
}

function fromCore<T>(result: T | { unavailable: true }, unit: AdminProjectionUnit = 'NONE'): AdminProjectionValue<T> {
  if (result !== null && typeof result === 'object' && 'unavailable' in result) {
    return { source: 'CORE', availability: 'UNAVAILABLE', unit, zeroMeaning: 'UNAVAILABLE', value: null };
  }
  return {
    source: 'CORE',
    availability: 'AVAILABLE',
    unit,
    zeroMeaning: hasNumericZeroSemantics(unit) ? 'AUTHORITATIVE_ZERO' : 'NOT_APPLICABLE',
    value: result as T,
  };
}

function unavailable<T>(source: AdminProjectionSource, unit: AdminProjectionUnit = 'NONE'): AdminProjectionValue<T> {
  return { source, availability: 'UNAVAILABLE', unit, zeroMeaning: 'UNAVAILABLE', value: null };
}

function unavailableSection<T>(source: AdminProjectionSource, reason: string): AdminProjectionSection<T> {
  return { source, availability: 'UNAVAILABLE', data: null, reason };
}

function available<T>(source: AdminProjectionSource, value: T, unit: AdminProjectionUnit): AdminProjectionValue<T> {
  return {
    source,
    availability: 'AVAILABLE',
    unit,
    zeroMeaning: hasNumericZeroSemantics(unit) ? 'AUTHORITATIVE_ZERO' : 'NOT_APPLICABLE',
    value,
  };
}

function unavailableExposureCap(): AdminExposureCapProjection {
  return {
    absoluteCap: unavailable('CORE', 'USDC_BASE_UNITS'),
    relativeCapBps: unavailable('CORE', 'BPS'),
    approved: unavailable('CORE', 'BOOLEAN'),
    enabled: unavailable('CORE', 'BOOLEAN'),
  };
}

function isUnavailableRead(value: unknown): value is { readonly unavailable: true } {
  return value !== null
    && typeof value === 'object'
    && 'unavailable' in value
    && (value as { readonly unavailable?: unknown }).unavailable === true;
}

export async function verifyAdminRole(client: CoreStateClient, account: `0x${string}`): Promise<void> {
  let chainId: number | bigint;
  try {
    chainId = await client.getChainId();
  } catch {
    throw new WalletAuthConfigurationError('Admin network verification is unavailable.');
  }
  if (typeof chainId !== 'number' || chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new WalletAuthConfigurationError('Admin projection requires Arc Mainnet.');
  }

  let isPolicyAdmin: boolean;
  try {
    isPolicyAdmin = await client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: coreStateAbi,
      functionName: 'hasRole',
      args: [POLICY_ADMIN_ROLE, account],
    });
  } catch {
    throw new WalletAuthConfigurationError('Admin role verification is unavailable.');
  }
  if (!isPolicyAdmin) throw new WalletAuthError(403, 'POLICY_ADMIN_ROLE is required.');
}

export async function readAuthorizedAdminProjection(client: CoreStateClient, account: `0x${string}`) {
  const [
    paused,
    totalUserLiabilities,
    liquidUSDC,
    requiredLiquidReserve,
    availableLiquidity,
    totalDeployed,
    totalManagedAssets,
    approvedProtocolCount,
    approvedAssetCount,
    approvedStrategyCount,
    riskPolicy,
    timelockDelaySeconds,
    valuationFreshnessBlocks,
    bucketPolicy,
    bucketTargets,
    yieldStrategyBufferCapacity,
    liquidBucketClassifications,
    timelockExecutor,
    automation,
    emergency,
    blockNumber,
  ] = await Promise.all([
    readOptionalContract<boolean>(client, 'paused'),
    readOptionalContract<bigint>(client, 'totalUserLiabilities'),
    readOptionalContract<bigint>(client, 'liquidUSDC'),
    readOptionalContract<bigint>(client, 'requiredLiquidReserve'),
    readOptionalContract<bigint>(client, 'availableLiquidity'),
    readOptionalContract<bigint>(client, 'totalDeployed'),
    readOptionalContract<bigint>(client, 'totalManagedAssets'),
    readOptionalContract<bigint>(client, 'approvedProtocolCount'),
    readOptionalContract<bigint>(client, 'approvedAssetCount'),
    readOptionalContract<bigint>(client, 'approvedStrategyCount'),
    readOptionalContract<{
      minimumLiquidReserve: bigint;
      minimumLiquidReserveBps: number;
      maximumTotalDeployed: bigint;
    }>(client, 'riskPolicy'),
    readOptionalContract<bigint>(client, 'TIMELOCK_DELAY'),
    readOptionalContract<bigint>(client, 'valuationFreshnessBlocks'),
    readOptionalContract<{
      liquidOperationalReserveBps: bigint;
      yieldStrategyBufferBps: bigint;
      sweepLiquidityBufferBps: bigint;
      automationAgentPoolBps: bigint;
    }>(client, 'bucketPolicy'),
    readOptionalContract<readonly bigint[]>(client, 'bucketTargets'),
    readOptionalContract<bigint>(client, 'yieldStrategyBufferCapacity'),
    readOptionalContract<readonly bigint[]>(client, 'liquidBucketClassifications'),
    readOptionalContract<boolean>(client, 'hasRole', [
      TIMELOCK_EXECUTOR_ROLE,
      account,
    ]),
    readOptionalContract<boolean>(client, 'hasRole', [
      AUTOMATION_ROLE,
      account,
    ]),
    readOptionalContract<boolean>(client, 'hasRole', [
      EMERGENCY_ROLE,
      account,
    ]),
    client.getBlockNumber().catch(() => null),
  ]);

  let strategy: Record<string, unknown>;
  let configuredStrategyStateAvailable = false;
  try {
    if (!ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS) {
      throw new Error('A final configured Steakhouse Adapter address is unavailable.');
    }
    const strategyState = await readStrategyState(client, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS);
    configuredStrategyStateAvailable = true;
    const isConfigured = strategyState.approved;
    const [protocolCap, assetCap, protocolVault, protocolExposure, assetExposure] = isConfigured
      ? await Promise.all([
          readOptionalContract<RawExposureCap>(client, 'protocolCaps', [strategyState.protocol]),
          readOptionalContract<RawExposureCap>(client, 'assetCaps', [strategyState.asset]),
          readOptionalContract<Address>(client, 'protocolVaults', [strategyState.protocol]),
          readOptionalContract<bigint>(client, 'protocolExposure', [strategyState.protocol]),
          readOptionalContract<bigint>(client, 'assetExposure', [strategyState.asset]),
        ])
      : [null, null, null, null, null];
    const strategyValue = <T>(value: T, unit: AdminProjectionUnit): AdminProjectionValue<T> => isConfigured
      ? available('CORE', value, unit)
      : unavailable<T>('CORE', unit);
    const derivedValue = <T>(value: T, unit: AdminProjectionUnit): AdminProjectionValue<T> => isConfigured
      ? available('API_DERIVED', value, unit)
      : unavailable<T>('API_DERIVED', unit);
    const optionalCoreValue = <T>(value: T | { unavailable: true } | null, unit: AdminProjectionUnit): AdminProjectionValue<T> =>
      value === null ? unavailable<T>('CORE', unit) : fromCore(value, unit);
    const exposureCap = (value: RawExposureCap | { unavailable: true } | null): AdminExposureCapProjection => {
      if (value === null || 'unavailable' in value) return unavailableExposureCap();
      return {
        absoluteCap: fromCore(value[0], 'USDC_BASE_UNITS'),
        relativeCapBps: fromCore(value[1], 'BPS'),
        approved: fromCore(value[2], 'BOOLEAN'),
        enabled: fromCore(value[3], 'BOOLEAN'),
      };
    };

    strategy = {
      adapterAddress: available('LOCAL_CONFIGURATION', ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS, 'ADDRESS'),
      protocolId: strategyValue(strategyState.protocol, 'BYTES32'),
      assetAddress: strategyValue(strategyState.asset, 'ADDRESS'),
      protocolVaultAddress: optionalCoreValue(protocolVault, 'ADDRESS'),
      protocolCap: exposureCap(protocolCap),
      assetCap: exposureCap(assetCap),
      protocolExposure: optionalCoreValue(protocolExposure, 'USDC_BASE_UNITS'),
      assetExposure: optionalCoreValue(assetExposure, 'USDC_BASE_UNITS'),
      principal: strategyValue(strategyState.principal, 'USDC_BASE_UNITS'),
      currentValue: strategyValue(strategyState.currentValue, 'USDC_BASE_UNITS'),
      shares: strategyValue(strategyState.shares, 'SHARES'),
      absoluteCap: strategyValue(strategyState.absoluteCap, 'USDC_BASE_UNITS'),
      relativeCapBps: strategyValue(strategyState.relativeCapBps, 'BPS'),
      realizedYield: strategyValue(strategyState.realizedYield, 'USDC_BASE_UNITS'),
      realizedLoss: strategyValue(strategyState.realizedLoss, 'USDC_BASE_UNITS'),
      unrealizedYield: derivedValue(strategyState.unrealizedYield, 'USDC_BASE_UNITS'),
      unrealizedLoss: derivedValue(strategyState.unrealizedLoss, 'USDC_BASE_UNITS'),
      totalPnl: derivedValue(
        calculateTotalPnl(
          strategyState.realizedYield,
          strategyState.realizedLoss,
          strategyState.unrealizedYield,
          strategyState.unrealizedLoss,
        ),
        'USDC_BASE_UNITS',
      ),
      feesAccrued: strategyValue(strategyState.feesAccrued, 'USDC_BASE_UNITS'),
      withdrawalShortfall: strategyValue(strategyState.withdrawalShortfall, 'USDC_BASE_UNITS'),
      valuationStatus: strategyValue(strategyState.valuationStatus, 'ENUM'),
      valuationStatusLabel: derivedValue(strategyState.valuationStatusLabel, 'NONE'),
      valuationBlock: strategyValue(strategyState.valuationBlock, 'BLOCK'),
      valuationSource: strategyValue(strategyState.valuationSource, 'ADDRESS'),
      approved: fromCore(strategyState.approved, 'BOOLEAN'),
      enabled: fromCore(strategyState.enabled, 'BOOLEAN'),
    };
  } catch {
    strategy = {
      adapterAddress: ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS
        ? available('LOCAL_CONFIGURATION', ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS, 'ADDRESS')
        : unavailable<Address>('LOCAL_CONFIGURATION', 'ADDRESS'),
      protocolId: unavailable<string>('CORE', 'BYTES32'),
      assetAddress: unavailable<string>('CORE', 'ADDRESS'),
      protocolVaultAddress: unavailable<Address>('CORE', 'ADDRESS'),
      protocolCap: unavailableExposureCap(),
      assetCap: unavailableExposureCap(),
      protocolExposure: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      assetExposure: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      principal: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      currentValue: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      shares: unavailable<bigint>('CORE', 'SHARES'),
      absoluteCap: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      relativeCapBps: unavailable<number>('CORE', 'BPS'),
      realizedYield: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      realizedLoss: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      unrealizedYield: unavailable<bigint>('API_DERIVED', 'USDC_BASE_UNITS'),
      unrealizedLoss: unavailable<bigint>('API_DERIVED', 'USDC_BASE_UNITS'),
      totalPnl: unavailable<bigint>('API_DERIVED', 'USDC_BASE_UNITS'),
      feesAccrued: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      withdrawalShortfall: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      valuationStatus: unavailable<number>('CORE', 'ENUM'),
      valuationStatusLabel: unavailable<string>('API_DERIVED'),
      valuationBlock: unavailable<bigint>('CORE', 'BLOCK'),
      valuationSource: unavailable<string>('CORE', 'ADDRESS'),
      approved: unavailable<boolean>('CORE', 'BOOLEAN'),
      enabled: unavailable<boolean>('CORE', 'BOOLEAN'),
    };
  }

  const managedAssets = fromCore(totalManagedAssets, 'USDC_BASE_UNITS');
  const configuredStrategy = configuredStrategyStateAvailable
    ? {
        source: 'LOCAL_CONFIGURATION' as const,
        availability: 'AVAILABLE' as const,
        classification: 'CONFIGURED_STRATEGY_ONLY' as const,
        data: strategy,
        reason: 'This is the single adapter configured by this application; it is not an enumerable strategy registry.',
      }
    : {
        source: 'LOCAL_CONFIGURATION' as const,
        availability: 'PARTIAL' as const,
        classification: 'CONFIGURED_STRATEGY_ONLY' as const,
        data: strategy,
        reason: 'A single adapter is configured locally, but its current Core strategy state could not be read. This is not an enumerable strategy registry.',
      };

  const strategyRegistry = unavailableSection<never[]>(
    'CORE',
    'Core has no enumerable strategy getter, and this projection does not query or expose the indexer strategy ledger.',
  );
  const protocolRegistry = unavailableSection<never[]>(
    'CORE',
    'Complete approved protocol registry is not currently served. Approval counts and one configured strategy protocol are not a registry.',
  );
  const assetRegistry = unavailableSection<never[]>(
    'CORE',
    'Complete approved asset registry is not currently served. Approval counts and one configured strategy asset are not a registry.',
  );
  return {
    scope: 'ADMIN',
    authenticatedWalletAddress: account,
    chainId: ARC_MAINNET_CHAIN_ID,
    coreAddress: ARC_MAINNET_CORE_ADDRESS,
    authorization: {
      policyAdmin: available('CORE', true, 'BOOLEAN'),
      timelockExecutor: fromCore(timelockExecutor, 'BOOLEAN'),
      automation: fromCore(automation, 'BOOLEAN'),
      emergency: fromCore(emergency, 'BOOLEAN'),
    },
    treasury: {
      totalUserLiabilities: fromCore(totalUserLiabilities, 'USDC_BASE_UNITS'),
      liquidUSDC: fromCore(liquidUSDC, 'USDC_BASE_UNITS'),
      requiredLiquidReserve: fromCore(requiredLiquidReserve, 'USDC_BASE_UNITS'),
      availableLiquidity: fromCore(availableLiquidity, 'USDC_BASE_UNITS'),
      totalDeployed: fromCore(totalDeployed, 'USDC_BASE_UNITS'),
      totalManagedAssets: managedAssets,
      nav: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      allocatedBalance: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
      paused: fromCore(paused, 'BOOLEAN'),
      blockNumber: blockNumber === null
        ? unavailable<bigint>('CORE', 'BLOCK')
        : fromCore(blockNumber, 'BLOCK'),
    },
    approvals: {
      approvedProtocolCount: fromCore(approvedProtocolCount, 'COUNT'),
      approvedAssetCount: fromCore(approvedAssetCount, 'COUNT'),
      approvedStrategyCount: fromCore(approvedStrategyCount, 'COUNT'),
      protocolRegistry: unavailable<never[]>('CORE', 'ADDRESS'),
      assetRegistry: unavailable<never[]>('CORE', 'ADDRESS'),
      strategyRegistry: unavailable<never[]>('CORE', 'ADDRESS'),
    },
    riskPolicy: {
      minimumLiquidReserve: 'unavailable' in riskPolicy
        ? unavailable<bigint>('CORE', 'USDC_BASE_UNITS')
        : fromCore(riskPolicy.minimumLiquidReserve, 'USDC_BASE_UNITS'),
      minimumLiquidReserveBps: 'unavailable' in riskPolicy
        ? unavailable<number>('CORE', 'BPS')
        : fromCore(riskPolicy.minimumLiquidReserveBps, 'BPS'),
      maximumTotalDeployed: 'unavailable' in riskPolicy
        ? unavailable<bigint>('CORE', 'USDC_BASE_UNITS')
        : fromCore(riskPolicy.maximumTotalDeployed, 'USDC_BASE_UNITS'),
    },
    coreExecutionConstraints: {
      timelockDelaySeconds: isUnavailableRead(timelockDelaySeconds)
        ? unavailable<bigint>('CORE', 'BLOCK')
        : fromCore(timelockDelaySeconds, 'BLOCK'),
      valuationFreshnessBlocks: isUnavailableRead(valuationFreshnessBlocks)
        ? unavailable<bigint>('CORE', 'BLOCK')
        : fromCore(valuationFreshnessBlocks, 'BLOCK'),
    },
    bucketPolicy: {
      liquidOperationalReserveBps: 'unavailable' in bucketPolicy ? unavailable<bigint>('CORE', 'BPS') : fromCore(bucketPolicy.liquidOperationalReserveBps, 'BPS'),
      yieldStrategyBufferBps: 'unavailable' in bucketPolicy ? unavailable<bigint>('CORE', 'BPS') : fromCore(bucketPolicy.yieldStrategyBufferBps, 'BPS'),
      sweepLiquidityBufferBps: 'unavailable' in bucketPolicy ? unavailable<bigint>('CORE', 'BPS') : fromCore(bucketPolicy.sweepLiquidityBufferBps, 'BPS'),
      automationAgentPoolBps: 'unavailable' in bucketPolicy ? unavailable<bigint>('CORE', 'BPS') : fromCore(bucketPolicy.automationAgentPoolBps, 'BPS'),
    },
    bucketTargets: fromCore(bucketTargets, 'USDC_BASE_UNITS'),
    liquidBucketClassifications: fromCore(liquidBucketClassifications, 'USDC_BASE_UNITS'),
    yieldStrategyBufferCapacity: fromCore(yieldStrategyBufferCapacity, 'USDC_BASE_UNITS'),
    strategy,
    pendingTimelocks: unavailable<never[]>('CORE'),
    historicalYieldSeries: unavailable<never[]>('INDEXER'),
    exposureHistory: unavailable<never[]>('INDEXER'),
    userStrategyAccounting: unavailable<never>('CORE'),
    localDraftPolicy: unavailable<never>('LOCAL_DRAFT'),
    // Completeness contract for a future Admin AI. These sections deliberately
    // do not turn absent registries, scheduling state, or history into []/0.
    strategies: {
      source: 'CORE' as const,
      availability: 'PARTIAL' as const,
      data: { registry: strategyRegistry, configuredStrategy },
      reason: 'The configured strategy contains system-wide Core state; the complete strategy registry is unavailable.',
    },
    protocols: protocolRegistry,
    assets: assetRegistry,
    exposure: {
      source: 'CORE' as const,
      availability: configuredStrategyStateAvailable ? 'PARTIAL' as const : 'UNAVAILABLE' as const,
      data: configuredStrategyStateAvailable ? {
        totalDeployed: fromCore(totalDeployed, 'USDC_BASE_UNITS'),
        configuredStrategyCurrentValue: (strategy as Record<string, AdminProjectionValue<bigint>>).currentValue,
        configuredStrategyAbsoluteCap: (strategy as Record<string, AdminProjectionValue<bigint>>).absoluteCap,
        configuredStrategyRelativeCapBps: (strategy as Record<string, AdminProjectionValue<number>>).relativeCapBps,
        configuredStrategyRemainingAbsoluteCapacity: (() => {
          const value = strategy as Record<string, AdminProjectionValue<bigint>>;
          const cap = value.absoluteCap;
          const exposureValue = value.currentValue;
          return cap.availability === 'AVAILABLE' && exposureValue.availability === 'AVAILABLE'
            ? available('API_DERIVED', cap.value! > exposureValue.value! ? cap.value! - exposureValue.value! : 0n, 'USDC_BASE_UNITS')
            : unavailable<bigint>('API_DERIVED', 'USDC_BASE_UNITS');
        })(),
        configuredProtocolCap: (strategy as Record<string, unknown>).protocolCap,
        configuredAssetCap: (strategy as Record<string, unknown>).assetCap,
        strategyExposure: (strategy as Record<string, AdminProjectionValue<bigint>>).currentValue,
        protocolExposure: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
        assetExposure: unavailable<bigint>('CORE', 'USDC_BASE_UNITS'),
        relativeExposure: unavailable<number>('API_DERIVED', 'BPS'),
        historicalExposure: unavailable<never[]>('INDEXER', 'USDC_BASE_UNITS'),
      } : null,
      reason: configuredStrategyStateAvailable
        ? 'Exposure is limited to Core total deployed and the one configured strategy. Complete per-strategy, protocol, asset, and historical exposure are not served.'
        : 'Configured strategy state is unreadable and no complete registry or history API is served.',
    },
    timelocks: unavailableSection<never[]>(
      'CORE',
      'Pending timelock operations, ETA, operation IDs, and scheduled state are not currently served. Local drafts and transaction preparation are not live timelock state.',
    ),
    history: unavailableSection<Record<string, never>>(
      'INDEXER',
      'Indexer, ledger, and database code exist in the API package, but this application does not query or expose historical yield, APY/APR, P/L, exposure, valuation, or Treasury-flow series.',
    ),
    operationalStatus: {
      source: 'CORE' as const,
      availability: 'AVAILABLE' as const,
      data: {
        paused: fromCore(paused, 'BOOLEAN'),
        blockNumber: blockNumber === null ? unavailable<bigint>('CORE', 'BLOCK') : fromCore(blockNumber, 'BLOCK'),
      },
    },
  };
}

export type AdminAIReadProjection = Awaited<ReturnType<typeof readAuthorizedAdminProjection>>;

export async function handleAdminProjectionRequest(
  request: WalletAuthRequest,
  response: AdminProjectionResponse,
  clientFactory: () => CoreStateClient = createServerClient,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let account: `0x${string}`;
  try {
    account = requireAuthenticatedWallet(request).authenticatedWalletAddress;
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  try {
    const client = clientFactory();
    await verifyAdminRole(client, account);
    const projection = await readAuthorizedAdminProjection(client, account);
    response.status(200).json(serializeApiData(projection));
  } catch (error) {
    respondToWalletAuthError(error, response);
  }
}

export default function handler(request: WalletAuthRequest, response: AdminProjectionResponse): Promise<void> {
  return handleAdminProjectionRequest(request, response);
}
