import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, keccak256, toBytes } from 'viem';

import { ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import {
  assertDepositPreflight,
  createDepositApprovalFlow,
  hasExpectedDepositEvent,
  runDepositApprovalFlow,
  verifyDepositPreflight,
  type DepositApprovalFlowPorts,
  type DepositPreflightIdentity,
  type DepositPreflightPorts,
} from './depositPreflight';

const approvedCore = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';
const otherAddress = '0x2222222222222222222222222222222222222222';
const userAddress = '0x1111111111111111111111111111111111111111';
const amount = 1_250_000n;
const approvalHash = `0x${'a'.repeat(64)}` as `0x${string}`;
const depositHash = `0x${'b'.repeat(64)}` as `0x${string}`;

function validIdentity(overrides: Partial<DepositPreflightIdentity> = {}): DepositPreflightIdentity {
  return {
    walletChainId: 5042,
    rpcChainId: 5042,
    configuredCoreAddress: approvedCore,
    approvedCoreAddress: approvedCore,
    coreUsdcAddress: ARC_USDC_CONTRACT_ADDRESS,
    configuredUsdcAddress: ARC_USDC_CONTRACT_ADDRESS,
    ...overrides,
  };
}

function preflightPorts(overrides: Partial<DepositPreflightPorts> = {}): DepositPreflightPorts {
  return {
    configuredCoreAddress: approvedCore,
    approvedCoreAddress: approvedCore,
    configuredUsdcAddress: ARC_USDC_CONTRACT_ADDRESS,
    getWalletChainId: async () => 5042,
    getRpcChainId: async () => 5042,
    getCoreBytecode: async () => '0x60016000',
    getCoreUsdcAddress: async () => ARC_USDC_CONTRACT_ADDRESS,
    ...overrides,
  };
}

function flowPorts(overrides: Partial<DepositApprovalFlowPorts> = {}) {
  const writes = {
    approval: vi.fn(overrides.writeApproval ?? (async () => approvalHash)),
    deposit: vi.fn(overrides.writeDeposit ?? (async () => depositHash)),
  };
  const waits = {
    approval: vi.fn(overrides.waitForApproval ?? (async () => true)),
    deposit: vi.fn(overrides.waitForDeposit ?? (async () => true)),
  };
  const reads = { allowance: vi.fn(overrides.readRemainingAllowance ?? (async () => 0n)) };
  const ports: DepositApprovalFlowPorts = {
    assertCurrentWalletIdentity: overrides.assertCurrentWalletIdentity ?? (async () => undefined),
    preflight: overrides.preflight ?? (async () => undefined),
    writeApproval: writes.approval,
    waitForApproval: waits.approval,
    writeDeposit: writes.deposit,
    waitForDeposit: waits.deposit,
    readRemainingAllowance: reads.allowance,
    account: userAddress,
    chainId: 5042,
    tokenAddress: ARC_USDC_CONTRACT_ADDRESS,
    coreAddress: approvedCore,
    amount,
  };
  return { flow: createDepositApprovalFlow(ports), writes, waits, reads };
}

function depositEvent(eventAmount: bigint) {
  return {
    address: approvedCore as `0x${string}`,
    topics: [
      keccak256(toBytes('Deposit(address,uint256,uint256,uint256)')),
      `0x${userAddress.slice(2).padStart(64, '0')}` as `0x${string}`,
    ],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [eventAmount, eventAmount, eventAmount],
    ),
  } as const;
}

