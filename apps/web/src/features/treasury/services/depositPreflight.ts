import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { decodeEventLog, type Address, type Hex } from 'viem';
import { veloxTreasuryAbi } from '../../../contracts/treasury';
import { formatUSDC } from '../../usdc/services/usdcService';

export interface DepositPreflightIdentity {
  readonly walletChainId: number;
  readonly rpcChainId: number;
  readonly configuredCoreAddress: string;
  readonly approvedCoreAddress: string;
  readonly coreUsdcAddress: string;
  readonly configuredUsdcAddress: string;
}

export interface DepositPreflightPorts {
  readonly configuredCoreAddress: string;
  readonly approvedCoreAddress: string;
  readonly configuredUsdcAddress: string;
  readonly getWalletChainId: () => Promise<number>;
  readonly getRpcChainId: () => Promise<number>;
  readonly getCoreBytecode: () => Promise<`0x${string}` | undefined>;
  readonly getCoreUsdcAddress: () => Promise<string>;
}

export function assertApprovedDepositCore(configuredCoreAddress: string, approvedCoreAddress: string): void {
  if (configuredCoreAddress.toLowerCase() !== approvedCoreAddress.toLowerCase()) {
    throw new Error('The configured Treasury Core is not the approved current Core. No approval was requested.');
  }
}

export function assertDepositPreflight(identity: DepositPreflightIdentity): void {
  if (identity.walletChainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('Deposits require the connected wallet to be on Arc Mainnet (Chain ID 5042). No approval was requested.');
  }
  if (identity.rpcChainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('The Treasury RPC is not verified on Arc Mainnet (Chain ID 5042). No approval was requested.');
  }
  assertApprovedDepositCore(identity.configuredCoreAddress, identity.approvedCoreAddress);
  if (identity.coreUsdcAddress.toLowerCase() !== identity.configuredUsdcAddress.toLowerCase()) {
    throw new Error('The configured Core does not use the approved Arc Mainnet USDC contract. No approval was requested.');
  }
}

export async function verifyDepositPreflight(ports: DepositPreflightPorts): Promise<void> {
  const walletChainId = await ports.getWalletChainId();
  if (walletChainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('Deposits require the connected wallet to be on Arc Mainnet (Chain ID 5042). No approval was requested.');
  }

  const rpcChainId = await ports.getRpcChainId();
  if (rpcChainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('The Treasury RPC is not verified on Arc Mainnet (Chain ID 5042). No approval was requested.');
  }
  assertApprovedDepositCore(ports.configuredCoreAddress, ports.approvedCoreAddress);

  let coreBytecode: `0x${string}` | undefined;
  try {
    coreBytecode = await ports.getCoreBytecode();
  } catch (cause) {
    throw new Error('The configured Treasury Core could not be verified on Arc Mainnet. No approval was requested.', { cause });
  }
  if (!coreBytecode || coreBytecode === '0x') {
    throw new Error('The configured Treasury Core has no deployed bytecode on Arc Mainnet. No approval was requested.');
  }

  let coreUsdcAddress: string;
  try {
    coreUsdcAddress = await ports.getCoreUsdcAddress();
  } catch (cause) {
    throw new Error('The configured Core USDC identity could not be verified. No approval was requested.', { cause });
  }
  assertDepositPreflight({
    walletChainId,
    rpcChainId,
    configuredCoreAddress: ports.configuredCoreAddress,
    approvedCoreAddress: ports.approvedCoreAddress,
    coreUsdcAddress,
    configuredUsdcAddress: ports.configuredUsdcAddress,
  });
}

export interface DepositApprovalFlow {
  readonly coreAddress: string;
  readonly assertCurrentWalletIdentity: () => Promise<void>;
  readonly preflight: () => Promise<void>;
  readonly approve: () => Promise<`0x${string}`>;
  readonly waitForApproval: (hash: `0x${string}`) => Promise<boolean>;
  readonly submitDeposit: () => Promise<`0x${string}`>;
  readonly waitForDeposit: (hash: `0x${string}`) => Promise<boolean>;
  readonly readRemainingAllowance: () => Promise<bigint>;
}

