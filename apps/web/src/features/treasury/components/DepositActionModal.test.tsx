/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DepositActionModal } from './DepositActionModal';
import { parseUSDC } from '../../usdc/services/usdcService';
import { STEAKHOUSE_CORE_ADDRESS } from '../services/protocolVaultMapping';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('DepositActionModal amount input', () => {
  it('keeps the amount editable and parses 1 USDC without changing the read-only asset field', () => {
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
        walletUSDC={null}
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
        walletUSDC={null}
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
        walletUSDC={null}
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
        walletUSDC={null}
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
        walletUSDC={null}
        canDeposit
        isSubmitting={false}
        status={message}
        onDeposit={async () => undefined}
      />,
    );

    expect(markup).toContain(message);
  });

  it('shows the connected wallet USDC balance', () => {
    const markup = renderToStaticMarkup(
      <DepositActionModal
        isOpen
        onClose={() => undefined}
        treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
        walletUSDC="125.50"
        canDeposit
        isSubmitting={false}
        status={null}
        onDeposit={async () => undefined}
      />,
    );

    expect(markup).toContain('Connected wallet USDC balance: 125.50 USDC');
  });

  it('closes only after a confirmed deposit, not while pending or failed', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    const onClose = vi.fn();
    try {
      const renderStatus = async (status: string) => {
        await act(async () => {
          root.render(
            <DepositActionModal
              isOpen
              onClose={onClose}
              treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
              walletUSDC="125.50"
              canDeposit
              isSubmitting={status.startsWith('Submitting')}
              status={status}
              onDeposit={async () => undefined}
            />,
          );
        });
      };

      await renderStatus('Submitting Treasury deposit…');
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(onClose).not.toHaveBeenCalled();

      await renderStatus('Deposit transaction reverted on Arc Mainnet.');
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(onClose).not.toHaveBeenCalled();

      await renderStatus('Deposit confirmed. No surplus is currently eligible.');
      await act(async () => { vi.advanceTimersByTime(1_999); });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  it('clears the success-close timer when the modal unmounts', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    const onClose = vi.fn();
    try {
      await act(async () => {
        root.render(
          <DepositActionModal
            isOpen
            onClose={onClose}
            treasuryAddress={STEAKHOUSE_CORE_ADDRESS}
            walletUSDC={null}
            canDeposit
            isSubmitting={false}
            status="Deposit confirmed. No surplus is currently eligible."
            onDeposit={async () => undefined}
          />,
        );
      });
      await act(async () => root.unmount());
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
