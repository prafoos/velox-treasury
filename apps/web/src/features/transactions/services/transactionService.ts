import type { TreasuryPolicyModel, TreasuryTransactionModel, TreasuryTransactionStatus, TreasuryTransactionType } from '@velox/domain';
import {
  decodeFunctionData,
  parseEventLogs,
  type Address,
  type PublicClient,
} from 'viem';

import { arcMainnet } from '../../../config/arc';
import {
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  getArcMainnetTreasuryAddress,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { formatUSDC } from '../../usdc/services/usdcService';
import { readLogsInBlockChunks, resolveLogQueryChunkSize } from '../../treasury/services/contractEventPagination';
import { assertApprovedDepositCore } from '../../treasury/services/depositPreflight';

export interface TransactionReceiptSource {
  readonly transactionHash: `0x${string}`;
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
}

export interface TransactionPreparationInput {
  readonly type: TreasuryTransactionType;
  readonly amount: bigint;
  readonly sender: `0x${string}`;
  readonly recipient?: `0x${string}`;
  readonly chainId?: number;
  readonly currentBalance: bigint;
  readonly dailyOutflowSpent?: bigint;
  readonly policy: TreasuryPolicyModel;
  /** Undefined until a deployed, verified treasury contract is supplied in a later step. */
  readonly verifiedTreasuryContract?: `0x${string}`;
}

export interface TransactionPreparationResult {
  readonly isReady: boolean;
  readonly errors: readonly string[];
}

export interface TransactionHistorySource {
  readByAddress(address: `0x${string}`, chainId: number): Promise<readonly TreasuryTransactionModel[]>;
}

export interface VerifiedTreasuryCore {
  readonly address: Address;
  readonly chainId: typeof ARC_MAINNET_CHAIN_ID;
}

const RECENT_TRANSACTION_BLOCK_WINDOW = 100_000n;
const MAX_RECENT_TRANSACTION_COUNT = 50;

export function formatTransactionAmount(amount: bigint): string {
  return `${formatUSDC(amount)} USDC`;
}

export function mapReceiptStatus(receipt: TransactionReceiptSource): TreasuryTransactionStatus {
  return receipt.status === 'success' ? 'confirmed' : 'failed';
}

export function createArcExplorerUrl(hash: `0x${string}`): string {
  return new URL(`/tx/${hash}`, arcMainnet.blockExplorers.default.url).toString();
}

export function validateTransactionRecord(record: TreasuryTransactionModel): readonly string[] {
  const errors: string[] = [];
  if (!/^0x[a-fA-F0-9]{64}$/.test(record.hash)) errors.push('Transaction hash must be a real 32-byte hash.');
  if (record.chainId !== arcMainnet.id) errors.push('Transaction must be on Arc Mainnet.');
  if (record.rawAmount < 0n) errors.push('Transaction amount cannot be negative.');
  if (!/^0x[a-fA-F0-9]{40}$/.test(record.sender) || !/^0x[a-fA-F0-9]{40}$/.test(record.recipient)) errors.push('Transaction addresses are invalid.');
  return errors;
}

export async function verifyCurrentTreasuryCore(
  client: Pick<PublicClient, 'getChainId' | 'getBytecode' | 'readContract'>,
): Promise<VerifiedTreasuryCore> {
  const configuredCore = getArcMainnetTreasuryAddress();
  if (!configuredCore) throw new Error('The approved current Treasury Core is not configured.');

  const chainId = await client.getChainId();
  if (chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`Treasury Core verification requires Arc Mainnet (Chain ID ${ARC_MAINNET_CHAIN_ID}); received ${chainId}.`);
  }
  assertApprovedDepositCore(configuredCore, APPROVED_ARC_MAINNET_CORE_ADDRESS);

  const bytecode = await client.getBytecode({ address: configuredCore });
  if (!bytecode || bytecode === '0x') {
    throw new Error('The approved current Treasury Core has no deployed bytecode on Arc Mainnet.');
  }
  const coreUsdc = await client.readContract({
    address: configuredCore,
    abi: veloxTreasuryAbi,
    functionName: 'usdc',
  });
  if (coreUsdc.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error('The approved current Treasury Core does not use the approved Arc Mainnet USDC contract.');
  }

  return { address: configuredCore, chainId };
}

type RecentTreasuryEvent = {
  readonly type: 'deposit' | 'withdrawal';
  readonly hash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly amount: bigint;
  readonly sender: Address;
  readonly recipient: Address;
};

