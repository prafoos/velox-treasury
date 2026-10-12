import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WithdrawActionModal } from './WithdrawActionModal';

describe('WithdrawActionModal self-withdrawal wording', () => {
  it('uses simple user-facing withdrawal guidance without internal accounting details', () => {
    const markup = renderToStaticMarkup(
      <WithdrawActionModal
        isOpen
        onClose={() => undefined}
        canWithdraw
        isSubmitting={false}
        status={null}
        onWithdraw={async () => undefined}
        walletAddress="0x1111111111111111111111111111111111111111"
      />,
    );

    expect(markup).toContain('Withdrawals can only be sent to your connected wallet.');
    expect(markup).toContain('Available USDC is withdrawn first.');
    expect(markup).not.toMatch(/Core|authoritative|strategy share|withdrawal limits|WITHDRAWER(?:_ROLE)?/i);
  });

  it('retains operational details in the authorized Admin view', () => {
    const markup = renderToStaticMarkup(
      <WithdrawActionModal
        isOpen
        onClose={() => undefined}
        canWithdraw
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
});
