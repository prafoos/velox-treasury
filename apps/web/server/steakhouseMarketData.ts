import 'dotenv/config';

import type { AdminAiInput, SteakhouseMarketSnapshot, VerifiedMarketValue } from '../../api/src/agent/types.js';
import {
  ARC_MAINNET_EXECUTION_CONFIG,
  ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
} from '../../api/src/config/arc-mainnet.js';
import { ARC_MAINNET_CHAIN_ID, type CoreStateClient } from '../api/core-state.js';

export const ARC_MAINNET_MORPHO_ASSET = ARC_MAINNET_EXECUTION_CONFIG.usdcAddress;
export const ARC_MAINNET_STEAKHOUSE_VAULT = ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS;
export const ARC_MAINNET_STEAKHOUSE_PROTOCOL_NAME = 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2' as const;
export const ARC_MAINNET_STEAKHOUSE_PROTOCOL_ID = ARC_MAINNET_EXECUTION_CONFIG.protocolId;
export const MORPHO_GRAPHQL_ENDPOINT = 'https://blue-api.morpho.org/graphql';
export const MARKET_SNAPSHOT_MAX_AGE_SECONDS = 600;

const MORPHO_VAULT_QUERY = `
  query AdminVaultMarketSnapshot($address: String!, $chainId: Int!) {
    chain(id: $chainId) {
      id
      headBlock { number timestamp }
    }
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      address
      chain { id headBlock { number timestamp } }
      asset { address decimals }
      totalAssets
      totalSupply
      idleAssets
      liquidity
      apy
      netApy
      warnings { type level }
      timelocks { functionName duration abdicatedAt }
      gatesConfig {
        receiveAssetsGate { address abdicated }
      }
      liquidityData {
        __typename
        ... on MarketV1LiquidityData {
          market {
            chain { id }
            marketId
            loanAsset { address decimals }
            lltv
            collateralAsset { address decimals }
            state {
              blockNumber timestamp liquidityAssets utilization collateralAssets
            }
            oracle { address type }
            badDebt { underlying usd }
            warnings { type level }
          }
        }
        ... on MetaMorphoLiquidityData {
          metaMorpho {
            address
            state {
              blockNumber timestamp timelock
              allocation {
                blockNumber supplyAssets supplyCap
                market { marketId lltv }
              }
            }
          }
        }
      }
    }
  }
`;

type JsonRecord = Record<string, unknown>;
type MorphoFetcher = typeof fetch;
const ERC4626_READ_ABI = [
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxDeposit', stateMutability: 'view', inputs: [{ name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxWithdraw', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function unavailable<T>(unit: string): VerifiedMarketValue<T> {
  return { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit };
}

function morphoValue<T>(value: T, unit: string): VerifiedMarketValue<T> {
  return { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value, unit };
}

function arcRpcValue<T>(value: T, unit: string): VerifiedMarketValue<T> {
  return { source: 'ARC_MAINNET_RPC', availability: 'AVAILABLE', value, unit };
}

function parseUnsignedInteger(value: unknown): bigint | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return null;
  try {
    const result = BigInt(value);
    return result >= 0n ? result : null;
  } catch {
    return null;
  }
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function parseWarnings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const warnings: string[] = [];
  for (const item of value) {
    const warning = asRecord(item);
    if (!warning || typeof warning.type !== 'string' || typeof warning.level !== 'string') return null;
    warnings.push(`${warning.level}: ${warning.type}`);
  }
  return warnings;
}