export async function readRecentTreasuryTransactions(
  client: PublicClient,
  account: Address,
  verifiedCore: VerifiedTreasuryCore,
): Promise<readonly TreasuryTransactionModel[]> {
  const chainId = await client.getChainId();
  if (chainId !== ARC_MAINNET_CHAIN_ID || verifiedCore.chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('Recent Treasury history requires a verified Arc Mainnet RPC.');
  }
  assertApprovedDepositCore(verifiedCore.address, APPROVED_ARC_MAINNET_CORE_ADDRESS);

  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock >= RECENT_TRANSACTION_BLOCK_WINDOW - 1n
    ? latestBlock - RECENT_TRANSACTION_BLOCK_WINDOW + 1n
    : 0n;
  const chunkSize = resolveLogQueryChunkSize(import.meta.env.VITE_ARC_MAINNET_LOG_CHUNK_SIZE);
  const [deposits, withdrawals] = await Promise.all([
    readLogsInBlockChunks(fromBlock, latestBlock, (from, to) => client.getContractEvents({
      address: verifiedCore.address,
      abi: veloxTreasuryAbi,
      eventName: 'Deposit',
      args: { user: account },
      fromBlock: from,
      toBlock: to,
    }), chunkSize),
    readLogsInBlockChunks(fromBlock, latestBlock, (from, to) => client.getContractEvents({
      address: verifiedCore.address,
      abi: veloxTreasuryAbi,
      eventName: 'Withdrawal',
      args: { user: account },
      fromBlock: from,
      toBlock: to,
    }), chunkSize),
  ]);

  const events: RecentTreasuryEvent[] = [
    ...deposits.map((log): RecentTreasuryEvent => {
      if (!log.args.user || log.args.amount === undefined || log.blockNumber === null
        || log.logIndex === null || !log.transactionHash) {
        throw new Error('Arc Mainnet returned an incomplete Core Deposit event.');
      }
      return {
        type: 'deposit',
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        amount: log.args.amount,
        sender: log.args.user,
        recipient: verifiedCore.address,
      };
    }),
    ...withdrawals.map((log): RecentTreasuryEvent => {
      if (!log.args.user || !log.args.recipient || log.args.amount === undefined
        || log.blockNumber === null || log.logIndex === null || !log.transactionHash) {
        throw new Error('Arc Mainnet returned an incomplete Core Withdrawal event.');
      }
      return {
        type: 'withdrawal',
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        amount: log.args.amount,
        sender: log.args.user,
        recipient: log.args.recipient,
      };
    }),
  ].sort((left, right) => (
    left.blockNumber === right.blockNumber
      ? right.logIndex - left.logIndex
      : left.blockNumber > right.blockNumber ? -1 : 1
  )).slice(0, MAX_RECENT_TRANSACTION_COUNT);

  const transactions: TreasuryTransactionModel[] = [];
  for (let index = 0; index < events.length; index += 5) {
    const batch = events.slice(index, index + 5);
    const verifiedBatch = await Promise.all(batch.map(async (event) => {
      const [transaction, receipt, block] = await Promise.all([
        client.getTransaction({ hash: event.hash }),
        client.getTransactionReceipt({ hash: event.hash }),
        client.getBlock({ blockNumber: event.blockNumber }),
      ]);
      if (receipt.status !== 'success'
        || receipt.blockNumber !== event.blockNumber
        || transaction.to?.toLowerCase() !== verifiedCore.address.toLowerCase()
        || transaction.from.toLowerCase() !== event.sender.toLowerCase()) {
        throw new Error(`Transaction ${event.hash} does not match a successful Treasury Core receipt.`);
      }

      const receiptLog = receipt.logs.find((log) => (
        log.address.toLowerCase() === verifiedCore.address.toLowerCase()
        && log.logIndex === event.logIndex
      ));
      if (!receiptLog) throw new Error(`Transaction ${event.hash} receipt does not contain the queried Core event.`);
      const decodedEvents = parseEventLogs({ abi: veloxTreasuryAbi, logs: [receiptLog] });
      const decodedEvent = decodedEvents.find((entry) => entry.eventName === (event.type === 'deposit' ? 'Deposit' : 'Withdrawal'));
      if (!decodedEvent) throw new Error(`Transaction ${event.hash} receipt does not contain the expected Core event.`);
      const decodedCall = decodeFunctionData({ abi: veloxTreasuryAbi, data: transaction.input });
      if (event.type === 'deposit') {
        if (decodedEvent.eventName !== 'Deposit'
          || decodedEvent.args.user.toLowerCase() !== event.sender.toLowerCase()
          || decodedEvent.args.amount !== event.amount
          || decodedCall.functionName !== 'deposit'
          || decodedCall.args[0] !== event.amount) {
          throw new Error(`Transaction ${event.hash} does not match its Core Deposit event.`);
        }
      } else if (decodedEvent.eventName !== 'Withdrawal'
        || decodedEvent.args.user.toLowerCase() !== event.sender.toLowerCase()
        || decodedEvent.args.recipient.toLowerCase() !== event.recipient.toLowerCase()
        || decodedEvent.args.amount !== event.amount
        || !(
          (decodedCall.functionName === 'withdraw'
            && decodedCall.args[0] === event.amount
            && decodedCall.args[1].toLowerCase() === event.recipient.toLowerCase())
          || (decodedCall.functionName === 'withdrawWithDeallocation'
            && decodedCall.args[0] === event.amount
            && decodedCall.args[1].toLowerCase() === event.recipient.toLowerCase())
        )) {
        throw new Error(`Transaction ${event.hash} does not match its Core Withdrawal event.`);
      }

      return {
        hash: event.hash,
        chainId: ARC_MAINNET_CHAIN_ID,
        asset: 'USDC' as const,
        rawAmount: event.amount,
        sender: event.sender,
        recipient: event.recipient,
        type: event.type,
        status: mapReceiptStatus({
          transactionHash: event.hash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
        }),
        blockNumber: event.blockNumber,
        timestamp: block.timestamp,
        explorerUrl: createArcExplorerUrl(event.hash),
      } satisfies TreasuryTransactionModel;
    }));
    transactions.push(...verifiedBatch);
  }

  return transactions;
}