describe('deposit preflight', () => {
  it('accepts only verified chain 5042 and the deployed approved Core/USDC pair', async () => {
    const calls: string[] = [];
    await expect(verifyDepositPreflight(preflightPorts({
      getWalletChainId: async () => { calls.push('wallet-chain'); return 5042; },
      getRpcChainId: async () => { calls.push('relay-chain'); return 5042; },
      getCoreBytecode: async () => { calls.push('core-bytecode'); return '0x60016000'; },
      getCoreUsdcAddress: async () => { calls.push('core-usdc'); return ARC_USDC_CONTRACT_ADDRESS; },
    }))).resolves.toBeUndefined();
    expect(calls).toEqual(['wallet-chain', 'relay-chain', 'core-bytecode', 'core-usdc']);
  });

  it('rejects a wrong wallet chain before reading further identity or requesting approval', async () => {
    const getRpcChainId = vi.fn(async () => 5042);
    await expect(verifyDepositPreflight(preflightPorts({
      getWalletChainId: async () => 1,
      getRpcChainId,
    }))).rejects.toThrow('connected wallet to be on Arc Mainnet (Chain ID 5042)');
    expect(getRpcChainId).not.toHaveBeenCalled();
  });

  it('rejects a wrong RPC chain before reading Core identity', async () => {
    const getCoreBytecode = vi.fn(async () => '0x60016000' as `0x${string}`);
    await expect(verifyDepositPreflight(preflightPorts({
      getRpcChainId: async () => 1,
      getCoreBytecode,
    }))).rejects.toThrow('Treasury RPC is not verified on Arc Mainnet');
    expect(getCoreBytecode).not.toHaveBeenCalled();
  });

  it('rejects a Core address that is not the approved current Core', async () => {
    const getCoreBytecode = vi.fn(async () => '0x60016000' as `0x${string}`);
    await expect(verifyDepositPreflight(preflightPorts({
      configuredCoreAddress: otherAddress,
      getCoreBytecode,
    }))).rejects.toThrow('not the approved current Core');
    expect(getCoreBytecode).not.toHaveBeenCalled();
  });

  it.each([undefined, '0x'])('rejects missing Core bytecode (%s)', async (bytecode) => {
    await expect(verifyDepositPreflight(preflightPorts({
      getCoreBytecode: async () => bytecode as `0x${string}` | undefined,
    }))).rejects.toThrow('no deployed bytecode');
  });

  it('rejects a Core that reports the wrong USDC address', async () => {
    await expect(verifyDepositPreflight(preflightPorts({
      getCoreUsdcAddress: async () => otherAddress,
    }))).rejects.toThrow('does not use the approved Arc Mainnet USDC contract');
  });

  it('preserves direct identity assertion coverage', () => {
    expect(() => assertDepositPreflight(validIdentity({ walletChainId: 1 })))
      .toThrow('connected wallet to be on Arc Mainnet (Chain ID 5042)');
    expect(() => assertDepositPreflight(validIdentity({ rpcChainId: 1 })))
      .toThrow('Treasury RPC is not verified on Arc Mainnet');
  });

  it('stops before approval when preflight fails', async () => {
    const { flow, writes } = flowPorts({
      preflight: () => verifyDepositPreflight(preflightPorts({ getRpcChainId: async () => 1 })),
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('Treasury RPC is not verified');
    expect(writes.approval).not.toHaveBeenCalled();
    expect(writes.deposit).not.toHaveBeenCalled();
  });

  it('binds approval spender, Core destination, wallet, chain, and exact bigint units', async () => {
    const { flow, writes } = flowPorts();
    await expect(runDepositApprovalFlow(flow)).resolves.toBe(depositHash);
    expect(writes.approval).toHaveBeenCalledWith({
      account: userAddress,
      chainId: 5042,
      tokenAddress: ARC_USDC_CONTRACT_ADDRESS,
      spender: approvedCore,
      amount,
    });
    expect(writes.deposit).toHaveBeenCalledWith({
      account: userAddress,
      chainId: 5042,
      coreAddress: approvedCore,
      amount,
    });
  });

  it('aborts before approval if the account changes before the first write', async () => {
    const { flow, writes } = flowPorts({
      assertCurrentWalletIdentity: async () => {
        throw new Error('The connected wallet account changed.');
      },
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('connected wallet account changed');
    expect(writes.approval).not.toHaveBeenCalled();
    expect(writes.deposit).not.toHaveBeenCalled();
  });

  it('does not submit the deposit if the account changes after approval', async () => {
    const assertCurrentWalletIdentity = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('The connected wallet account changed.'));
    const { flow, writes, reads } = flowPorts({ assertCurrentWalletIdentity });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('connected wallet account changed');
    expect(writes.approval).toHaveBeenCalledOnce();
    expect(writes.deposit).not.toHaveBeenCalled();
    expect(reads.allowance).toHaveBeenCalledOnce();
  });

  it('reports approval rejection and checks allowance without submitting deposit', async () => {
    const { flow, writes, reads } = flowPorts({
      writeApproval: async () => { throw new Error('User rejected approval.'); },
      readRemainingAllowance: async () => amount,
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('A current allowance of 1.25 USDC');
    expect(writes.deposit).not.toHaveBeenCalled();
    expect(reads.allowance).toHaveBeenCalledOnce();
  });

  it('reports an unsuccessful approval receipt and does not deposit', async () => {
    const { flow, writes, waits, reads } = flowPorts({
      waitForApproval: async () => false,
      readRemainingAllowance: async () => 0n,
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('approval was not confirmed');
    expect(waits.approval).toHaveBeenCalledWith(approvalHash);
    expect(writes.deposit).not.toHaveBeenCalled();
    expect(reads.allowance).toHaveBeenCalledOnce();
  });

  it('handles ambiguous approval receipt wait errors and reports positive allowance and hash', async () => {
    const { flow, writes, reads } = flowPorts({
      waitForApproval: async () => { throw new Error('Receipt wait timed out.'); },
      readRemainingAllowance: async () => amount,
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow(
      `Transaction hash: ${approvalHash}. A current allowance of 1.25 USDC`,
    );
    expect(writes.deposit).not.toHaveBeenCalled();
    expect(reads.allowance).toHaveBeenCalledOnce();
  });

  it('reports allowance as unknown if the ambiguous approval allowance read fails', async () => {
    const { flow, writes } = flowPorts({
      waitForApproval: async () => { throw new Error('Receipt wait timed out.'); },
      readRemainingAllowance: async () => { throw new Error('Allowance RPC unavailable.'); },
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('Allowance state is unknown');
    expect(writes.deposit).not.toHaveBeenCalled();
  });

  it('checks and reports residual allowance after deposit rejection', async () => {
    const { flow, writes, reads } = flowPorts({
      writeDeposit: async () => { throw new Error('User rejected deposit.'); },
      readRemainingAllowance: async () => amount,
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow('A remaining allowance of 1.25 USDC');
    expect(writes.approval).toHaveBeenCalledOnce();
    expect(writes.deposit).toHaveBeenCalledOnce();
    expect(reads.allowance).toHaveBeenCalledOnce();
  });

  it('checks allowance after a failed deposit receipt and reports unknown if that read fails', async () => {
    const { flow, writes } = flowPorts({
      waitForDeposit: async () => false,
      readRemainingAllowance: async () => { throw new Error('Allowance RPC unavailable.'); },
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow(
      `Transaction hash: ${depositHash}. Allowance state is unknown`,
    );
    expect(writes.deposit).toHaveBeenCalledOnce();
  });

  it('rejects a receipt that does not contain the expected Core Deposit event', async () => {
    const event = depositEvent(amount + 1n);
    expect(hasExpectedDepositEvent(
      [event],
      approvedCore,
      userAddress,
      amount,
    )).toBe(false);

    const { flow, reads } = flowPorts({
      waitForDeposit: async () => {
        if (!hasExpectedDepositEvent([event], approvedCore, userAddress, amount)) {
          throw new Error('Deposit confirmation did not include the expected Treasury Deposit event');
        }
        return true;
      },
      readRemainingAllowance: async () => 0n,
    });
    await expect(runDepositApprovalFlow(flow)).rejects.toThrow(
      'Deposit detail: Deposit confirmation did not include',
    );
    expect(reads.allowance).toHaveBeenCalledOnce();
  });

  it('validates the expected Deposit event from the verified Core for the exact user and amount', () => {
    const event = depositEvent(amount);
    expect(hasExpectedDepositEvent([event], approvedCore, userAddress, amount)).toBe(true);
    expect(hasExpectedDepositEvent([{ ...event, address: otherAddress }], approvedCore, userAddress, amount)).toBe(false);
    expect(hasExpectedDepositEvent([event], approvedCore, otherAddress, amount)).toBe(false);
  });
});
