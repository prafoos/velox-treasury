// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TreasuryAllocationSection } from './TreasuryAllocationSection';
import type { TreasuryAllocationPolicy } from '../hooks/useTreasuryAllocationPolicy';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const policy: TreasuryAllocationPolicy = {
  operationalReserveBps: 1_234n,
  yieldStrategyBps: 2_050n,
  liquidityAvailabilityBps: 4_999n,
  automationAndAiBps: 1_717n,
};

describe('TreasuryAllocationSection', () => {
  it('shows live percentages with correct conversion and the required clarification', () => {
    const markup = render(
      <TreasuryAllocationSection policy={policy} isLoading={false} error={null} onRetry={() => undefined} />,
    );

    expect(markup).toContain('Treasury Allocation');
    expect(markup).toContain('View the allocation percentages set by your Treasury administrator.');
    expect(markup).toContain('Operational Reserve');
    expect(markup).toContain('12.34%');
    expect(markup).toContain('Yield Strategy');
    expect(markup).toContain('20.5%');
    expect(markup).toContain('Liquidity Availability');
    expect(markup).toContain('49.99%');
    expect(markup).toContain('Automation &amp; AI');
    expect(markup).toContain('17.17%');
    expect(markup).toContain('These percentages are set by your Treasury administrator and may change when the settings are updated. They do not represent the actual amount of money currently held in each category.');
    expect(markup).not.toContain('Bucket Policy');
    expect(markup).not.toContain('bps');
    expect(markup).not.toContain('Treasury-wide');
    expect(markup).not.toContain('Admin');
  });

  it('reflects changed policy values instead of retaining a prior split', () => {
    const changedPolicy = {
      operationalReserveBps: 6_000n,
      yieldStrategyBps: 2_000n,
      liquidityAvailabilityBps: 1_000n,
      automationAndAiBps: 1_000n,
    };
    const markup = render(
      <TreasuryAllocationSection policy={changedPolicy} isLoading={false} error={null} onRetry={() => undefined} />,
    );

    expect(markup).toContain('60%');
    expect(markup).toContain('20%');
    expect(markup).toContain('10%');
    expect(markup).not.toContain('12.34%');
  });

  it('shows loading, unavailable, and read-error states without substituting percentages', async () => {
    expect(render(
      <TreasuryAllocationSection policy={null} isLoading error={null} onRetry={() => undefined} />,
    )).toContain('Loading allocation information');

    expect(render(
      <TreasuryAllocationSection policy={null} isLoading={false} error={null} onRetry={() => undefined} />,
    )).toContain('Allocation information is currently unavailable.');

    const retry = vi.fn();
    const { container, root } = mount(
      <TreasuryAllocationSection
        policy={null}
        isLoading={false}
        error={new Error('RPC read failed.')}
        onRetry={retry}
      />,
    );
    expect(container.textContent).toContain('Allocation information could not be loaded.');
    expect(container.textContent).toContain('RPC read failed.');
    expect(container.textContent).not.toMatch(/\b(?:50|30|10)%/);

    await act(async () => {
      container.querySelector('button')?.click();
    });
    expect(retry).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});

function render(element: ReactElement): string {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(element));
  const markup = container.innerHTML;
  act(() => root.unmount());
  return markup;
}

function mount(element: ReactElement) {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});
