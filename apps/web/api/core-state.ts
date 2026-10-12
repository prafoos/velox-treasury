import 'dotenv/config';

import { createPublicClient, defineChain, getAddress, http, isAddress, type Address, type PublicClient } from 'viem';
import { ARC_MAINNET_CHAIN_ID as CONFIGURED_ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS, usdcReadAbi } from '../src/contracts/usdc';
import { ARC_MAINNET_EXECUTION_CONFIG } from '../../api/src/config/arc-mainnet.js';
import {
  AUTOMATION_ROLE,
  EMERGENCY_ROLE,
  POLICY_ADMIN_ROLE,
  TIMELOCK_EXECUTOR_ROLE,
} from '../src/contracts/treasury';
import type { UserFinancialProjectionModel } from '../src/types/userFinancialProjection';
import {
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  WalletAuthError,
  type WalletAuthRequest,
} from '../server/wallet-auth';

export const ARC_MAINNET_CHAIN_ID = CONFIGURED_ARC_MAINNET_CHAIN_ID;
export const ARC_MAINNET_CORE_ADDRESS = ARC_MAINNET_EXECUTION_CONFIG.coreAddress;
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS = ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress;

export const coreStateAbi = [
  {
    type: 'function', name: 'paused', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'userBalance', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'userStrategyPosition', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }, { name: 'strategy', type: 'address' }],
    outputs: [{ name: 'shares', type: 'uint256' }, { name: 'position', type: 'uint256' }],
  },
  {
    type: 'function', name: 'userFinancialState', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [
      { name: 'principal', type: 'uint256' },
      { name: 'currentValue', type: 'uint256' },
      { name: 'unrealizedPnl', type: 'int256' },
      { name: 'realizedPnl', type: 'int256' },
      { name: 'totalPnl', type: 'int256' },
      { name: 'immediatelyWithdrawableValue', type: 'uint256' },
    ] }],
  },
  {
    type: 'function', name: 'immediatelyWithdrawableValue', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalUserLiabilities', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'liquidUSDC', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'requiredLiquidReserve', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'availableLiquidity', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalDeployed', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalManagedAssets', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'approvedProtocolCount', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'approvedAssetCount', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'approvedStrategyCount', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'riskPolicy', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'minimumLiquidReserve', type: 'uint256' },
      { name: 'minimumLiquidReserveBps', type: 'uint16' },
      { name: 'maximumTotalDeployed', type: 'uint256' },
    ] }],
  },
  {
    type: 'function', name: 'TIMELOCK_DELAY', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function', name: 'valuationFreshnessBlocks', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'bucketPolicy', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'liquidOperationalReserveBps', type: 'uint16' },
      { name: 'yieldStrategyBufferBps', type: 'uint16' },
      { name: 'sweepLiquidityBufferBps', type: 'uint16' },
      { name: 'automationAgentPoolBps', type: 'uint16' },
    ] }],
  },
  {
    type: 'function', name: 'bucketTargets', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'liquidOperationalReserve', type: 'uint256' },
      { name: 'yieldStrategyBuffer', type: 'uint256' },
      { name: 'sweepLiquidityBuffer', type: 'uint256' },
      { name: 'automationAgentPool', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'yieldStrategyBufferCapacity', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'liquidBucketClassifications', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'liquidOperationalReserve', type: 'uint256' },
      { name: 'sweepLiquidityBuffer', type: 'uint256' },
      { name: 'automationAgentPool', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'protocolCaps', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'assetCaps', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'protocolExposure', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'assetExposure', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'protocolVaults', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'hasRole', stateMutability: 'view',
    inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const arcMainnetServerChain = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

type UnavailableCoreRead = {
  unavailable: true;
  functionName: string;
  error: string;
};

function isUnavailableCoreRead(value: unknown): value is UnavailableCoreRead {
  return value !== null && typeof value === 'object' && 'unavailable' in value && (value as { unavailable?: unknown }).unavailable === true;
}

export type CoreStateClient = Pick<PublicClient, 'readContract' | 'getBlockNumber' | 'getChainId' | 'getBlock'>;

interface CoreStateRequest extends WalletAuthRequest {}

interface CoreStateResponse {
  status(code: number): CoreStateResponse;
  setHeader(name: string, value: string): CoreStateResponse;
  json(body: unknown): void;
  end(): void;
}

export function serializeApiData(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeApiData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeApiData(nested)]));
  }
  return value;
}