export interface DepositApprovalCall {
  readonly account: `0x${string}`;
  readonly chainId: typeof ARC_MAINNET_CHAIN_ID;
  readonly tokenAddress: `0x${string}`;
  readonly spender: `0x${string}`;
  readonly amount: bigint;
}

export interface DepositCall {
  readonly account: `0x${string}`;
  readonly chainId: typeof ARC_MAINNET_CHAIN_ID;
  readonly coreAddress: `0x${string}`;
  readonly amount: bigint;
}

export interface DepositApprovalFlowPorts {
  readonly account: `0x${string}`;
  readonly chainId: typeof ARC_MAINNET_CHAIN_ID;
  readonly tokenAddress: `0x${string}`;
  readonly coreAddress: `0x${string}`;
  readonly amount: bigint;
  readonly assertCurrentWalletIdentity: () => Promise<void>;
  readonly preflight: () => Promise<void>;
  readonly writeApproval: (call: DepositApprovalCall) => Promise<`0x${string}`>;
  readonly waitForApproval: (hash: `0x${string}`) => Promise<boolean>;
  readonly writeDeposit: (call: DepositCall) => Promise<`0x${string}`>;
  readonly waitForDeposit: (hash: `0x${string}`) => Promise<boolean>;
  readonly readRemainingAllowance: () => Promise<bigint>;
}

export function createDepositApprovalFlow(ports: DepositApprovalFlowPorts): DepositApprovalFlow {
  return {
    coreAddress: ports.coreAddress,
    assertCurrentWalletIdentity: ports.assertCurrentWalletIdentity,
    preflight: ports.preflight,
    approve: () => ports.writeApproval({
      account: ports.account,
      chainId: ports.chainId,
      tokenAddress: ports.tokenAddress,
      spender: ports.coreAddress,
      amount: ports.amount,
    }),
    waitForApproval: ports.waitForApproval,
    submitDeposit: () => ports.writeDeposit({
      account: ports.account,
      chainId: ports.chainId,
      coreAddress: ports.coreAddress,
      amount: ports.amount,
    }),
    waitForDeposit: ports.waitForDeposit,
    readRemainingAllowance: ports.readRemainingAllowance,
  };
}

export function hasExpectedDepositEvent(
  logs: readonly { readonly address: Address; readonly data: Hex; readonly topics: readonly Hex[] }[],
  treasuryAddress: Address,
  userAddress: Address,
  amount: bigint,
): boolean {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== treasuryAddress.toLowerCase()) return false;
    try {
      const event = decodeEventLog({
        abi: veloxTreasuryAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      return event.eventName === 'Deposit'
        && event.args.user?.toLowerCase() === userAddress.toLowerCase()
        && event.args.amount === amount;
    } catch {
      return false;
    }
  });
}

function sanitizeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'Unknown wallet or RPC error.';
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240);
}

function transactionHashFromError(cause: unknown): `0x${string}` | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const error = cause as { readonly hash?: unknown; readonly transactionHash?: unknown };
  const candidate = typeof error.hash === 'string' ? error.hash
    : typeof error.transactionHash === 'string' ? error.transactionHash
      : undefined;
  return candidate && /^0x[0-9a-fA-F]{64}$/.test(candidate) ? candidate as `0x${string}` : undefined;
}

