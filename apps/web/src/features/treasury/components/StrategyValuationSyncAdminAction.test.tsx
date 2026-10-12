import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isConnected: true,
  isArcMainnet: true,
  address: '0x1111111111111111111111111111111111111111',
  state: {
    chainId: 5042,
    blockNumber: 5000n,
    coreHasCode: true,
    adapterHasCode: true,
    policyAdmin: true,
    paused: false,
    approved: true,
    valuationBlock: 1n,
    valuationStatus: 1,
    valuationSource: '0x915E6ff43b4a0A8681bB7F646047873771D5798c',
    principal: 0n,
    shares: 0n,
    currentValue: 0n,
    feesAccrued: 0n,
    adapterShares: 0n,
    adapterCurrentValue: 0n,
    adapterFeesAccrued: 0n,
    freshnessBlocks: 1200n,
    identitiesMatch: true,
  },
}));

vi.mock('wagmi', () => ({
  usePublicClient: () => ({}),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.state, isFetching: false, error: null, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../../hooks/useWalletStatus', () => ({
  useWalletStatus: () => ({
    address: mocks.address,
    isConnected: mocks.isConnected,
    isArcMainnet: mocks.isArcMainnet,
  }),
}));

import {
  StrategyValuationSyncAdminAction,
  validateExecutionResponse,
} from './StrategyValuationSyncAdminAction';

describe('StrategyValuationSyncAdminAction', () => {
  it('renders the stale valuation review only for an Admin', () => {
    const adminMarkup = renderToStaticMarkup(<StrategyValuationSyncAdminAction isAdmin />);
    expect(adminMarkup).toContain('Review Valuation Sync');
    expect(adminMarkup).toContain('no position');
    expect(adminMarkup).toContain('does not allocate, deallocate, deposit, or withdraw funds');

    const userMarkup = renderToStaticMarkup(<StrategyValuationSyncAdminAction isAdmin={false} />);
    expect(userMarkup).toBe('');
  });

  it('requires an authenticated Policy Admin wallet on Arc Mainnet', () => {
    mocks.isConnected = false;
    const markup = renderToStaticMarkup(<StrategyValuationSyncAdminAction isAdmin />);
    expect(markup).toContain('Connect an authenticated Policy Admin wallet on Arc Mainnet');
    expect(markup).not.toContain('Review Valuation Sync');
    mocks.isConnected = true;
  });

  it('accepts only a confirmed sync receipt with current valuation metadata', () => {
    expect(validateExecutionResponse({
      status: 'confirmed',
      operation: 'sync-valuation',
      transactionHash: `0x${'a'.repeat(64)}`,
      blockNumber: '1001',
      coreAddress: '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7',
      strategyAddress: mocks.state.valuationSource,
      readback: {
        valuationBlock: '1001',
        valuationStatus: 1,
        valuationSource: mocks.state.valuationSource,
        principal: '0',
        position: '0',
        shares: '0',
        feesAccrued: '0',
      },
    }).blockNumber).toBe(1001n);

    expect(() => validateExecutionResponse({
      status: 'confirmed',
      operation: 'allocate',
      transactionHash: `0x${'a'.repeat(64)}`,
      blockNumber: '1001',
      readback: { valuationBlock: '1001', valuationStatus: 1, valuationSource: mocks.state.valuationSource },
    })).toThrow('confirmed, current valuation readback');
  });
});