export function resolveUserAccount(authenticatedAddress: Address, requestedAccount: unknown): Address {
  if (requestedAccount === undefined) return authenticatedAddress;
  if (typeof requestedAccount !== 'string' || !isAddress(requestedAccount, { strict: false })) {
    throw new WalletAuthError(400, 'Invalid account address.');
  }
  const canonicalRequested = getAddress(requestedAccount.toLowerCase() as Address);
  if (canonicalRequested.toLowerCase() !== authenticatedAddress.toLowerCase()) {
    throw new WalletAuthError(403, 'Requested account does not match the authenticated wallet.');
  }
  return authenticatedAddress;
}

export async function assertArcMainnetRpcChain(client: Pick<CoreStateClient, 'getChainId'>): Promise<void> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    throw new Error('Unable to verify the RPC chain ID; Arc Mainnet state is unavailable.');
  }
  if (!Number.isSafeInteger(chainId) || chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`RPC chain ID must be ${ARC_MAINNET_CHAIN_ID}; Arc Mainnet state is unavailable.`);
  }
}

export async function readUserProjection(client: CoreStateClient, account: Address): Promise<UserFinancialProjectionModel> {
  await assertArcMainnetRpcChain(client);
  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    throw new Error('Unable to determine the Arc Mainnet read block; user financial state is unavailable.');
  }

  const [userBalanceResult, financialStateResult, immediateWithdrawalResult, pausedResult, walletUSDCResult] = await Promise.all([
    readOptionalContract<bigint>(client, 'userBalance', [account], blockNumber),
    readOptionalContract<{
      principal: bigint;
      currentValue: bigint;
      unrealizedPnl: bigint;
      realizedPnl: bigint;
      totalPnl: bigint;
      immediatelyWithdrawableValue: bigint | null;
    }>(client, 'userFinancialState', [account], blockNumber),
    readOptionalContract<bigint>(client, 'immediatelyWithdrawableValue', [account], blockNumber),
    readOptionalContract<boolean>(client, 'paused', [], blockNumber),
    client.readContract({ address: ARC_USDC_CONTRACT_ADDRESS, abi: usdcReadAbi, functionName: 'balanceOf', args: [account], blockNumber })
      .catch(() => null),
  ]);

  const financialState = isUnavailableCoreRead(financialStateResult) || financialStateResult === null
    ? null
    : {
        principal: financialStateResult.principal,
        currentValue: financialStateResult.currentValue,
        unrealizedPnl: financialStateResult.unrealizedPnl,
        realizedPnl: financialStateResult.realizedPnl,
        totalPnl: financialStateResult.totalPnl,
      };
  const immediateWithdrawalValue = isUnavailableCoreRead(immediateWithdrawalResult)
    || typeof immediateWithdrawalResult !== 'bigint'
    ? null
    : immediateWithdrawalResult;
  const immediateWithdrawalAvailable = financialState !== null
    && immediateWithdrawalValue !== null
    && pausedResult === false;

  return {
    scope: 'USER',
    authenticatedWalletAddress: account,
    chainId: ARC_MAINNET_CHAIN_ID,
    walletUSDC: typeof walletUSDCResult === 'bigint' ? walletUSDCResult : null,
    userBalance: typeof userBalanceResult === 'bigint' ? userBalanceResult : null,
    treasuryFinancialState: financialState,
    publicOperationalStatus: {
      paused: typeof pausedResult === 'boolean' ? pausedResult : null,
      blockNumber: typeof blockNumber === 'bigint' ? blockNumber : null,
    },
    immediateWithdrawalLiquidity: {
      source: financialState === null || immediateWithdrawalValue === null || typeof pausedResult !== 'boolean' ? 'UNAVAILABLE' : 'CORE',
      availability: immediateWithdrawalAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      status: financialState === null || immediateWithdrawalValue === null || typeof pausedResult !== 'boolean'
        ? 'UNAVAILABLE'
        : pausedResult
          ? 'PAUSED'
          : immediateWithdrawalValue < financialState.currentValue ? 'CONSTRAINED' : 'AVAILABLE',
      unit: 'USDC_BASE_UNITS',
      value: immediateWithdrawalAvailable ? immediateWithdrawalValue : null,
    },
    fieldMetadata: {
      walletUSDC: {
        source: 'TOKEN_CONTRACT',
        availability: typeof walletUSDCResult === 'bigint' ? 'AVAILABLE' : 'UNAVAILABLE',
        unit: 'USDC_BASE_UNITS',
          zeroMeaning: typeof walletUSDCResult === 'bigint' ? 'AUTHORITATIVE_ZERO' : 'UNAVAILABLE',
      },
      userBalance: {
        source: 'CORE',
        availability: typeof userBalanceResult === 'bigint' ? 'AVAILABLE' : 'UNAVAILABLE',
        unit: 'USDC_BASE_UNITS',
          zeroMeaning: typeof userBalanceResult === 'bigint' ? 'AUTHORITATIVE_ZERO' : 'UNAVAILABLE',
      },
      treasuryFinancialState: {
        source: 'CORE',
        availability: financialState === null ? 'UNAVAILABLE' : 'AVAILABLE',
        unit: 'NONE',
        zeroMeaning: 'NOT_APPLICABLE',
      },
      principal: {
        source: 'CORE',
        availability: financialState?.principal == null ? 'UNAVAILABLE' : 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        zeroMeaning: financialState?.principal == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
      },
      currentValue: {
        source: 'CORE',
        availability: financialState?.currentValue == null ? 'UNAVAILABLE' : 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        zeroMeaning: financialState?.currentValue == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
      },
      unrealizedPnl: {
        source: 'CORE',
        availability: financialState?.unrealizedPnl == null ? 'UNAVAILABLE' : 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        zeroMeaning: financialState?.unrealizedPnl == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
      },
      realizedPnl: {
        source: 'CORE',
        availability: financialState?.realizedPnl == null ? 'UNAVAILABLE' : 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        zeroMeaning: financialState?.realizedPnl == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
      },
      totalPnl: {
        source: 'CORE',
        availability: financialState?.totalPnl == null ? 'UNAVAILABLE' : 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        zeroMeaning: financialState?.totalPnl == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
      },
      immediateWithdrawalLiquidity: {
        source: immediateWithdrawalValue === null || typeof pausedResult !== 'boolean' ? 'UNAVAILABLE' : 'CORE',
        availability: immediateWithdrawalAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
        unit: 'USDC_BASE_UNITS',
        zeroMeaning: immediateWithdrawalAvailable ? 'AUTHORITATIVE_ZERO' : 'UNAVAILABLE',
      },
      paused: {
        source: 'CORE',
        availability: typeof pausedResult === 'boolean' ? 'AVAILABLE' : 'UNAVAILABLE',
        unit: 'BOOLEAN',
          zeroMeaning: typeof pausedResult === 'boolean' ? 'NOT_APPLICABLE' : 'UNAVAILABLE',
      },
      blockNumber: {
        source: 'CORE',
        availability: typeof blockNumber === 'bigint' ? 'AVAILABLE' : 'UNAVAILABLE',
        unit: 'BLOCK',
          zeroMeaning: typeof blockNumber === 'bigint' ? 'AUTHORITATIVE_ZERO' : 'UNAVAILABLE',
      },
    },
  };
}