export function createArcMainnetTransactionHistorySource(
  client: PublicClient,
  verifiedCore: VerifiedTreasuryCore,
): TransactionHistorySource {
  return {
    readByAddress: async (address, chainId) => {
      if (chainId !== ARC_MAINNET_CHAIN_ID) {
        throw new Error(`Transaction history is available only on Arc Mainnet (Chain ID ${ARC_MAINNET_CHAIN_ID}).`);
      }
      return readRecentTreasuryTransactions(client, address, verifiedCore);
    },
  };
}

/**
 * Validates a potential write at execution time. It does not submit a wallet request.
 * Deposit and withdrawal preparation remains unavailable without a verified treasury contract.
 */
export function prepareTreasuryTransaction(input: TransactionPreparationInput): TransactionPreparationResult {
  const errors: string[] = [];
  if (input.chainId !== arcMainnet.id) errors.push('Connect to Arc Mainnet before preparing a transaction.');
  if (input.amount <= 0n) errors.push('Transaction amount must be greater than zero.');
  const spendable = input.currentBalance > input.policy.minimumLiquidReserve
    ? input.currentBalance - input.policy.minimumLiquidReserve
    : 0n;
  if (input.amount > spendable) errors.push(`Amount exceeds the ${formatUSDC(spendable)} USDC spendable balance after reserve.`);
  if (input.amount > input.policy.maximumSingleWithdrawal) errors.push('Amount exceeds the configured maximum single withdrawal.');
  const dailyOutflowSpent = input.dailyOutflowSpent ?? 0n;
  if (dailyOutflowSpent < 0n) errors.push('Tracked 24-hour outflow cannot be negative.');
  if (dailyOutflowSpent + input.amount > input.policy.dailyOutflowCap) errors.push('Amount exceeds the remaining configured 24-hour outflow cap.');
  if (!input.verifiedTreasuryContract) errors.push('Pending Treasury contract deployment: no verified contract is available.');
  return { isReady: errors.length === 0, errors };
}

/** No production indexer is configured yet, so no records are returned rather than fabricated. */
export async function readTransactionHistory(
  address: `0x${string}` | undefined,
  source?: TransactionHistorySource,
): Promise<readonly TreasuryTransactionModel[]> {
  if (!address || !source) return [];
  const records = await source.readByAddress(address, arcMainnet.id);
  return records.filter((record) => validateTransactionRecord(record).length === 0);
}

/** Write submission is deliberately unavailable until a verified treasury contract is configured. */
export async function submitPreparedTransaction(): Promise<never> {
  throw new Error('Transaction submission is disabled pending verified Treasury contract deployment.');
}