function unavailableSnapshot(
  retrievedAt: string,
  reason: string,
  freshnessStatus: SteakhouseMarketSnapshot['freshness']['status'] = 'UNAVAILABLE',
  freshness: Partial<SteakhouseMarketSnapshot['freshness']> = {},
): SteakhouseMarketSnapshot {
  const noValue = <T>(unit: string) => unavailable<T>(unit);
  return {
    source: 'UNAVAILABLE',
    status: 'UNAVAILABLE',
    network: 'Arc Mainnet',
    chainId: ARC_MAINNET_CHAIN_ID,
    assetAddress: ARC_MAINNET_MORPHO_ASSET,
    vaultAddress: ARC_MAINNET_STEAKHOUSE_VAULT,
    protocolName: ARC_MAINNET_STEAKHOUSE_PROTOCOL_NAME,
    protocolId: ARC_MAINNET_STEAKHOUSE_PROTOCOL_ID,
    identityVerified: false,
    freshness: {
      status: freshnessStatus,
      blockNumber: freshness.blockNumber ?? null,
      blockTimestamp: freshness.blockTimestamp ?? null,
      retrievedAt,
      ageSeconds: freshness.ageSeconds ?? null,
      maximumAgeSeconds: MARKET_SNAPSHOT_MAX_AGE_SECONDS,
      sourceHeadBlockNumber: freshness.sourceHeadBlockNumber ?? null,
      sourceHeadBlockTimestamp: freshness.sourceHeadBlockTimestamp ?? null,
    },
    vault: {
      totalAssets: noValue('USDC_BASE_UNITS'),
      availableLiquidity: noValue('USDC_BASE_UNITS'),
      idleLiquidity: noValue('USDC_BASE_UNITS'),
      utilizationBps: noValue('BPS'),
      totalSupply: noValue('SHARES'),
      apy: noValue('RATIO'),
      netApy: noValue('RATIO'),
      allocation: noValue('UNAVAILABLE'),
      depositAvailability: noValue('UNAVAILABLE'),
      depositGateStatus: noValue('GATE_CONFIG'),
      timelock: noValue('SECONDS'),
      warnings: noValue('NONE'),
    },
    underlyingMarket: {
      allocation: noValue('UNAVAILABLE'),
      liquidity: noValue('USDC_BASE_UNITS'),
      utilizationBps: noValue('BPS'),
      collateralExposure: noValue('UNAVAILABLE'),
      lltv: noValue('WAD'),
      oracleStatus: noValue('UNAVAILABLE'),
      badDebtStatus: noValue('UNAVAILABLE'),
      liquidationRisk: noValue('UNAVAILABLE'),
      warnings: noValue('NONE'),
      marketId: noValue('MARKET_ID'),
      stateBlockNumber: noValue('BLOCK'),
      stateTimestamp: noValue('UNIX_SECONDS'),
      collateralAssetAddress: noValue('ADDRESS'),
      collateralAssetDecimals: noValue('DECIMALS'),
    },
    unavailableData: [
      'Vault allocation by market, deposit availability, vault timelock, and liquidation-risk assessment are not provided for this linked MarketV1 liquidity-data shape.',
      'Vault warnings and underlying market risk fields are unavailable unless returned and validated by the official Morpho GraphQL source.',
    ],
    reason,
  };
}

export function unavailableSteakhouseMarketSnapshot(
  reason: string,
  now = new Date(),
): SteakhouseMarketSnapshot {
  return unavailableSnapshot(now.toISOString(), reason);
}

