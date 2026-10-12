import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  clearTreasuryUserProjectionScope,
  treasuryUserProjectionQueryKey,
} from './useTreasuryUserProjection';
import { walletApiSessionQueryKey } from '../../../hooks/useWalletApiAuth';

describe('Treasury user projection cache scope', () => {
  it('normalizes wallet identity and separates wallets and Core contexts', () => {
    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';
    const coreA = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';
    const coreB = '0x4D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';

    expect(treasuryUserProjectionQueryKey(walletA.toUpperCase().replace('0X', '0x'), coreA))
      .toEqual(treasuryUserProjectionQueryKey(walletA, coreA));
    expect(treasuryUserProjectionQueryKey(walletA, coreA))
      .not.toEqual(treasuryUserProjectionQueryKey(walletB, coreA));
    expect(treasuryUserProjectionQueryKey(walletA, coreA))
      .not.toEqual(treasuryUserProjectionQueryKey(walletA, coreB));
    expect(treasuryUserProjectionQueryKey(walletA, coreA)).toEqual([
      'treasury-user-projection',
      5042,
      coreA.toLowerCase(),
      walletA,
    ]);
  });

  it('removes the previous wallet projection and session when the active account changes', () => {
    const queryClient = new QueryClient();
    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';
    const core = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';
    queryClient.setQueryData(treasuryUserProjectionQueryKey(walletA, core), { principal: 1_000_000n });
    queryClient.setQueryData(walletApiSessionQueryKey(walletA), { authenticatedWalletAddress: walletA });
    queryClient.setQueryData(treasuryUserProjectionQueryKey(walletB, core), { principal: 0n });

    clearTreasuryUserProjectionScope(queryClient, { address: walletA, coreAddress: core.toLowerCase() });

    expect(queryClient.getQueryData(treasuryUserProjectionQueryKey(walletA, core))).toBeUndefined();
    expect(queryClient.getQueryData(walletApiSessionQueryKey(walletA))).toBeUndefined();
    expect(queryClient.getQueryData(treasuryUserProjectionQueryKey(walletB, core))).toEqual({ principal: 0n });
    queryClient.clear();
  });
});
