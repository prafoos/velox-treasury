import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UserEarningPosition } from './UserEarningPosition';
import type { UserStrategyStatus } from '../hooks/useTreasuryStrategyState';

const staleApprovedStrategy: UserStrategyStatus = {
  reason: 'VALUATION_STALE',
  approved: true,
  enabled: true,
  paused: false,
  valuationStatus: 'STALE',
  positionValue: 0n,
  valuationBlock: 25_416_075n,
  verifiedAtBlock: 25_561_179n,
};

function renderPosition(overrides: Partial<React.ComponentProps<typeof UserEarningPosition>> = {}) {
  return renderToStaticMarkup(
    <UserEarningPosition
      position={null}
      isLoading={false}
      error={null}
      isAuthenticated
      authenticationLoading={false}
      onRetry={() => undefined}
      {...overrides}
    />,
  );
}

describe('UserEarningPosition', () => {
  it('states that the authenticated wallet has no active position when the Core confirms zero', () => {
    const markup = renderPosition({
      position: { status: 'NO_ACTIVE_POSITION' },
      strategyStatus: staleApprovedStrategy,
    });
    expect(markup).toContain('No active earning position.');
    expect(markup).toContain('Your verified Steakhouse position value');
    expect(markup).toContain('0.00 USDC');
  });

  it('explains the stale valuation pause without exposing technical diagnostics or system totals', () => {
    const markup = renderPosition({
      position: { status: 'NO_ACTIVE_POSITION' },
      strategyStatus: staleApprovedStrategy,
    });
    expect(markup).toContain('Temporarily paused: The strategy value needs to be refreshed');
    expect(markup).not.toContain('Recent allocation activity is not available in this view');
    expect(markup).not.toContain('STALE');
    expect(markup).not.toContain('25416075');
    expect(markup).not.toContain('25561179');
    expect(markup).not.toContain('Strategy approved / enabled');
    expect(markup).not.toMatch(/total deployed|totalManagedAssets|Core-wide/i);
  });

  it('does not claim the strategy is ready when a valuation is current but no position exists', () => {
    const markup = renderPosition({
      position: { status: 'NO_ACTIVE_POSITION' },
      strategyStatus: {
        ...staleApprovedStrategy,
        reason: 'APPROVED_ENABLED_NO_POSITION',
        valuationStatus: 'CURRENT',
        valuationBlock: 25_565_000n,
        verifiedAtBlock: 25_565_100n,
      },
    });
    expect(markup).toContain('A current strategy value is available.');
    expect(markup).toContain('No active earning position.');
    expect(markup).not.toMatch(/>Ready</);
    expect(markup).not.toContain('valuation is stale');
  });

  it('shows only the authenticated user-specific position value', () => {
    const markup = renderPosition({
      position: { status: 'POSITION_AVAILABLE', currentValue: 1_250_000n },
      strategyStatus: {
        ...staleApprovedStrategy,
        reason: 'POSITION_AVAILABLE',
        valuationStatus: 'CURRENT',
      },
    });
    expect(markup).toContain('Your Steakhouse position');
    expect(markup).toContain('1.25 USDC');
    expect(markup).toContain('Your earning position is verified.');
    expect(markup).not.toContain('Recent allocation activity is not available in this view');
    expect(markup).not.toMatch(/shares|total deployed|approved|strategy exposure/i);
  });

  it('does not translate unavailable data into an empty position', () => {
    const markup = renderPosition({ unavailableReason: 'User strategy getter is unsupported.' });
    expect(markup).toContain('Your earning position and allocation eligibility could not be verified');
    expect(markup).not.toContain('unsupported');
    expect(markup).not.toContain('No active earning position');
    expect(markup).not.toContain('0.00 USDC');
  });

  it('preserves the sign-in requirement', () => {
    const markup = renderPosition({ isAuthenticated: false });
    expect(markup).toContain('Sign in to view your Steakhouse position.');
  });

  it('shows recoverable read errors and provides retry', () => {
    const markup = renderPosition({ error: new Error('RPC request failed.') });
    expect(markup).toContain('Your earning position could not be updated.');
    expect(markup).not.toContain('RPC request failed.');
    expect(markup).toContain('Retry');
  });

  it('shows sign-in checks separately from position availability', () => {
    expect(renderPosition({ authenticationLoading: true })).toContain('Checking wallet sign-in');
    expect(renderPosition({ authenticationError: new Error('Session lookup failed.') }))
      .toContain('Wallet sign-in could not be verified.');
    expect(renderPosition({ isLoading: true })).toContain('Updating your earning position');
  });
});