async function reportUnconfirmedApproval(
  flow: DepositApprovalFlow,
  cause: unknown,
  approvalHash: `0x${string}` | undefined,
): Promise<never> {
  const causeMessage = sanitizeError(cause);
  const transactionNote = approvalHash ? ` Transaction hash: ${approvalHash}.` : '';
  let remainingAllowance: bigint;
  try {
    remainingAllowance = await flow.readRemainingAllowance();
  } catch (allowanceError) {
    throw new Error(
      `USDC approval was not confirmed${transactionNote} Allowance state is unknown because the read failed (${sanitizeError(allowanceError)}). Approval detail: ${causeMessage} Do not submit the deposit; check the allowance and any pending transaction, then manually confirm USDC approve(${flow.coreAddress}, 0) in your wallet if appropriate. No cleanup transaction was submitted.`,
      { cause: allowanceError },
    );
  }

  if (remainingAllowance > 0n) {
    throw new Error(
      `USDC approval was not confirmed${transactionNote} A current allowance of ${formatUSDC(remainingAllowance)} USDC is approved for ${flow.coreAddress}. The transaction may still be pending. Check it before manually confirming USDC approve(${flow.coreAddress}, 0) in your wallet. No cleanup transaction was submitted. Wallet/RPC detail: ${causeMessage}`,
      { cause },
    );
  }

  throw new Error(
    `USDC approval was not confirmed${transactionNote} The current allowance read is 0 USDC, but a pending transaction could still change it. Check the transaction and allowance before proceeding. No cleanup transaction was submitted. Wallet/RPC detail: ${causeMessage}`,
    { cause },
  );
}

async function reportDepositFailure(
  flow: DepositApprovalFlow,
  cause: unknown,
  depositHash: `0x${string}` | undefined,
): Promise<never> {
  const transactionNote = depositHash ? ` Transaction hash: ${depositHash}.` : '';
  let remainingAllowance: bigint;
  try {
    remainingAllowance = await flow.readRemainingAllowance();
  } catch (allowanceError) {
    throw new Error(
      `Treasury deposit failed${transactionNote} Allowance state is unknown because the read failed (${sanitizeError(allowanceError)}). Check the allowance for ${flow.coreAddress}; if it remains, manually confirm USDC approve(${flow.coreAddress}, 0) in your wallet. No cleanup transaction was submitted. Deposit detail: ${sanitizeError(cause)}`,
      { cause: allowanceError },
    );
  }

  if (remainingAllowance > 0n) {
    throw new Error(
      `Treasury deposit failed${transactionNote} A remaining allowance of ${formatUSDC(remainingAllowance)} USDC is approved for ${flow.coreAddress}. To remove it, manually confirm USDC approve(${flow.coreAddress}, 0) in your wallet. No cleanup transaction was submitted. Deposit detail: ${sanitizeError(cause)}`,
      { cause },
    );
  }

  throw new Error(
    `Treasury deposit failed${transactionNote} The current remaining allowance is 0 USDC. No cleanup transaction was submitted. Deposit detail: ${sanitizeError(cause)}`,
    { cause },
  );
}

export async function runDepositApprovalFlow(flow: DepositApprovalFlow): Promise<`0x${string}`> {
  await flow.preflight();
  await flow.assertCurrentWalletIdentity();

  let approvalHash: `0x${string}`;
  try {
    approvalHash = await flow.approve();
  } catch (cause) {
    return reportUnconfirmedApproval(flow, cause, transactionHashFromError(cause));
  }

  try {
    if (!await flow.waitForApproval(approvalHash)) {
      return reportUnconfirmedApproval(
        flow,
        new Error('Approval transaction receipt reports failure.'),
        approvalHash,
      );
    }
  } catch (cause) {
    return reportUnconfirmedApproval(flow, cause, approvalHash);
  }

  let depositHash: `0x${string}` | undefined;
  try {
    await flow.assertCurrentWalletIdentity();
    depositHash = await flow.submitDeposit();
    if (!await flow.waitForDeposit(depositHash)) {
      throw new Error('Deposit transaction receipt reports failure.');
    }
    return depositHash;
  } catch (cause) {
    return reportDepositFailure(flow, cause, depositHash ?? transactionHashFromError(cause));
  }
}
