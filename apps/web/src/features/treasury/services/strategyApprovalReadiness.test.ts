import { describe, expect, it, vi } from 'vitest';
import { zeroAddress } from 'viem';

import { ARC_USDC_CONTRACT_ADDRESS, ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { APPROVAL_ABSOLUTE_CAP, APPROVAL_RELATIVE_CAP_BPS } from './approvalScheduling';
import {
  APPROVAL_TIMELOCK_DELAY,
  assertApprovalExecutionReady,
  executeScheduledStrategyApproval,
  executeScheduledApproval,
  matchesApprovalOperationPayload,
  PROTOCOL_APPROVAL_OPERATION_KIND,
  scheduleSteakhouseStrategyApproval,
  STEAKHOUSE_STRATEGY_ADDRESS,
  STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID,
  STEAKHOUSE_PROTOCOL_APPROVAL_OPERATION_ID,
  USDC_ASSET_APPROVAL_OPERATION_ID,
  strategyApprovalBlockers,
  strategyApprovalExecutionBlockers,
  STRATEGY_APPROVAL_OPERATION_KIND,
  verifyApprovalExecutionReadback,
  type ApprovalExecutionPorts,
  type ApprovalPendingOperation,
  type StrategyApprovalPreflight,
  type StrategyApprovalExecutionState,
  type StrategyApprovalSchedulingPorts,
} from './strategyApprovalReadiness';
import {
  STEAKHOUSE_CORE_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from './protocolVaultMapping';

const operationId = `0x${'1'.repeat(64)}` as `0x${string}`;
const hash = `0x${'2'.repeat(64)}` as `0x${string}`;

function preflight(overrides: Partial<StrategyApprovalPreflight> = {}): StrategyApprovalPreflight {
  return {
    chainId: ARC_MAINNET_CHAIN_ID,
    coreAddress: STEAKHOUSE_CORE_ADDRESS,
    policyAdminRole: true,
    adapterHasCode: true,
    adapterProtocol: STEAKHOUSE_PROTOCOL_ID,
    adapterAsset: ARC_USDC_CONTRACT_ADDRESS,
    adapterVault: STEAKHOUSE_VAULT_ADDRESS,
    coreProtocolVault: STEAKHOUSE_VAULT_ADDRESS,
    coreUSDC: ARC_USDC_CONTRACT_ADDRESS,
    protocolApproval: { approved: true, enabled: true },
    assetApproval: { approved: true, enabled: true },
    strategyApproval: { approved: false, enabled: false },
    paused: false,
    ...overrides,
  };
}

function strategyOperation(): ApprovalPendingOperation {
  return {
    kind: STRATEGY_APPROVAL_OPERATION_KIND,
    eta: 1234n,
    subject: STEAKHOUSE_STRATEGY_ADDRESS,
    secondary: STEAKHOUSE_PROTOCOL_ID,
    tertiary: ARC_USDC_CONTRACT_ADDRESS,
    value1: APPROVAL_ABSOLUTE_CAP,
    value2: 0n,
    bps: APPROVAL_RELATIVE_CAP_BPS,
    bps2: 0,
    bps3: 0,
    bps4: 0,
  };
}

function strategyExecutionState(
  overrides: Partial<StrategyApprovalExecutionState> = {},
): StrategyApprovalExecutionState {
  return {
    chainId: ARC_MAINNET_CHAIN_ID,
    coreAddress: STEAKHOUSE_CORE_ADDRESS,
    policyAdminRole: false,
    executorRole: true,
    paused: false,
    now: 1234n,
    operation: strategyOperation(),
    adapterHasCode: true,
    adapterProtocol: STEAKHOUSE_PROTOCOL_ID,
    adapterAsset: ARC_USDC_CONTRACT_ADDRESS,
    adapterVault: STEAKHOUSE_VAULT_ADDRESS,
    coreUSDC: ARC_USDC_CONTRACT_ADDRESS,
    coreProtocolVault: STEAKHOUSE_VAULT_ADDRESS,
    protocolApproval: { approved: true, enabled: true },
    assetApproval: { approved: true, enabled: true },
    strategyShares: 0n,
    strategyPosition: 0n,
    adapterCurrentValue: 0n,
    strategyApproved: false,
    strategyEnabled: false,
    ...overrides,
  };
}

function schedulingPorts(
  state = preflight(),
  overrides: Partial<StrategyApprovalSchedulingPorts> = {},
): StrategyApprovalSchedulingPorts {
  return {
    preflight: vi.fn(async () => state),
    submit: vi.fn(async () => hash),
    waitForReceipt: vi.fn(async () => ({
      status: 'success' as const,
      blockNumber: 5678n,
      operationId,
      scheduledEta: 1234n,
    })),
    readPendingOperation: vi.fn(async () => strategyOperation()),
    ...overrides,
  };
}

function approvalOperation(kind: 'protocol' | 'asset' = 'protocol'): ApprovalPendingOperation {
  return {
    kind: kind === 'protocol' ? PROTOCOL_APPROVAL_OPERATION_KIND : 2,
    eta: 1234n,
    subject: kind === 'protocol' ? zeroAddress : ARC_USDC_CONTRACT_ADDRESS,
    secondary: kind === 'protocol' ? STEAKHOUSE_PROTOCOL_ID : `0x${'0'.repeat(64)}`,
    tertiary: zeroAddress,
    value1: APPROVAL_ABSOLUTE_CAP,
    value2: 0n,
    bps: APPROVAL_RELATIVE_CAP_BPS,
    bps2: 0,
    bps3: 0,
    bps4: 0,
  };
}

function executionPorts(overrides: Partial<ApprovalExecutionPorts> = {}): ApprovalExecutionPorts {
  return {
    getChainId: vi.fn(async () => ARC_MAINNET_CHAIN_ID),
    hasExecutorRole: vi.fn(async () => true),
    readTimelockDelay: vi.fn(async () => APPROVAL_TIMELOCK_DELAY),
    readCurrentTimestamp: vi.fn(async () => 1234n),
    readPendingOperation: vi.fn(async () => approvalOperation()),
    submit: vi.fn(async () => hash),
    waitForReceipt: vi.fn(async () => ({ status: 'success' as const, blockNumber: 7890n })),
    readProtocolCaps: vi.fn(async () => ({
      absoluteCap: APPROVAL_ABSOLUTE_CAP,
      relativeCapBps: APPROVAL_RELATIVE_CAP_BPS,
      approved: true,
      enabled: true,
    })),
    readAssetCaps: vi.fn(async () => ({
      absoluteCap: APPROVAL_ABSOLUTE_CAP,
      relativeCapBps: APPROVAL_RELATIVE_CAP_BPS,
      approved: true,
      enabled: true,
    })),
    ...overrides,
  };
}

describe('strategy approval readiness', () => {
  it('blocks strategy scheduling until both protocol and asset approvals are executed and enabled', async () => {
    const blocked = preflight({
      protocolApproval: { approved: false, enabled: false },
      assetApproval: { approved: false, enabled: false },
    });
    const blockers = strategyApprovalBlockers(blocked);
    expect(blockers.join(' ')).toMatch(/Protocol Approval is BLOCKED/);
    expect(blockers.join(' ')).toMatch(/USDC Asset Approval is BLOCKED/);

    const ports = schedulingPorts(blocked);
    await expect(scheduleSteakhouseStrategyApproval(ports)).rejects.toThrow(/BLOCKED/);
    expect(ports.submit).not.toHaveBeenCalled();
  });

  it('blocks mismatched adapter, Core, or missing role preflight', () => {
    const blockers = strategyApprovalBlockers(preflight({
      policyAdminRole: false,
      adapterHasCode: false,
      adapterProtocol: `0x${'1'.repeat(64)}`,
      adapterAsset: zeroAddress,
      adapterVault: zeroAddress,
      coreProtocolVault: zeroAddress,
    }));
    expect(blockers.join(' ')).toMatch(/POLICY_ADMIN_ROLE/);
    expect(blockers.join(' ')).toMatch(/no deployed bytecode/);
    expect(blockers.join(' ')).toMatch(/protocol does not match/);
    expect(blockers.join(' ')).toMatch(/asset does not match/);
    expect(blockers.join(' ')).toMatch(/vault does not match/);
    expect(blockers.join(' ')).toMatch(/Core protocolVaults mapping/);
  });

  it('schedules only the exact Strategy Approval after all guards pass and verifies pending payload', async () => {
    const ports = schedulingPorts();
    await expect(scheduleSteakhouseStrategyApproval(ports)).resolves.toEqual({
      hash,
      blockNumber: 5678n,
      operationId,
      eta: 1234n,
    });
    expect(ports.submit).toHaveBeenCalledOnce();
    expect(ports.submit).toHaveBeenCalledWith(
      STEAKHOUSE_STRATEGY_ADDRESS,
      STEAKHOUSE_PROTOCOL_ID,
      ARC_USDC_CONTRACT_ADDRESS,
      APPROVAL_ABSOLUTE_CAP,
      APPROVAL_RELATIVE_CAP_BPS,
    );
  });

  it('requires TIMELOCK_EXECUTOR_ROLE and elapsed two-day timelock for manual execution', () => {
    expect(() => assertApprovalExecutionReady({
      chainId: ARC_MAINNET_CHAIN_ID,
      executorRole: false,
      timelockDelay: APPROVAL_TIMELOCK_DELAY,
      now: 1234n,
      approval: 'protocol',
      operation: approvalOperation(),
    })).toThrow(/TIMELOCK_EXECUTOR_ROLE/);
    expect(() => assertApprovalExecutionReady({
      chainId: ARC_MAINNET_CHAIN_ID,
      executorRole: true,
      timelockDelay: APPROVAL_TIMELOCK_DELAY,
      now: 1233n,
      approval: 'protocol',
      operation: approvalOperation(),
    })).toThrow(/timelock has not elapsed/);
  });

  it('allows a ready executor and does not require POLICY_ADMIN_ROLE for execution', () => {
    expect(strategyApprovalExecutionBlockers(strategyExecutionState())).toEqual([]);
    expect(strategyApprovalExecutionBlockers(strategyExecutionState({
      policyAdminRole: true,
      executorRole: false,
    }))).toContain(
      'Connected wallet has POLICY_ADMIN_ROLE for scheduling, but execution requires TIMELOCK_EXECUTOR_ROLE.',
    );
  });

  it('blocks a wallet without TIMELOCK_EXECUTOR_ROLE', () => {
    expect(strategyApprovalExecutionBlockers(strategyExecutionState({
      executorRole: false,
    }))).toContain('Connected wallet does not have TIMELOCK_EXECUTOR_ROLE on the live Core.');
  });

  it('blocks a non-pending operation and an operation whose live ETA has not elapsed', () => {
    const noPendingOperationBlockers = strategyApprovalExecutionBlockers(strategyExecutionState({
      operation: { ...strategyOperation(), eta: 0n, secondary: `0x${'0'.repeat(64)}`, tertiary: zeroAddress },
    }));
    expect(noPendingOperationBlockers).toContain('Strategy Approval operation is no longer pending.');
    expect(noPendingOperationBlockers).not.toContain('Adapter protocol does not match the pending operation.');
    expect(noPendingOperationBlockers).not.toContain('Adapter asset does not match the pending operation.');
    expect(strategyApprovalExecutionBlockers(strategyExecutionState({
      now: 1233n,
    }))).toContain('Strategy Approval timelock has not elapsed.');
  });

  it('does not block an already executed approval on a wallet without the executor role', () => {
    expect(strategyApprovalExecutionBlockers(strategyExecutionState({
      policyAdminRole: true,
      executorRole: false,
      operation: { ...strategyOperation(), eta: 0n, secondary: `0x${'0'.repeat(64)}`, tertiary: zeroAddress },
      strategyApproved: true,
      strategyEnabled: true,
    }))).toEqual([]);
  });

  it('blocks execution when the Core is paused', () => {
    expect(strategyApprovalExecutionBlockers(strategyExecutionState({
      paused: true,
    }))).toContain('Core is paused.');
  });

  it('blocks execution unless protocol and asset approvals are approved and enabled', () => {
    const blockers = strategyApprovalExecutionBlockers(strategyExecutionState({
      protocolApproval: { approved: true, enabled: false },
      assetApproval: { approved: false, enabled: false },
    }));
    expect(blockers).toContain('Protocol approval must be approved and enabled before Strategy Approval execution.');
    expect(blockers).toContain('Asset approval must be approved and enabled before Strategy Approval execution.');
  });

  it('blocks an active strategy and an adapter that does not match configured identities or the Core mapping', () => {
    const blockers = strategyApprovalExecutionBlockers(strategyExecutionState({
      strategyShares: 1n,
      adapterProtocol: `0x${'1'.repeat(64)}`,
      adapterAsset: zeroAddress,
      adapterVault: zeroAddress,
    }));
    expect(blockers).toContain('Strategy must be inactive: shares, position, and adapter current value must all be zero.');
    expect(blockers).toContain('Adapter protocol does not match the pending operation.');
    expect(blockers).toContain('Adapter protocol does not match the configured protocol ID.');
    expect(blockers).toContain('Adapter asset does not match Arc USDC.');
    expect(blockers).toContain('Adapter vault does not match the Core protocol-vault mapping.');
  });

  it('executes only the known Strategy Approval operation after readiness and verifies active readback', async () => {
    const state = strategyExecutionState();
    const ports = {
      readState: vi.fn(async () => state),
      submit: vi.fn(async () => hash),
      waitForReceipt: vi.fn(async () => ({ status: 'success' as const, blockNumber: 9_001n })),
      readStrategy: vi.fn(async () => ({
        protocol: STEAKHOUSE_PROTOCOL_ID,
        asset: ARC_USDC_CONTRACT_ADDRESS,
        absoluteCap: APPROVAL_ABSOLUTE_CAP,
        relativeCapBps: APPROVAL_RELATIVE_CAP_BPS,
        approved: true,
        enabled: true,
      })),
    };
    await expect(executeScheduledStrategyApproval(ports)).resolves.toEqual({
      hash,
      blockNumber: 9_001n,
    });
    expect(ports.submit).toHaveBeenCalledOnce();
    expect(ports.submit).toHaveBeenCalledWith(STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID);
  });

  it('matches only the known pending Protocol Approval payload for direct operation-ID lookup', () => {
    const pending = approvalOperation();
    expect(STEAKHOUSE_PROTOCOL_APPROVAL_OPERATION_ID).toBe(
      '0x7f82eff90f6843cc282af03f5864702525031886ba889fce8f92cf5c91a3eca0',
    );
    expect(matchesApprovalOperationPayload('protocol', pending)).toBe(true);
    expect(matchesApprovalOperationPayload('protocol', { ...pending, value1: pending.value1 + 1n })).toBe(false);
    expect(matchesApprovalOperationPayload('protocol', approvalOperation('asset'))).toBe(false);
  });

  it('matches only the approved USDC Asset Approval payload for direct operation-ID lookup', () => {
    expect(USDC_ASSET_APPROVAL_OPERATION_ID).toBe(
      '0x20043f8d08bc22d107d81628e23c5f42a98128978a4cd5266b18bb15863a4b91',
    );
    expect(matchesApprovalOperationPayload('asset', approvalOperation('asset'))).toBe(true);
    expect(matchesApprovalOperationPayload('asset', { ...approvalOperation('asset'), bps: 1_499 })).toBe(false);
    expect(matchesApprovalOperationPayload('asset', approvalOperation())).toBe(false);
  });

  it('executes manually only after guards pass and requires verified caps after a successful receipt', async () => {
    const ports = executionPorts();
    await expect(executeScheduledApproval(
      'protocol',
      operationId,
      STEAKHOUSE_CORE_ADDRESS,
      ports,
    )).resolves.toEqual({ hash, blockNumber: 7890n });
    expect(ports.submit).toHaveBeenCalledWith('protocol', operationId);

    const badReadback = executionPorts({
      readPendingOperation: vi.fn(async () => approvalOperation('asset')),
      readAssetCaps: vi.fn(async () => ({
        absoluteCap: 1n,
        relativeCapBps: APPROVAL_RELATIVE_CAP_BPS,
        approved: true,
        enabled: true,
      })),
    });
    await expect(executeScheduledApproval(
      'asset',
      operationId,
      STEAKHOUSE_CORE_ADDRESS,
      badReadback,
    )).rejects.toThrow(/readback did not match/);
  });

  it('rejects cap readbacks that are not approved, enabled, and exact', () => {
    expect(() => verifyApprovalExecutionReadback({
      approval: 'asset',
      absoluteCap: APPROVAL_ABSOLUTE_CAP,
      relativeCapBps: APPROVAL_RELATIVE_CAP_BPS,
      approved: true,
      enabled: false,
    })).toThrow(/readback did not match/);
  });
});
