import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryResult: {} as Record<string, unknown>,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.queryResult,
  useQueryClient: () => ({ removeQueries: vi.fn() }),
}));

import { UserEarningPosition } from '../components/UserEarningPosition';
import { useTreasuryStrategyState } from './useTreasuryStrategyState';

const staleData = {
  position: { status: 'NO_ACTIVE_POSITION' as const },
  strategyStatus: {
    reason: 'VALUATION_STALE' as const,
    approved: true,
    enabled: true,
    paused: false,
    valuationStatus: 'STALE' as const,
    positionValue: 0n,
    valuationBlock: 100n,
    verifiedAtBlock: 1_301n,
  },
  unavailableReason: null,
};

function EarnPositionHarness() {
  const state = useTreasuryStrategyState(
    true,
    true,
    true,
    '0x1111111111111111111111111111111111111111',
  );
  return (
    <UserEarningPosition
      position={state.position}
      strategyStatus={state.strategyStatus}
      unavailableReason={state.unavailableReason}
      isLoading={state.isLoading}
      error={state.error}
      isAuthenticated
      authenticationLoading={false}
      onRetry={() => undefined}
    />
  );
}

function renderEarnPosition() {
  return renderToStaticMarkup(<EarnPositionHarness />);
}

describe('useTreasuryStrategyState', () => {
  it('keeps the last verified stale-valuation warning visible during background refresh', () => {
    mocks.queryResult = {
      data: staleData,
      isLoading: false,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    };

    const markup = renderEarnPosition();

    expect(markup).toContain('Temporarily paused: The strategy value needs to be refreshed');
    expect(markup).not.toContain('Updating your earning position');
  });

  it('shows loading while the first strategy-state request is pending', () => {
    mocks.queryResult = {
      data: undefined,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(),
    };

    expect(renderEarnPosition()).toContain('Updating your earning position');
  });
});
