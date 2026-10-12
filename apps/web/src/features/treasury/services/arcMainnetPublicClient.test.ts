import { describe, expect, it, vi } from 'vitest';

import { withVerifiedArcMainnetPublicClient } from './arcMainnetPublicClient';

describe('withVerifiedArcMainnetPublicClient', () => {
  it('trusts an authoritative read only after the actual RPC reports chain 5042', async () => {
    const read = vi.fn(async () => 0n);
    await expect(withVerifiedArcMainnetPublicClient({ getChainId: async () => 5042 }, read)).resolves.toBe(0n);
    expect(read).toHaveBeenCalledOnce();
  });

  it('fails closed on another actual chain without trusting the returned Core value', async () => {
    const read = vi.fn(async () => 99n);
    await expect(withVerifiedArcMainnetPublicClient({ getChainId: async () => 1 }, read))
      .rejects.toThrow('Arc Mainnet (Chain ID 5042)');
    expect(read).not.toHaveBeenCalled();
  });

  it('fails closed when chain information is missing, malformed, or cannot be queried', async () => {
    const read = vi.fn(async () => 99n);
    await expect(withVerifiedArcMainnetPublicClient(undefined, read)).rejects.toThrow('chain ID is unavailable');
    await expect(withVerifiedArcMainnetPublicClient({}, read)).rejects.toThrow('chain ID is unavailable');
    await expect(withVerifiedArcMainnetPublicClient({ getChainId: async () => '5042' }, read))
      .rejects.toThrow('Arc Mainnet (Chain ID 5042)');
    await expect(withVerifiedArcMainnetPublicClient({ getChainId: async () => { throw new Error('RPC offline'); } }, read))
      .rejects.toThrow('could not be verified');
    expect(read).not.toHaveBeenCalled();
  });
});
