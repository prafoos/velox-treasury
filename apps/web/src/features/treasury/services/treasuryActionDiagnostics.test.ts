import { describe, expect, it, vi } from 'vitest';
import {
  isSafeTreasuryActionDiagnostic,
  receiptWaitError,
  walletSubmissionError,
  withTreasuryReadStage,
} from './treasuryActionDiagnostics';

describe('Treasury action diagnostics', () => {
  it('reports a sanitized relay/chain failure stage without leaking the underlying error', async () => {
    const read = vi.fn(async () => {
      throw new Error('provider response contained sensitive request details');
    });
    let message = '';
    try {
      await withTreasuryReadStage('Deposit', 'preflight', {
        getChainId: async () => 5042,
      }, read);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('Deposit preflight failed');
    expect(message).toContain('No wallet transaction was submitted.');
    expect(message).not.toContain('sensitive request details');
    expect(read).toHaveBeenCalledOnce();
    expect(isSafeTreasuryActionDiagnostic(message)).toBe(true);
  });

  it('does not issue reads when the relay chain ID is not Arc Mainnet', async () => {
    const read = vi.fn(async () => 1n);
    await expect(withTreasuryReadStage('Withdrawal', 'preflight', {
      getChainId: async () => 1,
    }, read)).rejects.toThrow('Withdrawal preflight failed');
    expect(read).not.toHaveBeenCalled();
  });

  it('distinguishes wallet rejection, pre-wallet simulation revert, and uncertain receipt checks by hash', () => {
    const rejection = new Error('User rejected request');
    rejection.name = 'UserRejectedRequestError';
    expect(walletSubmissionError('Deposit', 'USDC approval', rejection).message).toContain('rejected by the wallet');
    const revert = new Error('execution reverted with private data');
    revert.name = 'ContractFunctionRevertedError';
    expect(walletSubmissionError('Withdrawal', 'transaction', revert).message)
      .toContain('simulation reverted before wallet submission');
    const hash = `0x${'a'.repeat(64)}` as const;
    expect(receiptWaitError('Withdrawal', 'receipt', hash).message)
      .toContain(`Transaction hash: ${hash}. Check this transaction's status before retrying.`);
    expect(walletSubmissionError('Withdrawal', 'transaction', revert).message).not.toContain('private data');
  });
});
