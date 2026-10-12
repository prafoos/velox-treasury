import { describe, expect, it, vi } from 'vitest';
import { zeroAddress } from 'viem';

import { ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import {
  APPROVAL_ABSOLUTE_CAP,
  APPROVAL_RELATIVE_CAP_BPS,
  APPROVAL_SCHEDULE_TARGETS,
  scheduleArcUsdcAssetApproval,
  scheduleSteakhouseProtocolApproval,
  type ApprovalPendingOperation,
  type ApprovalSchedulingPorts,
} from './approvalScheduling';
import {
  STEAKHOUSE_POLICY_ADMIN_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from './protocolVaultMapping';

const operationId = `0x${'1'.repeat(64)}` as `0x${string}`;

function ports(
  approval: 'protocol' | 'asset',
  overrides: Partial<ApprovalSchedulingPorts> = {},
): ApprovalSchedulingPorts {
  const pendingOperation: ApprovalPendingOperation = {
    kind: approval === 'protocol' ? 1 : 2,
    eta: 1234n,
    subject: approval === 'protocol' ? zeroAddress : ARC_USDC_CONTRACT_ADDRESS,
    secondary: approval === 'protocol' ? STEAKHOUSE_PROTOCOL_ID : `0x${'0'.repeat(64)}`,
    value1: APPROVAL_ABSOLUTE_CAP,
    value2: 0n,
    bps: APPROVAL_RELATIVE_CAP_BPS,
    bps2: 0,
    bps3: 0,
    bps4: 0,
  };

  return {
    chainId: 5042,
    accountAddress: STEAKHOUSE_POLICY_ADMIN_ADDRESS,
    readPolicyAdminRole: vi.fn(async (_account) => true),
    readProtocolVault: vi.fn(async () => STEAKHOUSE_VAULT_ADDRESS),
    readCoreUSDC: vi.fn(async () => ARC_USDC_CONTRACT_ADDRESS),
    readPaused: vi.fn(async () => false),
    submitProtocol: vi.fn(async () => `0x${'2'.repeat(64)}` as `0x${string}`),
    submitAsset: vi.fn(async () => `0x${'2'.repeat(64)}` as `0x${string}`),
    waitForReceipt: vi.fn(async () => ({
      status: 'success' as const,
      blockNumber: 5678n,
      operationId,
      scheduledEta: 1234n,
    })),
    readPendingOperation: vi.fn(async () => pendingOperation),
    ...overrides,
  };
}

describe('approval scheduling', () => {
  it('schedules only the exact protocol approval after successful preflight and verifies readback', async () => {
    const configuredPorts = ports('protocol');

    await expect(scheduleSteakhouseProtocolApproval(configuredPorts)).resolves.toEqual({
      hash: `0x${'2'.repeat(64)}`,
      blockNumber: 5678n,
      operationId,
      eta: 1234n,
    });

    expect(configuredPorts.submitProtocol).toHaveBeenCalledOnce();
    expect(configuredPorts.submitProtocol).toHaveBeenCalledWith(
      STEAKHOUSE_PROTOCOL_ID,
      750_000_000_000n,
      1_500,
    );
    expect(configuredPorts.submitAsset).not.toHaveBeenCalled();
    expect(configuredPorts.readPolicyAdminRole).toHaveBeenCalledWith(STEAKHOUSE_POLICY_ADMIN_ADDRESS);
    expect(configuredPorts.readPendingOperation).toHaveBeenCalledWith(operationId);
    expect(APPROVAL_SCHEDULE_TARGETS.protocol).toBe(STEAKHOUSE_PROTOCOL_ID);
    expect(APPROVAL_SCHEDULE_TARGETS.core).toBe('0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7');
  });

  it('schedules only the exact USDC asset approval after successful preflight and verifies readback', async () => {
    const configuredPorts = ports('asset');

    await expect(scheduleArcUsdcAssetApproval(configuredPorts)).resolves.toMatchObject({
      hash: `0x${'2'.repeat(64)}`,
      blockNumber: 5678n,
      operationId,
      eta: 1234n,
    });

    expect(configuredPorts.submitAsset).toHaveBeenCalledOnce();
    expect(configuredPorts.submitAsset).toHaveBeenCalledWith(
      ARC_USDC_CONTRACT_ADDRESS,
      750_000_000_000n,
      1_500,
    );
    expect(configuredPorts.submitProtocol).not.toHaveBeenCalled();
    expect(APPROVAL_SCHEDULE_TARGETS.asset).toBe(ARC_USDC_CONTRACT_ADDRESS);
  });

  it.each([
    ['wrong chain', { chainId: 1 }, /chain ID 5042/],
    ['missing live role', { readPolicyAdminRole: vi.fn(async () => false) }, /does not have POLICY_ADMIN_ROLE/],
    ['wrong protocol vault', { readProtocolVault: vi.fn(async () => '0x0000000000000000000000000000000000000001' as const) }, /not mapped/],
    ['wrong Core USDC', { readCoreUSDC: vi.fn(async () => '0x0000000000000000000000000000000000000001' as const) }, /USDC does not match/],
    ['paused Core', { readPaused: vi.fn(async () => true) }, /Core is paused/],
  ])('does not submit when preflight fails: %s', async (_label, overrides, error) => {
    const configuredPorts = ports('protocol', overrides);

    await expect(scheduleSteakhouseProtocolApproval(configuredPorts)).rejects.toThrow(error);
    expect(configuredPorts.submitProtocol).not.toHaveBeenCalled();
    expect(configuredPorts.submitAsset).not.toHaveBeenCalled();
  });

  it('rejects reverted receipts and mismatched pending-operation readbacks', async () => {
    const reverted = ports('asset', {
      waitForReceipt: vi.fn(async () => ({
        status: 'reverted' as const,
        blockNumber: 1n,
        operationId,
        scheduledEta: 1234n,
      })),
    });
    await expect(scheduleArcUsdcAssetApproval(reverted)).rejects.toThrow(/failed or was reverted/);

    const mismatch = ports('protocol', {
      readPendingOperation: vi.fn(async () => ({
        kind: 1,
        eta: 1234n,
        subject: zeroAddress,
        secondary: STEAKHOUSE_PROTOCOL_ID,
        value1: 1n,
        value2: 0n,
        bps: APPROVAL_RELATIVE_CAP_BPS,
        bps2: 0,
        bps3: 0,
        bps4: 0,
      })),
    });
    await expect(scheduleSteakhouseProtocolApproval(mismatch)).rejects.toThrow(/readback does not match/);
  });
});
