import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  isAddress,
  isHex,
  parseEventLogs,
  type Address,
  type Log,
  type Hex,
  type Hash,
} from 'viem';
import { privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import {
  ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
  CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  createArcMainnetExecutionConfig,
  readConfiguredCoreAddress,
} from '../../api/src/config/arc-mainnet.js';
import { ARC_MAINNET_CORE_ROLE_HOLDERS } from '../../../packages/contracts/scripts/arc-mainnet-core-deployment-config.js';
import { isRetiredArcMainnetAddress } from '@velox/domain';
import {
  AUTOMATION_ROLE,
  POLICY_ADMIN_ROLE,
} from '../src/contracts/treasury';
import {
  assertRequestOrigin,
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  type WalletAuthRequest,
} from '../server/wallet-auth';
import {
  postgresStrategyAutomationTriggerStore,
  type StrategyAutomationTriggerStore,
} from '../server/strategyAutomationTriggerStore';

const STRATEGY_AUTOMATION_ABI = [
  {
    type: 'function', name: 'hasRole', stateMutability: 'view',
    inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'AUTOMATION_ROLE', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'usdc', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'protocolVaults', stateMutability: 'view',
    inputs: [{ name: 'protocol', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'liquidUSDC', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'valuationFreshnessBlocks', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalDeployed', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'availableLiquidity', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'yieldStrategyBufferCapacity', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalManagedAssets', stateMutability: 'view', inputs: [],
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
    type: 'function', name: 'protocolCaps', stateMutability: 'view',
    inputs: [{ name: 'protocol', type: 'bytes32' }],
    outputs: [
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'assetCaps', stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'protocolExposure', stateMutability: 'view',
    inputs: [{ name: 'protocol', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'assetExposure', stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'strategies', stateMutability: 'view',
    inputs: [{ name: 'strategy', type: 'address' }],
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
  {
    type: 'function', name: 'allocateToStrategy', stateMutability: 'nonpayable',
    inputs: [{ name: 'strategy', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'deallocateFromStrategy', stateMutability: 'nonpayable',
    inputs: [{ name: 'strategy', type: 'address' }, { name: 'shares', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'syncStrategyValuation', stateMutability: 'nonpayable',
    inputs: [{ name: 'strategy', type: 'address' }],
    outputs: [],
  },
] as const;

const STRATEGY_ADAPTER_IDENTITY_ABI = [
  {
    type: 'function', name: 'core', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'protocol', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'asset', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'vault', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const STRATEGY_ADAPTER_VALUATION_ABI = [
  {
    type: 'function', name: 'sharesOfCore', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'currentValue', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'feesAccrued', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const STEAKHOUSE_VAULT_IDENTITY_ABI = [
  {
    type: 'function', name: 'asset', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const DEPOSIT_TRIGGER_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'userBalance', type: 'uint256', indexed: false },
      { name: 'totalLiabilities', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Arc Mainnet produces about two blocks per second, so 2,400 blocks is roughly 20 minutes:
// enough for the frontend's immediate post-confirmation request, far too short to replay an old deposit.
export const DEPOSIT_TRIGGER_MAX_AGE_BLOCKS = 2_400n;

export interface DepositVerificationClient {
  getTransaction(args: { hash: Hash }): Promise<{ readonly to: Address | null; readonly from: Address; readonly input: Hex }>;
  getTransactionReceipt(args: { hash: Hash }): Promise<{
    readonly status: string;
    readonly blockNumber: bigint;
    readonly logs: readonly { readonly address: Address; readonly topics: readonly Hex[]; readonly data: Hex }[];
  }>;
  getBlockNumber(): Promise<bigint>;
}

export async function verifyConfirmedDepositTransaction(
  client: DepositVerificationClient,
  coreAddress: Address,
  transactionHash: Hash,
  depositor: Address,
  maxAgeBlocks: bigint = DEPOSIT_TRIGGER_MAX_AGE_BLOCKS,
): Promise<boolean> {
  const [transaction, receipt, latestBlock] = await Promise.all([
    client.getTransaction({ hash: transactionHash }),
    client.getTransactionReceipt({ hash: transactionHash }),
    client.getBlockNumber(),
  ]);
  if (!transaction.to
    || transaction.to.toLowerCase() !== coreAddress.toLowerCase()
    || transaction.from.toLowerCase() !== depositor.toLowerCase()
    || receipt.status !== 'success') {
    return false;
  }
  if (typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber < 0n
    || typeof latestBlock !== 'bigint' || receipt.blockNumber > latestBlock) {
    return false;
  }
  if (latestBlock - receipt.blockNumber > maxAgeBlocks) {
    throw new StrategyAutomationError(
      'INVALID_REQUEST',
      'This deposit transaction is too old to trigger automatic deployment. Only a recently confirmed deposit can trigger it; no valuation sync or allocation was attempted.',
    );
  }
  try {
    const decoded = decodeFunctionData({ abi: DEPOSIT_TRIGGER_ABI, data: transaction.input });
    if (decoded.functionName !== 'deposit' || decoded.args[0] <= 0n) return false;
    const depositEvents = parseEventLogs({
      abi: DEPOSIT_TRIGGER_ABI,
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === coreAddress.toLowerCase()) as unknown as Log[],
      eventName: 'Deposit',
    });
    return depositEvents.some((event) =>
      event.args.user.toLowerCase() === depositor.toLowerCase()
      && event.args.amount === decoded.args[0]);
  } catch {
    return false;
  }
}

const AUTOMATION_CHAIN_ID = 5042;
const BASIS_POINTS = 10_000n;
const CURRENT_VALUATION_STATUS = 1;
const UINT256_MAX = (1n << 256n) - 1n;

function getConfiguredAutomationAddress(): Address {
  const configuredAutomationAddress = (
    process.env.ARC_MAINNET_CORE_AUTOMATION_EXECUTOR
    ?? ARC_MAINNET_CORE_ROLE_HOLDERS.automationExecutor
  ).trim();
  if (!isAddress(configuredAutomationAddress)) {
    throw new StrategyAutomationError(
      'CONFIGURATION',
      'Configured ARC_MAINNET_CORE_AUTOMATION_EXECUTOR is not a valid address.',
    );
  }
  return getAddress(configuredAutomationAddress);
}

function getDeployerPrivateKey(): string | undefined {
  const environmentKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (environmentKey) return environmentKey;

  const contractsEnvPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../packages/contracts/.env',
  );
  try {
    const parsed = parseDotenv(readFileSync(contractsEnvPath));
    const fileKey = parsed.DEPLOYER_PRIVATE_KEY?.trim();
    return fileKey || undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function remainingExposureCapacity(
  exposure: bigint,
  absoluteCap: bigint,
  relativeCapBps: number,
  managedAssets: bigint,
): bigint {
  let allowedExposure = absoluteCap;
  if (relativeCapBps !== 0) {
    const relativeCap = managedAssets * BigInt(relativeCapBps) / BASIS_POINTS;
    if (allowedExposure === 0n || relativeCap < allowedExposure) allowedExposure = relativeCap;
  }
  return allowedExposure > exposure ? allowedExposure - exposure : 0n;
}

export interface StrategyAllocationCapacity {
  readonly strategy: {
    readonly approved: boolean;
    readonly enabled: boolean;
    readonly position: bigint;
    readonly absoluteCap: bigint;
    readonly relativeCapBps: number;
  };
  readonly availableLiquidity: bigint;
  readonly yieldStrategyBufferCapacity: bigint;
  readonly totalDeployed: bigint;
  readonly maximumTotalDeployed: bigint;
  readonly totalManagedAssets: bigint;
  readonly protocol: {
    readonly approved: boolean;
    readonly enabled: boolean;
    readonly exposure: bigint;
    readonly absoluteCap: bigint;
    readonly relativeCapBps: number;
  };
  readonly asset: {
    readonly approved: boolean;
    readonly enabled: boolean;
    readonly exposure: bigint;
    readonly absoluteCap: bigint;
    readonly relativeCapBps: number;
  };
}

export function calculateEligibleStrategyAllocation(input: StrategyAllocationCapacity): bigint {
  if (!input.strategy.approved || !input.strategy.enabled
    || !input.protocol.approved || !input.protocol.enabled
    || !input.asset.approved || !input.asset.enabled) return 0n;

  const totalDeploymentCapacity = input.maximumTotalDeployed > input.totalDeployed
    ? input.maximumTotalDeployed - input.totalDeployed
    : 0n;
  return [
    input.availableLiquidity,
    input.yieldStrategyBufferCapacity,
    totalDeploymentCapacity,
    remainingExposureCapacity(
      input.strategy.position,
      input.strategy.absoluteCap,
      input.strategy.relativeCapBps,
      input.totalManagedAssets,
    ),
    remainingExposureCapacity(
      input.protocol.exposure,
      input.protocol.absoluteCap,
      input.protocol.relativeCapBps,
      input.totalManagedAssets,
    ),
    remainingExposureCapacity(
      input.asset.exposure,
      input.asset.absoluteCap,
      input.asset.relativeCapBps,
      input.totalManagedAssets,
    ),
  ].reduce((limit, candidate) => candidate < limit ? candidate : limit);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export interface StrategyAutomationSignerDiagnostic {
  readonly signerAddress: Address;
  readonly executorAddress: Address;
  readonly matchesExecutor: boolean;
  readonly hasAutomationRole: boolean;
  readonly blockNumber: bigint;
}

export type StrategyAutomationDiagnosticStage =
  | 'core-configuration'
  | 'rpc-configuration'
  | 'key-resolution'
  | 'key-validation'
  | 'executor-configuration'
  | 'rpc-connection'
  | 'rpc-chain-validation'
  | 'block-read'
  | 'role-constant-read'
  | 'role-membership-read';

export type StrategyAutomationDiagnosticErrorCategory =
  | 'CONFIGURATION_UNAVAILABLE'
  | 'CONFIGURATION_INVALID'
  | 'KEY_SOURCE_UNAVAILABLE'
  | 'KEY_INVALID'
  | 'RPC_UNAVAILABLE'
  | 'WRONG_CHAIN'
  | 'CHAIN_READ_FAILED'
  | 'BLOCK_READ_FAILED'
  | 'ROLE_READ_FAILED';

export type StrategyAutomationAddressConfigStatus = 'MISSING' | 'INVALID' | 'VALID';
export type StrategyAutomationAddressConfigReason =
  | 'MISSING'
  | 'MALFORMED'
  | 'ZERO'
  | 'RETIRED'
  | 'CURRENT_REFERENCE_REJECTED'
  | 'UNAPPROVED'
  | 'VALID';

export interface StrategyAutomationAddressConfigAssessment {
  readonly status: StrategyAutomationAddressConfigStatus;
  readonly reason: StrategyAutomationAddressConfigReason;
}

export class StrategyAutomationDiagnosticError extends Error {
  constructor(
    readonly stage: StrategyAutomationDiagnosticStage,
    readonly category: StrategyAutomationDiagnosticErrorCategory,
    readonly addressConfig?: {
      readonly core: StrategyAutomationAddressConfigAssessment;
      readonly adapter: StrategyAutomationAddressConfigAssessment;
    },
  ) {
    super('Signer diagnostic failed.');
    this.name = 'StrategyAutomationDiagnosticError';
  }
}

function diagnosticError(
  stage: StrategyAutomationDiagnosticStage,
  category: StrategyAutomationDiagnosticErrorCategory,
): StrategyAutomationDiagnosticError {
  return new StrategyAutomationDiagnosticError(stage, category);
}

function assessExecutionAddress(
  value: string | undefined,
  currentReference: Address,
  approvedAddress?: Address,
): StrategyAutomationAddressConfigAssessment {
  const address = value?.trim();
  if (!address) return { status: 'MISSING', reason: 'MISSING' };
  if (!isAddress(address)) return { status: 'INVALID', reason: 'MALFORMED' };
  if (address.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { status: 'INVALID', reason: 'ZERO' };
  }
  if (isRetiredArcMainnetAddress(address)) return { status: 'INVALID', reason: 'RETIRED' };
  if (approvedAddress && address.toLowerCase() !== approvedAddress.toLowerCase()) {
    return { status: 'INVALID', reason: 'UNAPPROVED' };
  }
  if (!approvedAddress && address.toLowerCase() === currentReference.toLowerCase()) {
    return { status: 'INVALID', reason: 'CURRENT_REFERENCE_REJECTED' };
  }
  return { status: 'VALID', reason: 'VALID' };
}

function assessExecutionAddressConfiguration(): {
  readonly core: StrategyAutomationAddressConfigAssessment;
  readonly adapter: StrategyAutomationAddressConfigAssessment;
} {
  return {
    core: assessExecutionAddress(
      readConfiguredCoreAddress(process.env),
      APPROVED_ARC_MAINNET_CORE_ADDRESS,
      APPROVED_ARC_MAINNET_CORE_ADDRESS,
    ),
    adapter: assessExecutionAddress(
      process.env.STEAKHOUSE_ADAPTER_ADDRESS,
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
    ),
  };
}

export async function runStrategyAutomationSignerDiagnostic(): Promise<StrategyAutomationSignerDiagnostic> {
  let config: ReturnType<typeof createArcMainnetExecutionConfig>;
  try {
    config = createArcMainnetExecutionConfig();
  } catch {
    const addressConfig = assessExecutionAddressConfiguration();
    throw new StrategyAutomationDiagnosticError(
      'core-configuration',
      'CONFIGURATION_INVALID',
      addressConfig,
    );
  }

  const rpcUrl = process.env.ARC_MAINNET_RPC_URL?.trim();
  if (!rpcUrl) {
    throw diagnosticError('rpc-configuration', 'CONFIGURATION_UNAVAILABLE');
  }

  let privateKey: string | undefined;
  try {
    privateKey = getDeployerPrivateKey();
  } catch {
    throw diagnosticError('key-resolution', 'KEY_SOURCE_UNAVAILABLE');
  }
  if (!privateKey) {
    throw diagnosticError('key-resolution', 'CONFIGURATION_UNAVAILABLE');
  }
  if (!isHex(privateKey, { strict: true }) || privateKey.length !== 66) {
    throw diagnosticError('key-validation', 'KEY_INVALID');
  }

  let signerAddress: Address;
  try {
    signerAddress = privateKeyToAddress(privateKey);
  } catch {
    throw diagnosticError('key-validation', 'KEY_INVALID');
  }

  let executorAddress: Address;
  try {
    executorAddress = getConfiguredAutomationAddress();
  } catch {
    throw diagnosticError('executor-configuration', 'CONFIGURATION_INVALID');
  }

  const chain = defineChain({
    id: config.chainId,
    name: 'Arc Mainnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  let actualChainId: number;
  try {
    actualChainId = await publicClient.getChainId();
  } catch {
    throw diagnosticError('rpc-connection', 'RPC_UNAVAILABLE');
  }
  if (actualChainId !== AUTOMATION_CHAIN_ID) {
    throw diagnosticError('rpc-chain-validation', 'WRONG_CHAIN');
  }

  let blockNumber: bigint;
  try {
    blockNumber = await publicClient.getBlockNumber();
  } catch {
    throw diagnosticError('block-read', 'BLOCK_READ_FAILED');
  }

  let automationRole: Hex;
  try {
    automationRole = await publicClient.readContract({
      address: config.coreAddress,
      abi: STRATEGY_AUTOMATION_ABI,
      functionName: 'AUTOMATION_ROLE',
      blockNumber,
    });
  } catch {
    throw diagnosticError('role-constant-read', 'ROLE_READ_FAILED');
  }

  let hasAutomationRole: boolean;
  try {
    hasAutomationRole = await publicClient.readContract({
      address: config.coreAddress,
      abi: STRATEGY_AUTOMATION_ABI,
      functionName: 'hasRole',
      args: [automationRole, signerAddress],
      blockNumber,
    });
  } catch {
    throw diagnosticError('role-membership-read', 'ROLE_READ_FAILED');
  }

  return {
    signerAddress,
    executorAddress,
    matchesExecutor: signerAddress.toLowerCase() === executorAddress.toLowerCase(),
    hasAutomationRole,
    blockNumber,
  };
}

export type StrategyAutomationOperation =
  | { readonly operation: 'allocate'; readonly amount: bigint }
  | { readonly operation: 'deallocate'; readonly shares: bigint }
  | { readonly operation: 'sync-valuation' };

export interface StrategyAutomationSnapshot {
  readonly approved: boolean;
  readonly enabled: boolean;
  readonly freshnessBlocks: bigint;
  readonly principal: bigint;
  readonly shares: bigint;
  readonly position: bigint;
  readonly feesAccrued: bigint;
  readonly valuationBlock: bigint;
  readonly valuationSource: Address;
  readonly valuationStatus: number;
  readonly totalDeployed: bigint;
  readonly liquidUSDC: bigint;
}

function isValuationCurrent(snapshot: StrategyAutomationSnapshot, blockNumber: bigint): boolean {
  return snapshot.valuationStatus === CURRENT_VALUATION_STATUS
    && snapshot.freshnessBlocks > 0n
    && blockNumber <= snapshot.valuationBlock + snapshot.freshnessBlocks;
}

function isValuationNotCurrentError(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if ('name' in error && error.name === 'ValuationNotCurrent') return true;
  if ('errorName' in error && error.errorName === 'ValuationNotCurrent') return true;
  if ('message' in error && typeof error.message === 'string'
    && error.message.includes('ValuationNotCurrent')) return true;
  if ('shortMessage' in error && typeof error.shortMessage === 'string'
    && error.shortMessage.includes('ValuationNotCurrent')) return true;
  return ('cause' in error && isValuationNotCurrentError(error.cause, seen))
    || ('data' in error && isValuationNotCurrentError(error.data, seen));
}

export interface StrategyAdapterValuation {
  readonly shares: bigint;
  readonly currentValue: bigint;
  readonly feesAccrued: bigint;
}

export interface StrategyAutomationReceipt {
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
}

export interface StrategyAutomationDependencies {
  readonly coreAddress: Address;
  readonly strategyAddress: Address;
  readonly executorAddress: Address;
  readonly configuredAutomationAddress: Address;
  getChainId(): Promise<number>;
  getCoreBytecode(): Promise<Hex | undefined>;
  getAdapterBytecode(): Promise<Hex | undefined>;
  verifyDeploymentIdentity(): Promise<boolean>;
  hasRole(role: Hex, account: Address): Promise<boolean>;
  getBlockNumber(): Promise<bigint>;
  readSnapshot(blockNumber: bigint): Promise<StrategyAutomationSnapshot>;
  readAdapterValuation?(blockNumber: bigint): Promise<StrategyAdapterValuation>;
  verifyDepositTransaction?(transactionHash: Hash, depositor: Address): Promise<boolean>;
  getEligibleAllocationAmount?(): Promise<bigint>;
  simulate(operation: StrategyAutomationOperation): Promise<void>;
  submit(operation: StrategyAutomationOperation): Promise<Hash>;
  waitForReceipt(hash: Hash): Promise<StrategyAutomationReceipt>;
}

export type StrategyAutomationFailureKind =
  | 'INVALID_REQUEST'
  | 'CONFIGURATION'
  | 'UNAUTHORIZED'
  | 'VALUATION_NOT_CURRENT'
  | 'TRANSACTION_FAILED'
  | 'READBACK_FAILED';

export class StrategyAutomationError extends Error {
  constructor(
    readonly kind: StrategyAutomationFailureKind,
    message: string,
    readonly transactionHash?: Hash,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'StrategyAutomationError';
  }
}

type SubmissionErrorClassification =
  | 'USER_REJECTED'
  | 'NONCE_ERROR'
  | 'GAS_FEE_ERROR'
  | 'INSUFFICIENT_FUNDS'
  | 'RPC_PROVIDER_ERROR'
  | 'PROVIDER_ERROR';

type SubmissionFailureReason =
  | 'USER_REJECTED'
  | 'INSUFFICIENT_FUNDS'
  | 'GAS_FEE_ERROR'
  | 'NONCE_ERROR'
  | 'EXECUTION_REVERT'
  | 'UNSUPPORTED_RPC_METHOD'
  | 'UNKNOWN_PROVIDER_ERROR';

export function classifyStrategyAutomationSubmissionError(error: unknown): {
  readonly classification: SubmissionErrorClassification;
  readonly reasonCategory: SubmissionFailureReason;
  readonly providerErrorCode: number | null;
} {
  let classification: SubmissionErrorClassification = 'PROVIDER_ERROR';
  let reasonCategory: SubmissionFailureReason = 'UNKNOWN_PROVIDER_ERROR';
  let providerErrorCode: number | null = null;
  const seen = new Set<object>();
  const pending: unknown[] = [error];

  while (pending.length > 0 && seen.size < 16) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as {
      readonly name?: unknown;
      readonly code?: unknown;
      readonly shortMessage?: unknown;
      readonly details?: unknown;
      readonly message?: unknown;
      readonly cause?: unknown;
      readonly error?: unknown;
      readonly data?: unknown;
    };
    const name = typeof candidate.name === 'string' ? candidate.name.toLowerCase() : '';
    const code = candidate.code;
    const providerText = [candidate.shortMessage, candidate.details, candidate.message, candidate.data]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.slice(0, 512).toLowerCase())
      .join(' ');
    const classificationText = `${name} ${providerText}`;

    if (name.includes('userrejected') || name.includes('userdenied')
      || code === 4001 || /\buser (?:rejected|denied|cancelled)\b/.test(providerText)) {
      classification = 'USER_REJECTED';
      reasonCategory = 'USER_REJECTED';
    } else if (name.includes('nonce') || /\bnonce\b/.test(classificationText)) {
      classification = 'NONCE_ERROR';
      reasonCategory = 'NONCE_ERROR';
    } else if (name.includes('insufficientfund')
      || /\binsufficient funds?\b|\bnot enough funds\b|\bbalance too low\b/.test(providerText)) {
      classification = 'INSUFFICIENT_FUNDS';
      reasonCategory = 'INSUFFICIENT_FUNDS';
    } else if (name.includes('feecap') || name.includes('intrinsicgas') || name.includes('tipabovefeecap')
      || /\bfee cap\b|\bmax(?:imum)? fee per gas\b|\bpriority fee\b|\bbase fee\b|\bminimum gas price\b|\bunderpriced\b|\bintrinsic gas\b/.test(providerText)) {
      classification = 'GAS_FEE_ERROR';
      reasonCategory = 'GAS_FEE_ERROR';
    } else if (name.includes('executionreverted') || name.includes('contractfunctionreverted')
      || /\bexecution reverted\b|\bcontract reverted\b/.test(providerText)) {
      classification = 'RPC_PROVIDER_ERROR';
      reasonCategory = 'EXECUTION_REVERT';
    } else if (name.includes('methodnotsupported') || name.includes('methodnotfound')
      || /\bmethod (?:not supported|not found|unsupported)\b/.test(providerText)) {
      classification = 'RPC_PROVIDER_ERROR';
      reasonCategory = 'UNSUPPORTED_RPC_METHOD';
    } else if (name.includes('rpc') || name.includes('http') || name.includes('transport')
      || (typeof code === 'number' && code <= -32000 && code >= -32768)) {
      classification = 'RPC_PROVIDER_ERROR';
    }

    if (providerErrorCode === null && typeof code === 'number' && Number.isSafeInteger(code)) {
      providerErrorCode = code;
    }

    pending.push(candidate.cause, candidate.error, candidate.data);
  }

  return { classification, reasonCategory, providerErrorCode };
}

export interface ConfirmedStrategyAutomation {
  readonly status: 'confirmed';
  readonly operation: StrategyAutomationOperation['operation'];
  readonly transactionHash: Hash;
  readonly blockNumber: bigint;
  readonly coreAddress: Address;
  readonly strategyAddress: Address;
  readonly readback: StrategyAutomationSnapshot;
}

function parseOperation(body: unknown): StrategyAutomationOperation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new StrategyAutomationError('INVALID_REQUEST', 'A strategy operation is required.');
  }
  const request = body as Record<string, unknown>;
  if (request.operation === 'sync-valuation') return { operation: 'sync-valuation' };

  const field = request.operation === 'allocate'
    ? 'amount'
    : request.operation === 'deallocate'
      ? 'shares'
      : null;
  if (!field) {
    throw new StrategyAutomationError('INVALID_REQUEST', 'Unsupported strategy operation.');
  }
  const rawValue = request[field];
  if (typeof rawValue !== 'string' || !/^[1-9][0-9]*$/.test(rawValue)) {
    throw new StrategyAutomationError('INVALID_REQUEST', `${field} must be a positive base-unit integer string.`);
  }
  const value = BigInt(rawValue);
  if (value > UINT256_MAX) {
    throw new StrategyAutomationError('INVALID_REQUEST', `${field} exceeds the Core uint256 limit.`);
  }
  return request.operation === 'allocate'
    ? { operation: 'allocate', amount: value }
    : { operation: 'deallocate', shares: value };
}

function failReadback(message: string, transactionHash: Hash): never {
  throw new StrategyAutomationError('READBACK_FAILED', message, transactionHash);
}

function validatePostState(
  operation: StrategyAutomationOperation,
  before: StrategyAutomationSnapshot,
  after: StrategyAutomationSnapshot,
  strategyAddress: Address,
  receipt: StrategyAutomationReceipt,
  transactionHash: Hash,
  adapterValuation?: StrategyAdapterValuation,
): void {
  if (after.valuationBlock !== receipt.blockNumber
    || after.valuationStatus !== CURRENT_VALUATION_STATUS
    || after.freshnessBlocks === 0n
    || receipt.blockNumber > after.valuationBlock + after.freshnessBlocks
    || after.valuationSource.toLowerCase() !== strategyAddress.toLowerCase()) {
    failReadback('Core did not confirm a fresh strategy valuation at the transaction block.', transactionHash);
  }
  if (before.totalDeployed < before.position) {
    failReadback('Core strategy accounting was inconsistent before execution.', transactionHash);
  }
  const expectedTotalDeployed = before.totalDeployed - before.position + after.position;
  if (after.totalDeployed !== expectedTotalDeployed) {
    failReadback('Core totalDeployed does not match the confirmed strategy position.', transactionHash);
  }

  if (operation.operation === 'allocate') {
    if (after.principal !== before.principal + operation.amount
      || after.shares <= before.shares
      || before.liquidUSDC < operation.amount
      || after.liquidUSDC !== before.liquidUSDC - operation.amount) {
      failReadback('Core allocation state does not match the submitted amount.', transactionHash);
    }
    return;
  }

  if (operation.operation === 'deallocate') {
    if (operation.shares > before.shares) {
      failReadback('The confirmed deallocation exceeded the pre-transaction Core shares.', transactionHash);
    }
    const principalBasis = operation.shares === before.shares
      ? before.principal
      : before.principal * operation.shares / before.shares;
    if (after.shares !== before.shares - operation.shares
      || after.principal !== before.principal - principalBasis
      || after.liquidUSDC <= before.liquidUSDC) {
      failReadback('Core deallocation state does not match the submitted shares.', transactionHash);
    }
    return;
  }

  if (!adapterValuation
    || after.principal !== before.principal
    || after.liquidUSDC !== before.liquidUSDC
    || after.shares !== adapterValuation.shares
    || after.position !== adapterValuation.currentValue
    || after.feesAccrued !== adapterValuation.feesAccrued) {
    failReadback('Valuation sync did not match the adapter readback or unexpectedly changed principal or liquid USDC.', transactionHash);
  }
}

export async function executeStrategyAutomation(
  caller: Address,
  operation: StrategyAutomationOperation,
  dependencies: StrategyAutomationDependencies,
): Promise<ConfirmedStrategyAutomation> {
  if ((operation.operation === 'allocate' && (operation.amount <= 0n || operation.amount > UINT256_MAX))
    || (operation.operation === 'deallocate' && (operation.shares <= 0n || operation.shares > UINT256_MAX))) {
    throw new StrategyAutomationError('INVALID_REQUEST', 'Strategy amount or shares must be a positive uint256 value.');
  }
  await assertStrategyAutomationAuthorization(caller, dependencies);

  const beforeBlock = await dependencies.getBlockNumber();
  const before = await dependencies.readSnapshot(beforeBlock);
  if (operation.operation === 'allocate' && !isValuationCurrent(before, beforeBlock)) {
    throw new StrategyAutomationError(
      'VALUATION_NOT_CURRENT',
      'Strategy valuation became stale before allocation; no allocation transaction was submitted.',
    );
  }
  if (!before.approved || (operation.operation === 'allocate' && !before.enabled)) {
    throw new StrategyAutomationError('CONFIGURATION', 'The configured strategy is not approved and enabled for this operation.');
  }
  if (operation.operation === 'deallocate' && operation.shares > before.shares) {
    throw new StrategyAutomationError('INVALID_REQUEST', 'Requested shares exceed the authoritative Core strategy shares.');
  }

  try {
    await dependencies.simulate(operation);
  } catch (error) {
    if (operation.operation === 'allocate' && isValuationNotCurrentError(error)) {
      throw new StrategyAutomationError(
        'VALUATION_NOT_CURRENT',
        'Core rejected allocation because strategy valuation is stale; no allocation transaction was submitted.',
      );
    }
    throw new StrategyAutomationError(
      'CONFIGURATION',
      'Core simulation rejected the strategy operation under current policy, strategy, exposure, valuation, or liquidity checks; no transaction was submitted.',
    );
  }

  let transactionHash: Hash;
  try {
    transactionHash = await dependencies.submit(operation);
  } catch (error) {
    const correlationId = randomUUID();
    const diagnostics = classifyStrategyAutomationSubmissionError(error);
    console.error('Strategy automation transaction submission failed.', {
      correlationId,
      ...diagnostics,
    });
    throw new StrategyAutomationError(
      'TRANSACTION_FAILED',
      'Strategy transaction submission failed; no success was reported.',
      undefined,
      correlationId,
    );
  }

  let receipt: StrategyAutomationReceipt;
  try {
    receipt = await dependencies.waitForReceipt(transactionHash);
  } catch {
    throw new StrategyAutomationError(
      'TRANSACTION_FAILED',
      'Could not confirm the submitted strategy transaction receipt.',
      transactionHash,
    );
  }
  if (receipt.status !== 'success') {
    throw new StrategyAutomationError('TRANSACTION_FAILED', 'The Core strategy transaction reverted.', transactionHash);
  }

  let after: StrategyAutomationSnapshot;
  try {
    after = await dependencies.readSnapshot(receipt.blockNumber);
    const adapterValuation = operation.operation === 'sync-valuation'
      ? await dependencies.readAdapterValuation?.(receipt.blockNumber)
      : undefined;
    validatePostState(operation, before, after, dependencies.strategyAddress, receipt, transactionHash, adapterValuation);
  } catch (error) {
    if (error instanceof StrategyAutomationError && error.kind === 'READBACK_FAILED') throw error;
    failReadback('The Core transaction succeeded, but authoritative post-transaction readback failed.', transactionHash);
  }

  return {
    status: 'confirmed',
    operation: operation.operation,
    transactionHash,
    blockNumber: receipt.blockNumber,
    coreAddress: dependencies.coreAddress,
    strategyAddress: dependencies.strategyAddress,
    readback: after,
  };
}

async function assertStrategyAutomationAuthorization(
  caller: Address,
  dependencies: StrategyAutomationDependencies,
): Promise<void> {
  if (await dependencies.getChainId() !== AUTOMATION_CHAIN_ID) {
    throw new StrategyAutomationError('CONFIGURATION', 'The RPC is not connected to Arc Mainnet.');
  }
  const bytecode = await dependencies.getCoreBytecode();
  if (!bytecode || bytecode === '0x') {
    throw new StrategyAutomationError('CONFIGURATION', 'Configured Core has no contract code.');
  }
  const adapterBytecode = await dependencies.getAdapterBytecode();
  if (!adapterBytecode || adapterBytecode === '0x' || !await dependencies.verifyDeploymentIdentity()) {
    throw new StrategyAutomationError('CONFIGURATION', 'Core, USDC, strategy, or Automation role identity does not match configuration.');
  }
  if (dependencies.executorAddress.toLowerCase() !== dependencies.configuredAutomationAddress.toLowerCase()) {
    throw new StrategyAutomationError(
      'CONFIGURATION',
      `DEPLOYER_PRIVATE_KEY signer ${dependencies.executorAddress} does not match configured ARC_MAINNET_CORE_AUTOMATION_EXECUTOR ${dependencies.configuredAutomationAddress}; no transaction was submitted.`,
    );
  }
  if (!await dependencies.hasRole(POLICY_ADMIN_ROLE, caller)) {
    throw new StrategyAutomationError('UNAUTHORIZED', 'An authenticated Policy Admin wallet is required.');
  }
  if (!await dependencies.hasRole(AUTOMATION_ROLE, dependencies.executorAddress)) {
    throw new StrategyAutomationError('CONFIGURATION', 'The configured deployer wallet does not hold AUTOMATION_ROLE on Core.');
  }
}

export type ScheduledStrategyValuationSync =
  | { readonly status: 'skipped'; readonly reason: 'VALUATION_FRESH'; readonly blockNumber: bigint }
  | ConfirmedStrategyAutomation;

export type AutomaticStrategyDeploymentResult =
  | {
    readonly status: 'skipped';
    readonly reason: 'NO_ELIGIBLE_SURPLUS' | 'DUPLICATE_DEPOSIT_TRIGGER' | 'PREVIOUS_ATTEMPT_FAILED' | 'PREVIOUS_ATTEMPT_INTERRUPTED' | 'RUN_IN_PROGRESS';
    readonly valuation: ScheduledStrategyValuationSync | null;
  }
  | {
    readonly status: 'deployed';
    readonly amount: bigint;
    readonly valuation: ScheduledStrategyValuationSync;
    readonly allocation: ConfirmedStrategyAutomation;
  };

export async function runTriggeredStrategySurplusDeployment(
  depositTransactionHash: Hash,
  depositor: Address,
  dependenciesFactory?: () => {
    readonly config: {
      readonly coreAddress: Address;
      readonly steakhouseAdapterAddress: Address;
    };
    readonly dependencies: StrategyAutomationDependencies;
  },
  triggerStore: StrategyAutomationTriggerStore = postgresStrategyAutomationTriggerStore,
): Promise<AutomaticStrategyDeploymentResult> {
  const { config, dependencies } = dependenciesFactory
    ? dependenciesFactory()
    : createProductionDependencies();
  if (config.coreAddress.toLowerCase() !== dependencies.coreAddress.toLowerCase()
    || config.steakhouseAdapterAddress.toLowerCase() !== dependencies.strategyAddress.toLowerCase()) {
    throw new StrategyAutomationError('CONFIGURATION', 'Automatic deployment target does not match verified deployment configuration.');
  }
  if (!dependencies.verifyDepositTransaction
    || !await dependencies.verifyDepositTransaction(depositTransactionHash, depositor)) {
    throw new StrategyAutomationError('INVALID_REQUEST', 'Automatic deployment requires a confirmed Treasury deposit from the authenticated wallet.');
  }
  const getEligibleAllocationAmount = dependencies.getEligibleAllocationAmount;
  if (!getEligibleAllocationAmount) {
    throw new StrategyAutomationError('CONFIGURATION', 'On-chain allocation capacity could not be verified.');
  }

  const claimed = await triggerStore.runOnce(depositTransactionHash, async () => {
    let valuation = await runScheduledStrategyValuationSync(() => ({ config, dependencies }));
    let amount: bigint;
    const readEligibleAmount = async () => {
      try {
        return await getEligibleAllocationAmount();
      } catch {
        throw new StrategyAutomationError('CONFIGURATION', 'Current on-chain reserve and strategy capacity could not be verified.');
      }
    };
    amount = await readEligibleAmount();
    if (amount <= 0n) {
      return { status: 'skipped', reason: 'NO_ELIGIBLE_SURPLUS', valuation } as const;
    }

    const policyAdmin = getAddress(ARC_MAINNET_CORE_ROLE_HOLDERS.policyAdmin);
    let allocation: ConfirmedStrategyAutomation;
    try {
      allocation = await executeStrategyAutomation(
        policyAdmin,
        { operation: 'allocate', amount },
        dependencies,
      );
    } catch (error) {
      if (!(error instanceof StrategyAutomationError) || error.kind !== 'VALUATION_NOT_CURRENT') throw error;
      valuation = await runScheduledStrategyValuationSync(() => ({ config, dependencies }));
      amount = await readEligibleAmount();
      if (amount <= 0n) {
        return { status: 'skipped', reason: 'NO_ELIGIBLE_SURPLUS', valuation } as const;
      }
      allocation = await executeStrategyAutomation(
        policyAdmin,
        { operation: 'allocate', amount },
        dependencies,
      );
    }
    return { status: 'deployed', amount, valuation, allocation } as const;
  });

  if (claimed.status === 'busy') {
    return { status: 'skipped', reason: 'RUN_IN_PROGRESS', valuation: null };
  }
  if (claimed.status === 'duplicate') {
    // The trigger table records no transaction hash, so a prior FAILED/STARTED attempt cannot be proven
    // to have submitted nothing; it stays blocked rather than risking a duplicate allocation.
    const reason = claimed.previousStatus === 'COMPLETED'
      ? 'DUPLICATE_DEPOSIT_TRIGGER'
      : claimed.previousStatus === 'FAILED'
        ? 'PREVIOUS_ATTEMPT_FAILED'
        : 'PREVIOUS_ATTEMPT_INTERRUPTED';
    return { status: 'skipped', reason, valuation: null };
  }
  return claimed.result;
}

export async function runScheduledStrategyValuationSync(
  dependenciesFactory?: () => {
    readonly config: {
      readonly coreAddress: Address;
      readonly steakhouseAdapterAddress: Address;
    };
    readonly dependencies: StrategyAutomationDependencies;
  },
): Promise<ScheduledStrategyValuationSync> {
  const { config, dependencies } = dependenciesFactory
    ? dependenciesFactory()
    : createProductionDependencies();
  if (config.coreAddress.toLowerCase() !== dependencies.coreAddress.toLowerCase()
    || config.steakhouseAdapterAddress.toLowerCase() !== dependencies.strategyAddress.toLowerCase()) {
    throw new StrategyAutomationError('CONFIGURATION', 'Scheduled valuation sync target does not match verified deployment configuration.');
  }
  const policyAdmin = getAddress(ARC_MAINNET_CORE_ROLE_HOLDERS.policyAdmin);
  await assertStrategyAutomationAuthorization(policyAdmin, dependencies);

  let blockNumber: bigint;
  let current: StrategyAutomationSnapshot;
  try {
    blockNumber = await dependencies.getBlockNumber();
    current = await dependencies.readSnapshot(blockNumber);
  } catch {
    throw new StrategyAutomationError(
      'CONFIGURATION',
      'Current Core valuation state could not be read; no sync transaction was submitted.',
    );
  }
  if (!current.approved) {
    throw new StrategyAutomationError('CONFIGURATION', 'The configured strategy is not approved for valuation sync.');
  }
  if (current.freshnessBlocks === 0n) {
    throw new StrategyAutomationError('CONFIGURATION', 'Core valuation freshness is disabled; the valuation cannot be made fresh.');
  }
  if (isValuationCurrent(current, blockNumber)) {
    return { status: 'skipped', reason: 'VALUATION_FRESH', blockNumber };
  }

  return executeStrategyAutomation(policyAdmin, { operation: 'sync-valuation' }, dependencies);
}

export function createProductionDependencies() {
  const config = createArcMainnetExecutionConfig();
  const rpcUrl = process.env.ARC_MAINNET_RPC_URL?.trim();
  const privateKey = getDeployerPrivateKey();
  if (!rpcUrl || !privateKey || !isHex(privateKey, { strict: true }) || privateKey.length !== 66) {
    throw new StrategyAutomationError('CONFIGURATION', 'Arc RPC and the server-side DEPLOYER_PRIVATE_KEY must be configured.');
  }
  const account = privateKeyToAccount(privateKey);
  const automationAddress = getConfiguredAutomationAddress();
  const chain = defineChain({
    id: config.chainId,
    name: 'Arc Mainnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const readSnapshot = async (blockNumber: bigint): Promise<StrategyAutomationSnapshot> => {
    const [strategy, totalDeployed, liquidUSDC, freshnessBlocks] = await Promise.all([
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'strategies',
        args: [config.steakhouseAdapterAddress],
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'totalDeployed',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'liquidUSDC',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'valuationFreshnessBlocks',
        blockNumber,
      }),
    ]);
    return {
      principal: strategy[4],
      shares: strategy[5],
      position: strategy[6],
      freshnessBlocks,
      feesAccrued: strategy[9],
      valuationBlock: strategy[11],
      valuationSource: strategy[12],
      valuationStatus: strategy[13],
      approved: strategy[14],
      enabled: strategy[15],
      totalDeployed,
      liquidUSDC,
    };
  };

  const getEligibleAllocationAmount = async (): Promise<bigint> => {
    const blockNumber = await publicClient.getBlockNumber();
    const [
      strategy,
      availableLiquidity,
      yieldStrategyBufferCapacity,
      totalDeployed,
      totalManagedAssets,
      riskPolicy,
      protocolCaps,
      assetCaps,
      protocolExposure,
      assetExposure,
    ] = await Promise.all([
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'strategies',
        args: [config.steakhouseAdapterAddress],
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'availableLiquidity',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'yieldStrategyBufferCapacity',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'totalDeployed',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'totalManagedAssets',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'riskPolicy',
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'protocolCaps',
        args: [config.protocolId],
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'assetCaps',
        args: [config.usdcAddress],
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'protocolExposure',
        args: [config.protocolId],
        blockNumber,
      }),
      publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'assetExposure',
        args: [config.usdcAddress],
        blockNumber,
      }),
    ]);
    return calculateEligibleStrategyAllocation({
      strategy: {
        approved: strategy[14],
        enabled: strategy[15],
        position: strategy[6],
        absoluteCap: strategy[2],
        relativeCapBps: strategy[3],
      },
      availableLiquidity,
      yieldStrategyBufferCapacity,
      totalDeployed,
      maximumTotalDeployed: riskPolicy.maximumTotalDeployed,
      totalManagedAssets,
      protocol: {
        approved: protocolCaps[2],
        enabled: protocolCaps[3],
        exposure: protocolExposure,
        absoluteCap: protocolCaps[0],
        relativeCapBps: protocolCaps[1],
      },
      asset: {
        approved: assetCaps[2],
        enabled: assetCaps[3],
        exposure: assetExposure,
        absoluteCap: assetCaps[0],
        relativeCapBps: assetCaps[1],
      },
    });
  };

  const dependencies: StrategyAutomationDependencies = {
    coreAddress: config.coreAddress,
    strategyAddress: config.steakhouseAdapterAddress,
    executorAddress: account.address,
    configuredAutomationAddress: automationAddress,
    async getChainId() {
      return publicClient.getChainId();
    },
    async getCoreBytecode() {
      return publicClient.getBytecode({ address: config.coreAddress });
    },
    async getAdapterBytecode() {
      return publicClient.getBytecode({ address: config.steakhouseAdapterAddress });
    },
    async verifyDeploymentIdentity() {
      const [coreUsdc, coreAutomationRole, coreVault, strategy, adapterCore, adapterProtocol, adapterAsset, adapterVault, vaultAsset] = await Promise.all([
        publicClient.readContract({
          address: config.coreAddress,
          abi: STRATEGY_AUTOMATION_ABI,
          functionName: 'usdc',
        }),
        publicClient.readContract({
          address: config.coreAddress,
          abi: STRATEGY_AUTOMATION_ABI,
          functionName: 'AUTOMATION_ROLE',
        }),
        publicClient.readContract({
          address: config.coreAddress,
          abi: STRATEGY_AUTOMATION_ABI,
          functionName: 'protocolVaults',
          args: [config.protocolId],
        }),
        publicClient.readContract({
          address: config.coreAddress,
          abi: STRATEGY_AUTOMATION_ABI,
          functionName: 'strategies',
          args: [config.steakhouseAdapterAddress],
        }),
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_IDENTITY_ABI,
          functionName: 'core',
        }),
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_IDENTITY_ABI,
          functionName: 'protocol',
        }),
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_IDENTITY_ABI,
          functionName: 'asset',
        }),
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_IDENTITY_ABI,
          functionName: 'vault',
        }),
        publicClient.readContract({
          address: ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
          abi: STEAKHOUSE_VAULT_IDENTITY_ABI,
          functionName: 'asset',
        }),
      ]);
      return coreUsdc.toLowerCase() === config.usdcAddress.toLowerCase()
        && coreAutomationRole.toLowerCase() === AUTOMATION_ROLE.toLowerCase()
        && coreVault.toLowerCase() === ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS.toLowerCase()
        && strategy[0].toLowerCase() === config.protocolId.toLowerCase()
        && strategy[1].toLowerCase() === config.usdcAddress.toLowerCase()
        && adapterCore.toLowerCase() === config.coreAddress.toLowerCase()
        && adapterProtocol.toLowerCase() === config.protocolId.toLowerCase()
        && adapterAsset.toLowerCase() === config.usdcAddress.toLowerCase()
        && adapterVault.toLowerCase() === ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS.toLowerCase()
        && adapterVault.toLowerCase() === coreVault.toLowerCase()
        && vaultAsset.toLowerCase() === config.usdcAddress.toLowerCase();
    },
    async hasRole(role, address) {
      return publicClient.readContract({
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
        functionName: 'hasRole',
        args: [role, address],
      });
    },
    async getBlockNumber() {
      return publicClient.getBlockNumber();
    },
    readSnapshot,
    async readAdapterValuation(blockNumber) {
      const [shares, currentValue, feesAccrued] = await Promise.all([
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_VALUATION_ABI,
          functionName: 'sharesOfCore',
          blockNumber,
        }),
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_VALUATION_ABI,
          functionName: 'currentValue',
          blockNumber,
        }),
        publicClient.readContract({
          address: config.steakhouseAdapterAddress,
          abi: STRATEGY_ADAPTER_VALUATION_ABI,
          functionName: 'feesAccrued',
          blockNumber,
        }),
      ]);
      return { shares, currentValue, feesAccrued };
    },
    async verifyDepositTransaction(transactionHash, depositor) {
      return verifyConfirmedDepositTransaction(
        publicClient as unknown as DepositVerificationClient,
        config.coreAddress,
        transactionHash,
        depositor,
      );
    },
    getEligibleAllocationAmount,
    async simulate(operation) {
      const common = {
        account,
        address: config.coreAddress,
        abi: STRATEGY_AUTOMATION_ABI,
      };
      if (operation.operation === 'allocate') {
        await publicClient.simulateContract({
          ...common,
          functionName: 'allocateToStrategy',
          args: [config.steakhouseAdapterAddress, operation.amount],
        });
        return;
      }
      if (operation.operation === 'deallocate') {
        await publicClient.simulateContract({
          ...common,
          functionName: 'deallocateFromStrategy',
          args: [config.steakhouseAdapterAddress, operation.shares],
        });
        return;
      }
      await publicClient.simulateContract({
        ...common,
        functionName: 'syncStrategyValuation',
        args: [config.steakhouseAdapterAddress],
      });
    },
    async submit(operation) {
      const common = { address: config.coreAddress, abi: STRATEGY_AUTOMATION_ABI };
      if (operation.operation === 'allocate') {
        return walletClient.writeContract({
          ...common,
          account,
          functionName: 'allocateToStrategy',
          args: [config.steakhouseAdapterAddress, operation.amount],
        });
      }
      if (operation.operation === 'deallocate') {
        return walletClient.writeContract({
          ...common,
          account,
          functionName: 'deallocateFromStrategy',
          args: [config.steakhouseAdapterAddress, operation.shares],
        });
      }
      return walletClient.writeContract({
        ...common,
        account,
        functionName: 'syncStrategyValuation',
        args: [config.steakhouseAdapterAddress],
      });
    },
    async waitForReceipt(hash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { status: receipt.status, blockNumber: receipt.blockNumber };
    },
  };
  return { config, dependencies };
}