async function readVerifiedMorphoMarketSnapshot(
  projection: AdminAiInput,
  fetcher: MorphoFetcher = fetch,
  now = new Date(),
): Promise<SteakhouseMarketSnapshot> {
  const retrievedAt = now.toISOString();
  if (projection.chainId !== ARC_MAINNET_CHAIN_ID
    || ARC_MAINNET_EXECUTION_CONFIG.chainId !== ARC_MAINNET_CHAIN_ID) {
    return unavailableSnapshot(retrievedAt, 'Admin projection or configured market target is not on Arc Mainnet (chain 5042).');
  }

  let payload: JsonRecord;
  try {
    const response = await fetcher(MORPHO_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        query: MORPHO_VAULT_QUERY,
        variables: {
          address: ARC_MAINNET_STEAKHOUSE_VAULT,
          chainId: ARC_MAINNET_CHAIN_ID,
        },
      }),
    });
    if (!response.ok) {
      return unavailableSnapshot(retrievedAt, `Official Morpho GraphQL request failed with HTTP ${response.status}.`);
    }
    const json = asRecord(await response.json());
    if (!json || (Array.isArray(json.errors) && json.errors.length > 0)) {
      return unavailableSnapshot(retrievedAt, 'Official Morpho GraphQL returned errors or a malformed response.');
    }
    payload = asRecord(json.data) ?? {};
  } catch {
    return unavailableSnapshot(retrievedAt, 'Official Morpho GraphQL could not provide a current vault snapshot.');
  }

  const chain = asRecord(payload.chain);
  const vault = asRecord(payload.vaultV2ByAddress);
  const vaultChain = asRecord(vault?.chain);
  const asset = asRecord(vault?.asset);
  const headBlock = asRecord(chain?.headBlock);
  const vaultHeadBlock = asRecord(vaultChain?.headBlock);
  const headNumber = parseUnsignedInteger(headBlock?.number);
  const headTimestamp = parseUnsignedInteger(headBlock?.timestamp);
  const vaultHeadNumber = parseUnsignedInteger(vaultHeadBlock?.number);
  const vaultHeadTimestamp = parseUnsignedInteger(vaultHeadBlock?.timestamp);
  const retrievedAtSeconds = Math.floor(now.getTime() / 1000);

  if (!vault
    || chain?.id !== ARC_MAINNET_CHAIN_ID
    || vaultChain?.id !== ARC_MAINNET_CHAIN_ID
    || String(vault.address).toLowerCase() !== ARC_MAINNET_STEAKHOUSE_VAULT.toLowerCase()
    || typeof asset?.address !== 'string'
    || asset.address.toLowerCase() !== ARC_MAINNET_MORPHO_ASSET.toLowerCase()
    || asset.decimals !== 6) {
    return unavailableSnapshot(retrievedAt, 'Official Morpho response does not match the exact Arc chain, configured vault, USDC asset, and six-decimal asset identity.');
  }
  if (headNumber === null
    || headTimestamp === null
    || vaultHeadNumber === null
    || vaultHeadTimestamp === null
    || headNumber.toString() !== vaultHeadNumber.toString()
    || headTimestamp.toString() !== vaultHeadTimestamp.toString()) {
    return unavailableSnapshot(retrievedAt, 'Official Morpho response has missing or inconsistent Arc head-block freshness metadata.');
  }

  const marketAgeSeconds = retrievedAtSeconds - Number(headTimestamp);
  if (!Number.isSafeInteger(marketAgeSeconds) || marketAgeSeconds < 0) {
    return unavailableSnapshot(retrievedAt, 'Official Morpho head-block timestamp is malformed or in the future.', 'UNAVAILABLE', {
      sourceHeadBlockNumber: headNumber.toString(),
      sourceHeadBlockTimestamp: headTimestamp.toString(),
    });
  }
  if (marketAgeSeconds > MARKET_SNAPSHOT_MAX_AGE_SECONDS) {
    return unavailableSnapshot(retrievedAt, 'Official Morpho Arc head block is stale and cannot support a current market recommendation.', 'STALE', {
      blockNumber: headNumber.toString(),
      blockTimestamp: headTimestamp.toString(),
      ageSeconds: marketAgeSeconds,
      sourceHeadBlockNumber: headNumber.toString(),
      sourceHeadBlockTimestamp: headTimestamp.toString(),
    });
  }

  const totalAssets = parseUnsignedInteger(vault.totalAssets);
  const totalSupply = parseUnsignedInteger(vault.totalSupply);
  const idleAssets = parseUnsignedInteger(vault.idleAssets);
  const availableLiquidity = parseUnsignedInteger(vault.liquidity);
  const apy = parseFiniteNumber(vault.apy);
  const netApy = parseFiniteNumber(vault.netApy);
  const vaultWarnings = parseWarnings(vault.warnings);
  const timelocks = Array.isArray(vault.timelocks) ? vault.timelocks : null;
  const validTimelocks = timelocks?.every((item) => {
    const record = asRecord(item);
    return Boolean(record
      && typeof record.functionName === 'string'
      && parseUnsignedInteger(record.duration) !== null
      && (record.abdicatedAt === null || parseUnsignedInteger(record.abdicatedAt) !== null));
  }) ?? false;
  const gatesConfig = asRecord(vault.gatesConfig);
  const receiveAssetsGate = asRecord(gatesConfig?.receiveAssetsGate);
  const depositGateStatus = receiveAssetsGate
    && typeof receiveAssetsGate.abdicated === 'boolean'
    && (receiveAssetsGate.address === null || typeof receiveAssetsGate.address === 'string')
    ? `receiveAssetsGate address=${String(receiveAssetsGate.address)}; abdicated=${receiveAssetsGate.abdicated}`
    : null;
  const liquidityData = asRecord(vault.liquidityData);
  const market = asRecord(liquidityData?.market);
  const marketState = asRecord(market?.state);
  const marketOracle = asRecord(market?.oracle);
  const marketBadDebt = asRecord(market?.badDebt);
  const marketLoanAsset = asRecord(market?.loanAsset);
  const collateralAsset = asRecord(market?.collateralAsset);
  const marketBlock = parseUnsignedInteger(marketState?.blockNumber);
  const marketTimestamp = parseUnsignedInteger(marketState?.timestamp);
  const underlyingLiquidity = parseUnsignedInteger(marketState?.liquidityAssets);
  const marketUtilization = parseFiniteNumber(marketState?.utilization);
  const collateralExposure = parseUnsignedInteger(marketState?.collateralAssets);
  const lltv = parseUnsignedInteger(market?.lltv);
  const badDebt = parseUnsignedInteger(marketBadDebt?.underlying);
  const badDebtUsd = parseFiniteNumber(marketBadDebt?.usd);
  const marketWarnings = parseWarnings(market?.warnings);
  const marketAssetMatchesVault = typeof marketLoanAsset?.address === 'string'
    && marketLoanAsset.address.toLowerCase() === ARC_MAINNET_MORPHO_ASSET.toLowerCase()
    && marketLoanAsset.decimals === 6;

  if (marketTimestamp === null || marketBlock === null) {
    return unavailableSnapshot(retrievedAt, 'Official Morpho response has no valid underlying market state block and timestamp.', 'UNAVAILABLE', {
      sourceHeadBlockNumber: headNumber.toString(),
      sourceHeadBlockTimestamp: headTimestamp.toString(),
    });
  }
  const marketStateAgeSeconds = retrievedAtSeconds - Number(marketTimestamp);
  if (!Number.isSafeInteger(marketStateAgeSeconds) || marketStateAgeSeconds < 0 || marketTimestamp > headTimestamp || marketBlock > headNumber) {
    return unavailableSnapshot(retrievedAt, 'Official Morpho underlying-market state timestamp is malformed or in the future.', 'UNAVAILABLE', {
      blockNumber: marketBlock.toString(),
      blockTimestamp: marketTimestamp.toString(),
      sourceHeadBlockNumber: headNumber.toString(),
      sourceHeadBlockTimestamp: headTimestamp.toString(),
    });
  }

  const invalidVaultNumbers = totalAssets === null
    || totalAssets === 0n
    || availableLiquidity === null
    || apy === null
    || (idleAssets !== null && idleAssets > totalAssets);
  const validUtilization = marketUtilization !== null && marketUtilization >= 0 && marketUtilization <= 1;
  const marketWarningsValid = marketWarnings !== null;
  const unavailableData: string[] = [];
  if (totalAssets === null || totalAssets === 0n) unavailableData.push('Vault total assets are missing, zero, or malformed in the Morpho response.');
  if (availableLiquidity === null) unavailableData.push('Vault available liquidity for withdrawal is missing or malformed in the Morpho response.');
  if (apy === null) unavailableData.push('Vault APY is missing or malformed in the Morpho response.');
  if (totalSupply === null) unavailableData.push('Vault total share supply is missing or malformed in the Morpho response.');
  if (idleAssets === null) unavailableData.push('Vault idle assets are missing or malformed in the Morpho response.');
  if (netApy === null) unavailableData.push('Vault net APY is missing or malformed in the Morpho response.');
  if (vaultWarnings === null) unavailableData.push('Vault warning data is missing or malformed in the Morpho response.');
  if (!validTimelocks) unavailableData.push('Vault timelock data is missing or malformed in the Morpho response.');
  if (depositGateStatus === null) unavailableData.push('Vault receive-assets gate configuration is missing or malformed in the Morpho response.');
  if (underlyingLiquidity === null) unavailableData.push('Underlying market liquidity is missing or malformed in the Morpho response.');
  if (!validUtilization) unavailableData.push('Underlying market utilization is missing, malformed, or outside the valid 0–1 ratio.');
  if (lltv === null) unavailableData.push('Underlying market LLTV is missing or malformed in the Morpho response.');
  if (marketOracle === null || typeof marketOracle.address !== 'string' || typeof marketOracle.type !== 'string') {
    unavailableData.push('Underlying market oracle identity is missing or malformed in the Morpho response.');
  }
  if (badDebt === null) unavailableData.push('Underlying market bad-debt indicator is missing or malformed in the Morpho response.');
  if (!marketWarningsValid) unavailableData.push('Underlying market warning data is missing or malformed in the Morpho response.');
  if (typeof market?.marketId !== 'string') unavailableData.push('Underlying market ID is missing or malformed in the Morpho response.');
  if (asRecord(market?.chain)?.id !== ARC_MAINNET_CHAIN_ID) unavailableData.push('Underlying market chain ID is missing or does not match Arc Mainnet.');
  if (!marketAssetMatchesVault) unavailableData.push('Underlying market loan asset is missing or does not match the configured six-decimal USDC asset.');
  if (liquidityData?.__typename !== 'MarketV1LiquidityData') {
    unavailableData.push(`Market allocation detail is unavailable for Morpho liquidity-data type ${String(liquidityData?.__typename ?? 'UNKNOWN')}.`);
  } else {
    unavailableData.push('Vault-specific allocated amount per underlying market is not exposed by this MarketV1 liquidity-data response.');
  }
  unavailableData.push('Actual deposit availability and a liquidation-risk assessment are not established by the returned gate configuration and market state.');

  const isAvailable = !invalidVaultNumbers
    && market?.chain !== null
    && asRecord(market?.chain)?.id === ARC_MAINNET_CHAIN_ID
    && underlyingLiquidity !== null
    && validUtilization
    && marketAssetMatchesVault
    && typeof market?.marketId === 'string'
    && marketLoanAsset !== null;

  if (!isAvailable) {
    return {
      ...unavailableSnapshot(retrievedAt, `Official Morpho data for required vault or underlying-market fields is missing or malformed: ${unavailableData.join(' ')}`),
      identityVerified: true,
      freshness: {
        status: 'CURRENT',
        blockNumber: headNumber.toString(),
        blockTimestamp: headTimestamp.toString(),
        retrievedAt,
        ageSeconds: marketAgeSeconds,
        maximumAgeSeconds: MARKET_SNAPSHOT_MAX_AGE_SECONDS,
        sourceHeadBlockNumber: headNumber.toString(),
        sourceHeadBlockTimestamp: headTimestamp.toString(),
      },
      unavailableData,
    };
  }

  const snapshot: SteakhouseMarketSnapshot = {
    ...unavailableSnapshot(retrievedAt, 'Current official Morpho GraphQL data verified for the exact Arc Mainnet vault and linked market.'),
    source: 'MORPHO_GRAPHQL',
    status: 'PARTIAL',
    identityVerified: true,
    freshness: {
      status: 'CURRENT',
      blockNumber: headNumber.toString(),
      blockTimestamp: headTimestamp.toString(),
      retrievedAt,
      ageSeconds: marketAgeSeconds,
      maximumAgeSeconds: MARKET_SNAPSHOT_MAX_AGE_SECONDS,
      sourceHeadBlockNumber: headNumber.toString(),
      sourceHeadBlockTimestamp: headTimestamp.toString(),
    },
    vault: {
      totalAssets: morphoValue(totalAssets!.toString(), 'USDC_BASE_UNITS'),
      availableLiquidity: morphoValue(availableLiquidity!.toString(), 'USDC_BASE_UNITS'),
      idleLiquidity: idleAssets === null
        ? unavailable('USDC_BASE_UNITS')
        : morphoValue(idleAssets.toString(), 'USDC_BASE_UNITS'),
      utilizationBps: unavailable('BPS'),
      totalSupply: totalSupply === null
        ? unavailable('SHARES')
        : morphoValue(totalSupply.toString(), 'SHARES'),
      apy: morphoValue(String(apy), 'RATIO'),
      netApy: netApy === null
        ? unavailable('RATIO')
        : morphoValue(String(netApy), 'RATIO'),
      allocation: unavailable('UNAVAILABLE'),
      depositAvailability: unavailable('UNAVAILABLE'),
      depositGateStatus: depositGateStatus === null
        ? unavailable('GATE_CONFIG')
        : morphoValue(depositGateStatus, 'GATE_CONFIG'),
      timelock: !validTimelocks
        ? unavailable('JSON_TIMELOCKS')
        : morphoValue(JSON.stringify(timelocks!.filter((item) => {
        const record = asRecord(item);
        return record?.abdicatedAt === null;
      }).map((item) => {
        const record = asRecord(item)!;
        return { functionName: record.functionName, durationSeconds: String(record.duration) };
      })), 'JSON_TIMELOCKS'),
      warnings: vaultWarnings === null
        ? unavailable('NONE')
        : morphoValue(vaultWarnings, 'NONE'),
    },
    underlyingMarket: {
      allocation: unavailable('UNAVAILABLE'),
      liquidity: morphoValue(underlyingLiquidity!.toString(), 'USDC_BASE_UNITS'),
      utilizationBps: morphoValue(Math.round(marketUtilization! * 10_000), 'BPS'),
      collateralExposure: collateralExposure === null
        ? unavailable('COLLATERAL_BASE_UNITS')
        : morphoValue(collateralExposure.toString(), 'COLLATERAL_BASE_UNITS'),
      lltv: lltv === null
        ? unavailable('WAD')
        : morphoValue(lltv.toString(), 'WAD'),
      oracleStatus: marketOracle === null
        || typeof marketOracle.address !== 'string'
        || typeof marketOracle.type !== 'string'
        ? unavailable('ORACLE_IDENTITY')
        : morphoValue(`${marketOracle.type} at ${marketOracle.address}`, 'ORACLE_IDENTITY'),
      badDebtStatus: badDebt === null
        ? unavailable('MORPHO_BAD_DEBT_REPORT')
        : morphoValue(
          badDebt === 0n
            ? `Morpho reports no bad debt (${badDebt.toString()} underlying base units${badDebtUsd === null ? '' : `; ${badDebtUsd} USD`}).`
            : `Morpho reports ${badDebt.toString()} underlying base units of bad debt${badDebtUsd === null ? '' : ` (${badDebtUsd} USD)`}.`,
          'MORPHO_BAD_DEBT_REPORT',
        ),
      liquidationRisk: unavailable('UNAVAILABLE'),
      warnings: marketWarningsValid
        ? morphoValue(marketWarnings!, 'NONE')
        : unavailable('NONE'),
      marketId: typeof market?.marketId === 'string' ? morphoValue(market.marketId, 'MARKET_ID') : unavailable('MARKET_ID'),
      stateBlockNumber: morphoValue(marketBlock.toString(), 'BLOCK'),
      stateTimestamp: morphoValue(marketTimestamp.toString(), 'UNIX_SECONDS'),
      collateralAssetAddress: typeof collateralAsset?.address === 'string'
        ? morphoValue(collateralAsset.address, 'ADDRESS')
        : unavailable('ADDRESS'),
      collateralAssetDecimals: typeof collateralAsset?.decimals === 'number'
        && Number.isSafeInteger(collateralAsset.decimals)
        ? morphoValue(collateralAsset.decimals, 'DECIMALS')
        : unavailable('DECIMALS'),
    },
    unavailableData,
  };
  return snapshot;
}