function getAccount(request: CoreStateRequest): Address | undefined {
  const account = request.query?.account;
  if (account === undefined) return undefined;
  if (typeof account !== 'string' || !isAddress(account)) {
    throw new Error('Invalid account address.');
  }
  return account;
}

export function createServerClient(): CoreStateClient {
  const rpcUrl = process.env.ARC_MAINNET_RPC_URL;
  if (!rpcUrl) throw new Error('RPC configuration is unavailable.');
  return createPublicClient({ chain: arcMainnetServerChain, transport: http(rpcUrl) });
}

export async function readOptionalContract<T>(
  client: CoreStateClient,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<T | UnavailableCoreRead> {
  try {
    return await client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: coreStateAbi as any,
      functionName: functionName as any,
      args: args as any,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Optional Core getter failed: ${functionName}`, message);
    return {
      unavailable: true,
      functionName,
      error: message,
    };
  }
}

export async function readCoreState(client: CoreStateClient, account?: Address) {
  await assertArcMainnetRpcChain(client);
  const [paused, userBalance, userFinancialStateResult, immediateWithdrawalResult, totalUserLiabilities, liquidUSDC, requiredLiquidReserve, availableLiquidity, totalDeployed, totalManagedAssets, approvedProtocolCount, approvedAssetCount, approvedStrategyCount, riskPolicyResult, bucketPolicyResult, bucketTargetsResult, yieldStrategyBufferCapacityResult, liquidBucketClassificationsResult, policyAdmin, timelockExecutor, automation, emergency, blockNumber] = await Promise.all([
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'paused' }),
    account ? client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'userBalance', args: [account] }) : Promise.resolve(null),
    account ? readOptionalContract<{
      principal: bigint;
      currentValue: bigint;
      unrealizedPnl: bigint;
      realizedPnl: bigint;
      totalPnl: bigint;
      immediatelyWithdrawableValue: bigint;
    }>(client, 'userFinancialState', [account]) : Promise.resolve(null),
    account ? readOptionalContract<bigint>(client, 'immediatelyWithdrawableValue', [account]) : Promise.resolve(null),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'totalUserLiabilities' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'liquidUSDC' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'requiredLiquidReserve' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'availableLiquidity' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'totalDeployed' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'totalManagedAssets' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'approvedProtocolCount' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'approvedAssetCount' }),
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'approvedStrategyCount' }),
    readOptionalContract<{
      minimumLiquidReserve: bigint;
      minimumLiquidReserveBps: number;
      maximumTotalDeployed: bigint;
    }>(client, 'riskPolicy'),
    readOptionalContract<{
      liquidOperationalReserveBps: bigint;
      yieldStrategyBufferBps: bigint;
      sweepLiquidityBufferBps: bigint;
      automationAgentPoolBps: bigint;
    }>(client, 'bucketPolicy'),
    readOptionalContract<readonly bigint[]>(client, 'bucketTargets'),
    readOptionalContract<bigint>(client, 'yieldStrategyBufferCapacity'),
    readOptionalContract<readonly bigint[]>(client, 'liquidBucketClassifications'),
    account ? client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'hasRole', args: [POLICY_ADMIN_ROLE, account] }) : Promise.resolve(false),
    account ? client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'hasRole', args: [TIMELOCK_EXECUTOR_ROLE, account] }) : Promise.resolve(false),
    account ? client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'hasRole', args: [AUTOMATION_ROLE, account] }) : Promise.resolve(false),
    account ? client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: coreStateAbi, functionName: 'hasRole', args: [EMERGENCY_ROLE, account] }) : Promise.resolve(false),
    'getBlockNumber' in client ? client.getBlockNumber().catch(() => null) : Promise.resolve(null),
  ]);

  const immediatelyWithdrawableValue = typeof immediateWithdrawalResult === 'bigint'
    ? immediateWithdrawalResult
    : null;
  const userFinancialState = isUnavailableCoreRead(userFinancialStateResult)
    ? userFinancialStateResult
    : userFinancialStateResult
      ? { ...userFinancialStateResult, immediatelyWithdrawableValue }
      : null;
  const riskPolicy = isUnavailableCoreRead(riskPolicyResult)
    ? riskPolicyResult
    : (riskPolicyResult ?? {
        unavailable: true,
        functionName: 'riskPolicy',
        error: 'Risk policy is unavailable.',
      });
  const bucketPolicy = isUnavailableCoreRead(bucketPolicyResult)
    ? bucketPolicyResult
    : (bucketPolicyResult ?? {
        unavailable: true,
        functionName: 'bucketPolicy',
        error: 'Bucket policy is unavailable.',
      });
  const bucketTargets = isUnavailableCoreRead(bucketTargetsResult)
    ? bucketTargetsResult
    : (bucketTargetsResult ?? {
        unavailable: true,
        functionName: 'bucketTargets',
        error: 'Bucket targets are unavailable.',
      });
  const yieldStrategyBufferCapacity = isUnavailableCoreRead(yieldStrategyBufferCapacityResult)
    ? yieldStrategyBufferCapacityResult
    : (yieldStrategyBufferCapacityResult ?? {
        unavailable: true,
        functionName: 'yieldStrategyBufferCapacity',
        error: 'Yield strategy buffer capacity is unavailable.',
      });
  const liquidBucketClassifications = isUnavailableCoreRead(liquidBucketClassificationsResult)
    ? liquidBucketClassificationsResult
    : (liquidBucketClassificationsResult ?? {
        unavailable: true,
        functionName: 'liquidBucketClassifications',
        error: 'Liquid bucket classifications are unavailable.',
      });

  return {
    chainId: ARC_MAINNET_CHAIN_ID,
    coreAddress: ARC_MAINNET_CORE_ADDRESS,
    paused,
    userBalance,
    userFinancialState,
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
    bucketPolicy,
    bucketTargets,
    yieldStrategyBufferCapacity,
    liquidBucketClassifications,
    blockNumber,
    roles: { policyAdmin, timelockExecutor, automation, emergency },
  };
}

export async function handleCoreStateRequest(
  request: CoreStateRequest,
  response: CoreStateResponse,
  clientFactory: () => CoreStateClient = createServerClient,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let authenticatedAddress: Address;
  try {
    authenticatedAddress = requireAuthenticatedWallet(request).authenticatedWalletAddress;
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  let account: Address;
  try {
    account = resolveUserAccount(authenticatedAddress, request.query?.account);
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  try {
    const state = await readUserProjection(clientFactory(), account);
    response.status(200).json(serializeApiData(state));
  } catch {
    response.status(500).json({ error: 'User financial state is temporarily unavailable.' });
  }
}

export default function handler(request: CoreStateRequest, response: CoreStateResponse): Promise<void> {
  return handleCoreStateRequest(request, response);
}