import { describe, expect, it, vi } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type PublicClient,
} from 'viem';
import { createDefaultPolicy } from '../../treasury/services/policyService';
import { ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { getArcMainnetTreasuryAddress, veloxTreasuryAbi } from '../../../contracts/treasury';
import {
  formatTransactionAmount,
  mapReceiptStatus,
  prepareTreasuryTransaction,
  readRecentTreasuryTransactions,
  readTransactionHistory,
  validateTransactionRecord,
  verifyCurrentTreasuryCore,
} from './transactionService';

const address = '0x1234567890abcdef1234567890abcdef12345678' as const;
const depositHash = '0xae3a80d30660f82fcbee17067d5b93caf54af8fe7dfdcda07d69811d50aaf8f0' as const;
const depositAmount = 1_000_000n;

describe('transactionService', () => {
  it('formats bigint USDC amounts without float conversion', () => {
    expect(formatTransactionAmount(1_234_567_890_123_456n)).toBe('1,234,567,890.123456 USDC');
  });

  it('maps only an actual receipt status to confirmed or failed', () => {
    expect(mapReceiptStatus({ transactionHash: `0x${'a'.repeat(64)}`, status: 'success', blockNumber: 1n })).toBe('confirmed');
    expect(mapReceiptStatus({ transactionHash: `0x${'a'.repeat(64)}`, status: 'reverted', blockNumber: 1n })).toBe('failed');
  });

  it('rejects wrong-network and policy-violating transaction preparation', () => {
    const policy = { ...createDefaultPolicy(), minimumLiquidReserve: 10_000_000n, dailyOutflowCap: 50_000_000n, maximumSingleWithdrawal: 25_000_000n };
    const result = prepareTreasuryTransaction({ type: 'withdrawal', amount: 30_000_000n, sender: address, chainId: 1, currentBalance: 20_000_000n, policy });
    expect(result.isReady).toBe(false);
    expect(result.errors.join(' ')).toContain('Arc Mainnet');
    expect(result.errors.join(' ')).toContain('spendable');
    expect(result.errors.join(' ')).toContain('maximum single');
  });

  it('does not prepare deposits or withdrawals without a verified contract', () => {
    const result = prepareTreasuryTransaction({ type: 'deposit', amount: 1n, sender: address, chainId: 5042, currentBalance: 1_000_000n, policy: createDefaultPolicy() });
    expect(result.errors.join(' ')).toContain('Pending Treasury contract deployment');
  });

  it('rejects an outflow that would exceed the remaining daily cap', () => {
    const policy = { ...createDefaultPolicy(), dailyOutflowCap: 10_000_000n, maximumSingleWithdrawal: 10_000_000n };
    const result = prepareTreasuryTransaction({ type: 'withdrawal', amount: 3_000_000n, sender: address, chainId: 5042, currentBalance: 3_000_000n, dailyOutflowSpent: 8_000_000n, policy });
    expect(result.errors.join(' ')).toContain('remaining configured 24-hour');
  });

  it('returns an empty history when no real source is configured', async () => {
    await expect(readTransactionHistory(address)).resolves.toEqual([]);
  });

  it('verifies the configured Core chain, bytecode, and USDC identity', async () => {
    const client = {
      getChainId: vi.fn(async () => 5042),
      getBytecode: vi.fn(async () => '0x6000'),
      readContract: vi.fn(async () => ARC_USDC_CONTRACT_ADDRESS),
    } as unknown as PublicClient;

    await expect(verifyCurrentTreasuryCore(client)).resolves.toEqual({
      address: getArcMainnetTreasuryAddress(),
      chainId: 5042,
    });
  });

  it('fails closed when current Core identity verification fails', async () => {
    const wrongChain = {
      getChainId: vi.fn(async () => 1),
      getBytecode: vi.fn(),
      readContract: vi.fn(),
    } as unknown as PublicClient;
    await expect(verifyCurrentTreasuryCore(wrongChain)).rejects.toThrow('Arc Mainnet');

    const noCode = {
      getChainId: vi.fn(async () => 5042),
      getBytecode: vi.fn(async () => '0x'),
      readContract: vi.fn(),
    } as unknown as PublicClient;
    await expect(verifyCurrentTreasuryCore(noCode)).rejects.toThrow('no deployed bytecode');

    const wrongToken = {
      getChainId: vi.fn(async () => 5042),
      getBytecode: vi.fn(async () => '0x6000'),
      readContract: vi.fn(async () => address),
    } as unknown as PublicClient;
    await expect(verifyCurrentTreasuryCore(wrongToken)).rejects.toThrow('does not use the approved');
  });

  it('displays only a deposit whose Core event, call data, transaction, and receipt agree', async () => {
    const core = getArcMainnetTreasuryAddress();
    if (!core) throw new Error('Test requires the configured current Core.');
    const topics = encodeEventTopics({
      abi: veloxTreasuryAbi,
      eventName: 'Deposit',
      args: { user: address },
    });
    const eventData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [depositAmount, depositAmount, depositAmount],
    );
    const depositLog = {
      address: core,
      args: { user: address, amount: depositAmount, userBalance: depositAmount, totalLiabilities: depositAmount },
      blockNumber: 200n,
      logIndex: 4,
      transactionHash: depositHash,
    };
    const receiptLog = {
      address: core,
      topics,
      data: eventData,
      logIndex: 4,
    };
    const client = {
      getChainId: vi.fn(async () => 5042),
      getBlockNumber: vi.fn(async () => 250n),
      getContractEvents: vi.fn()
        .mockResolvedValueOnce([depositLog])
        .mockResolvedValueOnce([]),
      getTransaction: vi.fn(async () => ({
        from: address,
        to: core,
        input: encodeFunctionData({ abi: veloxTreasuryAbi, functionName: 'deposit', args: [depositAmount] }),
      })),
      getTransactionReceipt: vi.fn(async () => ({
        status: 'success',
        blockNumber: 200n,
        logs: [receiptLog],
      })),
      getBlock: vi.fn(async () => ({ timestamp: 1_760_256_992n })),
    } as unknown as PublicClient;

    const history = await readRecentTreasuryTransactions(client, address, { address: core, chainId: 5042 });
    expect(history).toEqual([expect.objectContaining({
      hash: depositHash,
      chainId: 5042,
      rawAmount: depositAmount,
      sender: address,
      recipient: core,
      type: 'deposit',
      status: 'confirmed',
      blockNumber: 200n,
      timestamp: 1_760_256_992n,
    })]);
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: depositHash });
  });

  it('does not display a Core event when its receipt reverted', async () => {
    const core = getArcMainnetTreasuryAddress();
    if (!core) throw new Error('Test requires the configured current Core.');
    const topics = encodeEventTopics({
      abi: veloxTreasuryAbi,
      eventName: 'Deposit',
      args: { user: address },
    });
    const eventData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [depositAmount, depositAmount, depositAmount],
    );
    const client = {
      getChainId: vi.fn(async () => 5042),
      getBlockNumber: vi.fn(async () => 250n),
      getContractEvents: vi.fn()
        .mockResolvedValueOnce([{
          address: core,
          args: { user: address, amount: depositAmount, userBalance: depositAmount, totalLiabilities: depositAmount },
          blockNumber: 200n,
          logIndex: 4,
          transactionHash: depositHash,
        }])
        .mockResolvedValueOnce([]),
      getTransaction: vi.fn(async () => ({
        from: address,
        to: core,
        input: encodeFunctionData({ abi: veloxTreasuryAbi, functionName: 'deposit', args: [depositAmount] }),
      })),
      getTransactionReceipt: vi.fn(async () => ({
        status: 'reverted',
        blockNumber: 200n,
        logs: [{ address: core, topics, data: eventData, logIndex: 4 }],
      })),
      getBlock: vi.fn(async () => ({ timestamp: 1_760_256_992n })),
    } as unknown as PublicClient;

    await expect(readRecentTreasuryTransactions(client, address, { address: core, chainId: 5042 }))
      .rejects.toThrow('successful Treasury Core receipt');
  });

  it('rejects malformed records instead of exposing fabricated transaction data', () => {
    expect(validateTransactionRecord({ hash: '0x1234', chainId: 5042, asset: 'USDC', rawAmount: 0n, sender: address, recipient: address, type: 'deposit', status: 'confirmed' })).not.toEqual([]);
  });
});
