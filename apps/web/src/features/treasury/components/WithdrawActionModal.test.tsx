/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WithdrawActionModal } from './WithdrawActionModal';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('WithdrawActionModal self-withdrawal wording', () => {
  it('uses simple user-facing withdrawal guidance without internal accounting details', () => {
    const markup = renderToStaticMarkup(
      <WithdrawActionModal
        isOpen
        onClose={() => undefined}
        canWithdraw
        withdrawableAmount={400_000n}
        isSubmitting={false}
        status={null}
        onWithdraw={async () => undefined}
        walletAddress="0x1111111111111111111111111111111111111111"
      />,
    );

    expect(markup).toContain('Withdrawals can only be sent to your connected wallet.');
    expect(markup).toContain('Available USDC is withdrawn first.');
    expect(markup).toContain('Currently available to withdraw: 0.40 USDC');
    expect(markup).not.toMatch(/Core|authoritative|strategy share|withdrawal limits|WITHDRAWER(?:_ROLE)?/i);
  });

  it('retains operational details in the authorized Admin view', () => {
    const markup = renderToStaticMarkup(
      <WithdrawActionModal
        isOpen
        onClose={() => undefined}
        canWithdraw
        withdrawableAmount={400_000n}
        isSubmitting={false}
        status={null}
        onWithdraw={async () => undefined}
        walletAddress="0x1111111111111111111111111111111111111111"
        canViewAdmin
      />,
    );

    expect(markup).toContain('Self-withdrawal only');
    expect(markup).toContain('authoritative pro-rata Core strategy share position');
    expect(markup).toContain('Core rechecks your position');
  });

  it('closes only after a confirmed withdrawal, not while pending or failed', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    const onClose = vi.fn();
    try {
      const renderStatus = async (status: string, isSubmitting: boolean) => {
        await act(async () => {
          root.render(
            <WithdrawActionModal
              isOpen
              onClose={onClose}
              canWithdraw
              withdrawableAmount={400_000n}
              isSubmitting={isSubmitting}
              status={status}
              onWithdraw={async () => undefined}
              walletAddress="0x1111111111111111111111111111111111111111"
            />,
          );
        });
      };

      await renderStatus('Submitting Treasury withdrawal…', true);
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(onClose).not.toHaveBeenCalled();

      await renderStatus('Withdrawal receipt or event verification failed.', false);
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(onClose).not.toHaveBeenCalled();

      await renderStatus('Withdrawal confirmed on Arc Mainnet.', false);
      await act(async () => { vi.advanceTimersByTime(1_999); });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });
});
