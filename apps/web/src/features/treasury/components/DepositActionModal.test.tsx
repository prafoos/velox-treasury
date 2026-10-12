import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DepositActionModal } from './DepositActionModal';
import { parseUSDC } from '../../usdc/services/usdcService';
import { STEAKHOUSE_CORE_ADDRESS } from '../services/protocolVaultMapping';

describe('DepositActionModal amount input', () => {
  it('keeps the amount editable and parses 1 USDC without changing the read-only asset field', () => {
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
        canDeposit
        isSubmitting={false}
        status={null}
        onDeposit={async () => undefined}
      />,
    );

    const amountInput = markup.match(/<input id="deposit-amount"[^>]*>/)?.[0];
    const assetInput = markup.match(/<input id="deposit-asset"[^>]*>/)?.[0];

    expect(amountInput).toBeDefined();
    expect(amountInput).not.toMatch(/\bdisabled\b|\breadonly\b/);
    expect(amountInput).toContain('inputMode="decimal"');
    expect(parseUSDC('1')).toBe(1_000_000n);

    expect(assetInput).toContain('disabled=""');
    expect(assetInput).toContain('readOnly=""');
    expect(markup).toContain(`value="${STEAKHOUSE_CORE_ADDRESS}"`);
    expect(markup).not.toContain('Verified Asset');
    expect(markup).toContain('Bucket percentages are accounting targets');
    expect(markup).toContain('After confirmation, the existing automation checks valuation, reserves, and on-chain policy caps');
  });

  it('shows whether the confirmed deposit triggered eligible strategy deployment', () => {
    const status = 'Deposit confirmed. Eligible surplus was deployed to the verified Steakhouse strategy.';
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
        canDeposit
        isSubmitting={false}
        status={status}
        onDeposit={async () => undefined}
      />,
    );

    expect(markup).toContain(status);
  });

  it('fails closed and does not expose or enable an unapproved Core destination', () => {
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress="0x1111111111111111111111111111111111111111"
        canDeposit
        isSubmitting={false}
        status={null}
        onDeposit={async () => undefined}
      />,
    );

    const destinationInput = markup.match(/<input id="deposit-destination"[^>]*>/)?.[0];
    const amountInput = markup.match(/<input id="deposit-amount"[^>]*>/)?.[0];
    const depositButton = markup.match(/<button type="button" class="vx-btn vx-btn-primary"[^>]*>/)?.[0];
    expect(destinationInput).toContain('Not available — verified Core required');
    expect(destinationInput).not.toContain('0x1111111111111111111111111111111111111111');
    expect(amountInput).toContain('disabled=""');
    expect(depositButton).toContain('disabled=""');
  });

  it('shows allowance recovery instructions to regular users without sending cleanup transactions', () => {
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
        canDeposit
        isSubmitting={false}
        status="A remaining allowance of 1.25 USDC is approved. Manually confirm USDC approve(Core, 0) in your wallet."
        onDeposit={async () => undefined}
      />,
    );

    expect(markup).toContain('A remaining allowance of 1.25 USDC is approved');
    expect(markup).toContain('Manually confirm USDC approve(Core, 0)');
  });

  it('shows wallet identity changes clearly to regular users', () => {
    const message = 'The connected wallet account changed. No further transaction was submitted.';
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
        canDeposit
        isSubmitting={false}
        status={message}
        onDeposit={async () => undefined}
      />,
    );

    expect(markup).toContain(message);
  });
});
