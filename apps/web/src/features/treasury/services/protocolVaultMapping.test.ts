import { describe, expect, it, vi } from 'vitest';

import {
  configureSteakhouseProtocolVault,
  STEAKHOUSE_POLICY_ADMIN_ADDRESS,
  STEAKHOUSE_VAULT_ADDRESS,
} from './protocolVaultMapping';

function ports(overrides: Partial<Parameters<typeof configureSteakhouseProtocolVault>[0]> = {}) {
  return {
    chainId: 5042,
    accountAddress: STEAKHOUSE_POLICY_ADMIN_ADDRESS,
    readPolicyAdminRole: vi.fn(async () => true),
    readProtocolVault: vi.fn(async () => '0x0000000000000000000000000000000000000000' as const),
    submit: vi.fn(async () => `0x${'1'.repeat(64)}` as `0x${string}`),
    waitForReceipt: vi.fn(async () => ({ status: 'success' as const, blockNumber: 123n })),
    ...overrides,
  };
}

describe('configureSteakhouseProtocolVault', () => {
  it('submits only for the expected connected Policy Admin and verifies confirmed mapping', async () => {
    const readProtocolVault = vi.fn()
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
      .mockResolvedValueOnce(STEAKHOUSE_VAULT_ADDRESS);
    const configuredPorts = ports({ readProtocolVault });

    await expect(configureSteakhouseProtocolVault(configuredPorts)).resolves.toEqual({
      hash: `0x${'1'.repeat(64)}`,
      blockNumber: 123n,
    });
    expect(configuredPorts.readPolicyAdminRole).toHaveBeenCalledOnce();
    expect(configuredPorts.submit).toHaveBeenCalledOnce();
    expect(configuredPorts.waitForReceipt).toHaveBeenCalledOnce();
    expect(readProtocolVault).toHaveBeenCalledTimes(2);
  });

  it('does not submit when the connected account is not the expected Policy Admin', async () => {
    const configuredPorts = ports({ accountAddress: '0x0000000000000000000000000000000000000001' });

    await expect(configureSteakhouseProtocolVault(configuredPorts)).rejects.toThrow(/POLICY_ADMIN_ROLE wallet/);
    expect(configuredPorts.submit).not.toHaveBeenCalled();
  });

  it('does not submit without the live Policy Admin role or when mapping is already set', async () => {
    const missingRole = ports({ readPolicyAdminRole: vi.fn(async () => false) });
    await expect(configureSteakhouseProtocolVault(missingRole)).rejects.toThrow(/does not have POLICY_ADMIN_ROLE/);
    expect(missingRole.submit).not.toHaveBeenCalled();

    const existingMapping = ports({
      readProtocolVault: vi.fn(async () => STEAKHOUSE_VAULT_ADDRESS),
    });
    await expect(configureSteakhouseProtocolVault(existingMapping)).rejects.toThrow(/already configured/);
    expect(existingMapping.submit).not.toHaveBeenCalled();
  });

  it('rejects the wrong network, reverted receipt, and incorrect readback', async () => {
    const wrongNetwork = ports({ chainId: 1 });
    await expect(configureSteakhouseProtocolVault(wrongNetwork)).rejects.toThrow(/chain ID 5042/);
    expect(wrongNetwork.submit).not.toHaveBeenCalled();

    const reverted = ports({
      waitForReceipt: vi.fn(async () => ({ status: 'reverted' as const, blockNumber: 123n })),
    });
    await expect(configureSteakhouseProtocolVault(reverted)).rejects.toThrow(/failed or was reverted/);

    const badReadback = ports({
      readProtocolVault: vi.fn()
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000001'),
    });
    await expect(configureSteakhouseProtocolVault(badReadback)).rejects.toThrow(/readback does not match/);
  });
});
