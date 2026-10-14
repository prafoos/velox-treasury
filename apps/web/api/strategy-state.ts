import 'dotenv/config';

import { createPublicClient, defineChain, http, type Address, type PublicClient } from 'viem';
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_CORE_ADDRESS,
  ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
  assertArcMainnetRpcChain,
  coreStateAbi,
  resolveUserAccount,
  type CoreStateClient,
} from './core-state.js';
import {
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  type WalletAuthRequest,
} from '../server/wallet-auth.js';

const strategyStateAbi = [
  {
    type: 'function', name: 'totalDeployed', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'valuationFreshnessBlocks', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'strategies', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'protocol', type: 'bytes32' },
      { name: 'asset', type: 'address' },
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'principal', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'position', type: 'uint256' },
      { name: 'realizedYield', type: 'uint256' },
      { name: 'realizedLoss', type: 'uint256' },
      { name: 'feesAccrued', type: 'uint256' },
      { name: 'withdrawalShortfall', type: 'uint256' },
      { name: 'lastValuationBlock', type: 'uint256' },
      { name: 'valuationSource', type: 'address' },
      { name: 'valuationStatus', type: 'uint8' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
] as const;

const arcMainnetServerChain = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

type StrategyStateClient = Pick<PublicClient, 'readContract' | 'getChainId' | 'getBlockNumber'>;

export interface PersonalStrategyStatus {
  readonly reason:
    | 'POSITION_AVAILABLE'
    | 'CORE_PAUSED'
    | 'STRATEGY_NOT_APPROVED'
    | 'STRATEGY_DISABLED'
    | 'VALUATION_UNAVAILABLE'
    | 'VALUATION_STALE'
    | 'VALUATION_IMPAIRED'
    | 'APPROVED_ENABLED_NO_POSITION'
    | 'UNKNOWN';
  readonly approved: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly valuationStatus: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'IMPAIRED' | 'UNKNOWN';
  readonly positionShares: bigint;
  readonly positionValue: bigint;
  readonly valuationBlock: bigint;
  readonly verifiedAtBlock: bigint;
}

interface StrategyStateRequest extends WalletAuthRequest {}

interface StrategyStateResponse {
  status(code: number): StrategyStateResponse;
  setHeader(name: string, value: string): StrategyStateResponse;
  json(body: unknown): void;
}

function createServerClient(): StrategyStateClient {
  const rpcUrl = process.env.ARC_MAINNET_RPC_URL;
  if (!rpcUrl) throw new Error('RPC configuration is unavailable.');
  return createPublicClient({ chain: arcMainnetServerChain, transport: http(rpcUrl) });
}

function statusLabel(
  value: number,
  valuationBlock: bigint,
  freshnessBlocks: bigint,
  currentBlock: bigint,
): 'unavailable' | 'current' | 'stale' | 'impaired' | 'unknown' {
  if (value === 1 && (
    freshnessBlocks === 0n
    || currentBlock > valuationBlock + freshnessBlocks
  )) return 'stale';
  if (value === 0) return 'unavailable';
  if (value === 1) return 'current';
  if (value === 2) return 'stale';
  if (value === 3) return 'impaired';
  return 'unknown';
}

export async function readStrategyState(client: StrategyStateClient, strategy: Address) {
  const currentBlock = await client.getBlockNumber();
  const [totalDeployed, state, freshnessBlocks] = await Promise.all([
    client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, abi: strategyStateAbi, functionName: 'totalDeployed', blockNumber: currentBlock }),
    client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: strategyStateAbi,
      functionName: 'strategies',
      args: [strategy],
      blockNumber: currentBlock,
    }),
    client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: strategyStateAbi,
      functionName: 'valuationFreshnessBlocks',
      blockNumber: currentBlock,
    }),
  ]);
  const valuationStatus = Number(state[13]);
  const valuationBlock = state[11];
  const principal = state[4];
  const currentValue = state[6];

  return {
    chainId: ARC_MAINNET_CHAIN_ID,
    coreAddress: ARC_MAINNET_CORE_ADDRESS,
    strategyAddress: strategy,
    strategyLabel: strategy,
    protocolLabel: state[0],
    protocol: state[0],
    asset: state[1],
    absoluteCap: state[2],
    relativeCapBps: state[3],
    principal,
    shares: state[5],
    currentValue,
    realizedYield: state[7],
    realizedLoss: state[8],
    withdrawalShortfall: state[10],
    feesAccrued: state[9],
    valuationStatus,
    valuationStatusLabel: statusLabel(valuationStatus, valuationBlock, freshnessBlocks, currentBlock),
    valuationBlock,
    valuationSource: state[12],
    totalDeployed,
    approved: state[14],
    enabled: state[15],
    unrealizedYield: currentValue >= principal ? currentValue - principal : 0n,
    unrealizedLoss: currentValue < principal ? principal - currentValue : 0n,
  };
}