interface StrategyAutomationResponse {
  status(code: number): StrategyAutomationResponse;
  setHeader(name: string, value: string): StrategyAutomationResponse;
  json(body: unknown): void;
}

export async function handleStrategyAutomationRequest(
  request: WalletAuthRequest,
  response: StrategyAutomationResponse,
  dependenciesFactory = createProductionDependencies,
  triggerStore: StrategyAutomationTriggerStore = postgresStrategyAutomationTriggerStore,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let caller: Address;
  try {
    assertRequestOrigin(request, process.env.AUTH_ORIGIN ?? '');
    caller = requireAuthenticatedWallet(request).authenticatedWalletAddress;
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  if (request.body && typeof request.body === 'object'
    && !Array.isArray(request.body)
    && (request.body as Record<string, unknown>).operation === 'deploy-surplus') {
    const transactionHash = (request.body as Record<string, unknown>).depositTransactionHash;
    if (typeof transactionHash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(transactionHash)) {
      response.status(400).json({
        error: 'A valid confirmed deposit transaction hash is required.',
        kind: 'INVALID_REQUEST',
      });
      return;
    }
    try {
      const resolved = dependenciesFactory();
      const { config, dependencies } = resolved;
      if (!isAddress(config.steakhouseAdapterAddress)) {
        throw new StrategyAutomationError('CONFIGURATION', 'Configured strategy address is invalid.');
      }
      const result = await runTriggeredStrategySurplusDeployment(
        transactionHash as Hash,
        caller,
        () => ({ config, dependencies }),
        triggerStore,
      );
      response.status(200).json(jsonSafe(result));
    } catch (error) {
      const failure = error instanceof StrategyAutomationError
        ? error
        : new StrategyAutomationError('CONFIGURATION', 'Automatic strategy deployment could not verify its trigger or configuration.');
      const statusCode = failure.kind === 'UNAUTHORIZED' ? 403
        : failure.kind === 'INVALID_REQUEST' ? 400
          : failure.kind === 'CONFIGURATION' ? 503 : 502;
      response.status(statusCode).json({
        error: failure.message,
        kind: failure.kind,
        ...(failure.transactionHash ? { transactionHash: failure.transactionHash } : {}),
      });
    }
    return;
  }

  let operation: StrategyAutomationOperation;
  try {
    operation = parseOperation(request.body);
  } catch (error) {
    if (error instanceof StrategyAutomationError) {
      response.status(400).json({ error: error.message, kind: error.kind });
    } else {
      response.status(400).json({ error: 'Invalid strategy operation request.' });
    }
    return;
  }

  try {
    const { config, dependencies } = dependenciesFactory();
    if (!isAddress(config.steakhouseAdapterAddress)) {
      throw new StrategyAutomationError('CONFIGURATION', 'Configured strategy address is invalid.');
    }
    const result = await executeStrategyAutomation(caller, operation, dependencies);
    response.status(200).json({
      status: result.status,
      operation: result.operation,
      transactionHash: result.transactionHash,
      blockNumber: result.blockNumber.toString(),
      coreAddress: result.coreAddress,
      strategyAddress: result.strategyAddress,
      readback: Object.fromEntries(
        Object.entries(result.readback).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]),
      ),
    });
  } catch (error) {
    const failure = error instanceof StrategyAutomationError
      ? error
      : new StrategyAutomationError('CONFIGURATION', 'Strategy executor configuration or Core verification failed.');
    const statusCode = failure.kind === 'UNAUTHORIZED' ? 403
      : failure.kind === 'INVALID_REQUEST' ? 400
        : failure.kind === 'CONFIGURATION' ? 503
          : 502;
    response.status(statusCode).json(failure.correlationId
      ? { error: failure.message, correlationId: failure.correlationId }
      : {
        error: failure.message,
        kind: failure.kind,
        ...(failure.transactionHash ? { transactionHash: failure.transactionHash } : {}),
      });
  }
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}

export default function handler(
  request: WalletAuthRequest,
  response: StrategyAutomationResponse,
): Promise<void> {
  return handleStrategyAutomationRequest(request, response);
}