async function readVerifiedArcVaultSnapshot(
  projection: AdminAiInput,
  client: CoreStateClient,
  now: Date,
): Promise<SteakhouseMarketSnapshot> {
  const retrievedAt = now.toISOString();
  const unavailableResult = (reason: string) => unavailableSnapshot(retrievedAt, reason);
  if (projection.chainId !== ARC_MAINNET_CHAIN_ID) {
    return unavailableResult('Admin projection is not on Arc Mainnet (chain 5042).');
  }

  try {
    const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    if (chainId !== ARC_MAINNET_CHAIN_ID) {
      return unavailableResult('Arc RPC connected to a chain other than Arc Mainnet (chain 5042).');
    }
    const block = await client.getBlock({ blockNumber });
    const [assetAddress, totalAssets, totalSupply, availableLiquidity, depositAvailability] = await Promise.all([
      client.readContract({ address: ARC_MAINNET_STEAKHOUSE_VAULT, abi: ERC4626_READ_ABI, functionName: 'asset', blockNumber }),
      client.readContract({ address: ARC_MAINNET_STEAKHOUSE_VAULT, abi: ERC4626_READ_ABI, functionName: 'totalAssets', blockNumber }).catch(() => null),
      client.readContract({ address: ARC_MAINNET_STEAKHOUSE_VAULT, abi: ERC4626_READ_ABI, functionName: 'totalSupply', blockNumber }).catch(() => null),
      client.readContract({
        address: ARC_MAINNET_STEAKHOUSE_VAULT,
        abi: ERC4626_READ_ABI,
        functionName: 'maxWithdraw',
        args: [ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress],
        blockNumber,
      }).catch(() => null),
      client.readContract({
        address: ARC_MAINNET_STEAKHOUSE_VAULT,
        abi: ERC4626_READ_ABI,
        functionName: 'maxDeposit',
        args: [ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress],
        blockNumber,
      }).catch(() => null),
    ]);
    const timestamp = Number(block.timestamp);
    const ageSeconds = Math.floor(now.getTime() / 1000) - timestamp;
    if (assetAddress.toLowerCase() !== ARC_MAINNET_MORPHO_ASSET.toLowerCase()) {
      return unavailableResult('Arc RPC vault asset() does not match the configured Arc USDC asset.');
    }
    if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(ageSeconds) || ageSeconds < 0) {
      return unavailableResult('Arc RPC returned an invalid or future block timestamp.');
    }
    if (ageSeconds > MARKET_SNAPSHOT_MAX_AGE_SECONDS) {
      return unavailableResult('Arc RPC head block is stale and cannot support a current market recommendation.');
    }
    if (typeof totalAssets !== 'bigint' || totalAssets <= 0n) {
      return unavailableResult('Arc RPC could not verify positive ERC-4626 totalAssets for the configured vault.');
    }

    const base = unavailableSnapshot(retrievedAt, 'Arc RPC supplies live vault state; APY and underlying-market risk remain unavailable.');
    const rpcNumber = (value: unknown) => typeof value === 'bigint' && value >= 0n ? value.toString() : null;
    return {
      ...base,
      source: 'ARC_MAINNET_RPC',
      status: 'PARTIAL',
      identityVerified: true,
      freshness: {
        status: 'CURRENT',
        blockNumber: blockNumber.toString(),
        blockTimestamp: String(timestamp),
        retrievedAt,
        ageSeconds,
        maximumAgeSeconds: MARKET_SNAPSHOT_MAX_AGE_SECONDS,
        sourceHeadBlockNumber: blockNumber.toString(),
        sourceHeadBlockTimestamp: String(timestamp),
      },
      vault: {
        ...base.vault,
        totalAssets: arcRpcValue(totalAssets.toString(), 'USDC_BASE_UNITS'),
        totalSupply: rpcNumber(totalSupply) === null
          ? unavailable('SHARES')
          : arcRpcValue(rpcNumber(totalSupply)!, 'SHARES'),
        availableLiquidity: rpcNumber(availableLiquidity) === null
          ? unavailable('USDC_BASE_UNITS')
          : arcRpcValue(rpcNumber(availableLiquidity)!, 'USDC_BASE_UNITS'),
        depositAvailability: rpcNumber(depositAvailability) === null
          ? unavailable('USDC_BASE_UNITS')
          : arcRpcValue(rpcNumber(depositAvailability)!, 'USDC_BASE_UNITS'),
      },
      underlyingMarket: {
        ...base.underlyingMarket,
        stateBlockNumber: arcRpcValue(blockNumber.toString(), 'BLOCK'),
        stateTimestamp: arcRpcValue(String(timestamp), 'UNIX_SECONDS'),
      },
      unavailableData: [
        'Arc RPC maxWithdraw is scoped to the configured Steakhouse Adapter and is not a claim about total vault or underlying-market liquidity.',
        'Vault APY, net APY, Morpho utilization, collateral/oracle status, bad debt, and market allocation are unavailable from the verified Arc RPC reads.',
      ],
    };
  } catch {
    return unavailableResult('Arc RPC could not provide a current, identity-verified ERC-4626 snapshot for the configured Steakhouse vault.');
  }
}