export async function readUserStrategyPosition(
  client: Pick<CoreStateClient, 'readContract' | 'getChainId' | 'getBlockNumber'>,
  account: Address,
) {
  await assertArcMainnetRpcChain(client);
  const verifiedAtBlock = await client.getBlockNumber();
  const [userPosition, strategy, freshnessBlocks, paused] = await Promise.all([
    client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: coreStateAbi,
      functionName: 'userStrategyPosition',
      args: [account, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS],
      blockNumber: verifiedAtBlock,
    }),
    client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: strategyStateAbi,
      functionName: 'strategies',
      args: [ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS],
      blockNumber: verifiedAtBlock,
    }),
    client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: strategyStateAbi,
      functionName: 'valuationFreshnessBlocks',
      blockNumber: verifiedAtBlock,
    }),
    client.readContract({
      address: ARC_MAINNET_CORE_ADDRESS,
      abi: coreStateAbi,
      functionName: 'paused',
      blockNumber: verifiedAtBlock,
    }),
  ]);
  const [positionShares, positionValue] = userPosition;
  const valuationStatusLabel = statusLabel(Number(strategy[13]), strategy[11], freshnessBlocks, verifiedAtBlock);
  const hasPosition = positionShares > 0n || positionValue > 0n;
  const reason: PersonalStrategyStatus['reason'] = hasPosition
    ? 'POSITION_AVAILABLE'
    : paused
      ? 'CORE_PAUSED'
      : !strategy[14]
        ? 'STRATEGY_NOT_APPROVED'
        : !strategy[15]
          ? 'STRATEGY_DISABLED'
          : valuationStatusLabel === 'stale'
            ? 'VALUATION_STALE'
            : valuationStatusLabel === 'unavailable'
              ? 'VALUATION_UNAVAILABLE'
              : valuationStatusLabel === 'impaired'
                ? 'VALUATION_IMPAIRED'
                : valuationStatusLabel === 'current'
                  ? 'APPROVED_ENABLED_NO_POSITION'
                  : 'UNKNOWN';
  const valuationStatus = valuationStatusLabel === 'current' ? 'CURRENT'
    : valuationStatusLabel === 'stale' ? 'STALE'
      : valuationStatusLabel === 'unavailable' ? 'UNAVAILABLE'
        : valuationStatusLabel === 'impaired' ? 'IMPAIRED' : 'UNKNOWN';

  const strategyStatus = {
    reason,
    approved: strategy[14],
    enabled: strategy[15],
    paused,
    valuationStatus,
    positionShares,
    positionValue,
    valuationBlock: strategy[11],
    verifiedAtBlock,
  } satisfies PersonalStrategyStatus;

  if (!hasPosition) {
    return { status: 'NO_ACTIVE_POSITION' as const, strategyStatus };
  }
  return {
    status: 'POSITION_AVAILABLE' as const,
    currentValue: positionValue,
    strategyStatus,
  };
}

export async function handleStrategyStateRequest(
  request: StrategyStateRequest,
  response: StrategyStateResponse,
  _clientFactory: () => StrategyStateClient = createServerClient,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let authenticatedWalletAddress: Address;
  try {
    authenticatedWalletAddress = requireAuthenticatedWallet(request).authenticatedWalletAddress;
    resolveUserAccount(authenticatedWalletAddress, request.query?.account);
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  const requestedStrategy = request.query?.strategy;
  if (requestedStrategy !== undefined
    && (typeof requestedStrategy !== 'string'
      || requestedStrategy.toLowerCase() !== ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS.toLowerCase())) {
    response.status(400).json({ error: 'Requested strategy is not available.' });
    return;
  }

  try {
    const client = _clientFactory();
    const position = await readUserStrategyPosition(client, authenticatedWalletAddress);
    const serializedPosition = position.status === 'POSITION_AVAILABLE'
      ? {
          status: position.status,
          currentValueBaseUnits: position.currentValue.toString(),
          unit: 'USDC_BASE_UNITS',
        }
      : { status: position.status };
    const strategyStatus = {
      ...position.strategyStatus,
      positionShares: position.strategyStatus.positionShares.toString(),
      positionValue: position.strategyStatus.positionValue.toString(),
      valuationBlock: position.strategyStatus.valuationBlock.toString(),
      verifiedAtBlock: position.strategyStatus.verifiedAtBlock.toString(),
    };
    response.status(200).json({
      scope: 'USER',
      authenticatedWalletAddress,
      chainId: ARC_MAINNET_CHAIN_ID,
      availability: 'AVAILABLE',
      position: serializedPosition,
      strategyStatus,
    });
  } catch (error) {
    console.error('Authenticated user strategy position read failed.', error);
    response.status(503).json({ error: 'Your Steakhouse position is temporarily unavailable. Please try again.' });
  }
}

export default function handler(request: StrategyStateRequest, response: StrategyStateResponse): Promise<void> {
  return handleStrategyStateRequest(request, response);
}