function isAvailable<T>(value: VerifiedMarketValue<T>): boolean {
  return value.availability === 'AVAILABLE' && value.value !== null;
}

function mergeVerifiedSnapshots(
  morpho: SteakhouseMarketSnapshot,
  arc: SteakhouseMarketSnapshot,
): SteakhouseMarketSnapshot {
  if (morpho.status !== 'PARTIAL' || morpho.freshness.status !== 'CURRENT' || !morpho.identityVerified) return arc;
  if (arc.status !== 'PARTIAL' || arc.freshness.status !== 'CURRENT' || !arc.identityVerified) return morpho;
  const select = <T>(morphoValue: VerifiedMarketValue<T>, arcValue: VerifiedMarketValue<T>) =>
    isAvailable(morphoValue) ? morphoValue : arcValue;
  return {
    ...morpho,
    source: 'MULTIPLE_VERIFIED_SOURCES',
    freshness: morpho.freshness,
    vault: {
      ...morpho.vault,
      totalAssets: select(morpho.vault.totalAssets, arc.vault.totalAssets),
      totalSupply: select(morpho.vault.totalSupply, arc.vault.totalSupply),
      availableLiquidity: select(morpho.vault.availableLiquidity, arc.vault.availableLiquidity),
      depositAvailability: select(morpho.vault.depositAvailability, arc.vault.depositAvailability),
    },
    underlyingMarket: {
      ...morpho.underlyingMarket,
      stateBlockNumber: select(
        morpho.underlyingMarket.stateBlockNumber ?? unavailable('BLOCK'),
        arc.underlyingMarket.stateBlockNumber ?? unavailable('BLOCK'),
      ),
      stateTimestamp: select(
        morpho.underlyingMarket.stateTimestamp ?? unavailable('UNIX_SECONDS'),
        arc.underlyingMarket.stateTimestamp ?? unavailable('UNIX_SECONDS'),
      ),
    },
    unavailableData: [...new Set([...morpho.unavailableData, ...arc.unavailableData])],
  };
}

export async function readVerifiedSteakhouseMarketSnapshot(
  projection: AdminAiInput,
  fetcher: MorphoFetcher = fetch,
  now = new Date(),
  rpcClient?: CoreStateClient,
): Promise<SteakhouseMarketSnapshot> {
  const morpho = await readVerifiedMorphoMarketSnapshot(projection, fetcher, now);
  if (!rpcClient || projection.chainId !== ARC_MAINNET_CHAIN_ID) return morpho;
  const arc = await readVerifiedArcVaultSnapshot(projection, rpcClient, now);
  return mergeVerifiedSnapshots(morpho, arc);
}
