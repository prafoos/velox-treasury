import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
  getArcMainnetTreasuryAddress,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { isWalletApiAddressMatch, walletApiSessionQueryKey } from '../../../hooks/useWalletApiAuth';

export type UserStrategyPosition =
  | { readonly status: 'NO_ACTIVE_POSITION' }
  | { readonly status: 'POSITION_AVAILABLE'; readonly currentValue: bigint };

export interface UserStrategyStatus {
  readonly reason:
    | 'POSITION_AVAILABLE'
    | 'CORE_PAUSED'
    | 'STRATEGY_NOT_APPROVED'
    | 'STRATEGY_DISABLED'
    | 'VALUATION_UNAVAILABLE'
    | 'VALUATION_STALE'
    | 'VALUATION_IMPAIRED'
    | 'APPROVED_ENABLED_NO_POSITION'
    | 'UNKNOWN';
  readonly approved: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly valuationStatus: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'IMPAIRED' | 'UNKNOWN';
  readonly positionValue: bigint;
  readonly valuationBlock: bigint;
  readonly verifiedAtBlock: bigint;
}

export interface TreasuryStrategyState {
  readonly strategyAddress: string;
  readonly strategyLabel: string;
  readonly protocolLabel: string;
  readonly protocol: string;
  readonly asset: string;
  readonly absoluteCap: bigint;
  readonly relativeCapBps: number;
  readonly principal: bigint;
  readonly shares: bigint;
  readonly currentValue: bigint;
  readonly realizedYield: bigint;
  readonly realizedLoss: bigint;
  readonly unrealizedYield: bigint;
  readonly unrealizedLoss: bigint;
  readonly feesAccrued: bigint;
  readonly withdrawalShortfall: bigint;
  readonly valuationStatus: number;
  readonly valuationStatusLabel: 'unavailable' | 'current' | 'stale' | 'impaired' | 'unknown';
  readonly valuationBlock: bigint;
  readonly valuationSource: string;
  readonly totalDeployed: bigint;
  readonly approved: boolean;
  readonly enabled: boolean;
}

export function treasuryStrategyStateQueryKey(connectedAddress: string | undefined) {
  return [
    'treasury-strategy-state',
    ARC_MAINNET_CHAIN_ID,
    getArcMainnetTreasuryAddress()?.toLowerCase() ?? null,
    ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS?.toLowerCase() ?? null,
    connectedAddress?.toLowerCase() ?? null,
  ] as const;
}

export function useTreasuryStrategyState(
  isConnected: boolean,
  isArcMainnet: boolean,
  isAuthenticated: boolean,
  connectedAddress: string | undefined,
) {
  const queryClient = useQueryClient();
  const enabled = Boolean(isConnected && isArcMainnet && isAuthenticated && connectedAddress);
  const previousScope = useRef<ReturnType<typeof treasuryStrategyStateQueryKey> | null>(null);
  useEffect(() => {
    const nextScope = enabled && connectedAddress ? treasuryStrategyStateQueryKey(connectedAddress) : null;
    const previous = previousScope.current;
    if (previous && JSON.stringify(previous) !== JSON.stringify(nextScope)) {
      queryClient.removeQueries({
        queryKey: previous,
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: walletApiSessionQueryKey(String(previous[4] ?? '')),
        exact: true,
      });
    }
    previousScope.current = nextScope;
  }, [connectedAddress, enabled, queryClient]);
  const query = useQuery({
    queryKey: treasuryStrategyStateQueryKey(connectedAddress),
    enabled,
    staleTime: 10_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<{
      readonly position: UserStrategyPosition | null;
      readonly strategyStatus: UserStrategyStatus | null;
      readonly unavailableReason: string | null;
    }> => {
      if (!ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS) {
        return { position: null, strategyStatus: null, unavailableReason: 'The Steakhouse Adapter is not configured.' };
      }
      if (!connectedAddress) throw new Error('Connect and sign in with a wallet to view your Steakhouse position.');
      const response = await fetch(`/api/strategy-state?strategy=${encodeURIComponent(ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS)}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (response.status === 401) {
        await queryClient.invalidateQueries({ queryKey: walletApiSessionQueryKey(connectedAddress) });
        throw new Error('Wallet sign-in expired. Sign in again to view your Steakhouse position.');
      }
      if (!response.ok || !payload) {
        throw new Error(typeof payload?.error === 'string'
          ? payload.error
          : 'Your Steakhouse position could not be read. Please try again.');
      }
      if (payload.scope !== 'USER'
        || payload.chainId !== 5042
        || !isWalletApiAddressMatch(payload.authenticatedWalletAddress, connectedAddress)) {
        throw new Error('The server returned a position that does not match the authenticated wallet.');
      }
      if (payload.availability === 'unavailable') {
        return {
          position: null,
          strategyStatus: null,
          unavailableReason: typeof payload.reason === 'string'
            ? payload.reason
            : 'User-specific Steakhouse position data cannot currently be retrieved.',
        };
      }

      if (payload.availability !== 'AVAILABLE' || !payload.position || typeof payload.position !== 'object') {
        throw new Error('The server returned an invalid Steakhouse position.');
      }
      const rawStatus = payload.strategyStatus as Record<string, unknown> | undefined;
      if (!rawStatus
        || typeof rawStatus.reason !== 'string'
        || !['POSITION_AVAILABLE', 'CORE_PAUSED', 'STRATEGY_NOT_APPROVED', 'STRATEGY_DISABLED', 'VALUATION_UNAVAILABLE', 'VALUATION_STALE', 'VALUATION_IMPAIRED', 'APPROVED_ENABLED_NO_POSITION', 'UNKNOWN'].includes(rawStatus.reason)
        || typeof rawStatus.approved !== 'boolean'
        || typeof rawStatus.enabled !== 'boolean'
        || typeof rawStatus.paused !== 'boolean'
        || typeof rawStatus.valuationStatus !== 'string'
        || !['CURRENT', 'STALE', 'UNAVAILABLE', 'IMPAIRED', 'UNKNOWN'].includes(rawStatus.valuationStatus)
        || typeof rawStatus.positionValue !== 'string'
        || !/^\d+$/.test(rawStatus.positionValue)
        || typeof rawStatus.valuationBlock !== 'string'
        || !/^\d+$/.test(rawStatus.valuationBlock)
        || typeof rawStatus.verifiedAtBlock !== 'string'
        || !/^\d+$/.test(rawStatus.verifiedAtBlock)) {
        throw new Error('The server returned an invalid verified strategy status.');
      }
      const strategyStatus: UserStrategyStatus = {
        reason: rawStatus.reason as UserStrategyStatus['reason'],
        approved: rawStatus.approved,
        enabled: rawStatus.enabled,
        paused: rawStatus.paused,
        valuationStatus: rawStatus.valuationStatus as UserStrategyStatus['valuationStatus'],
        positionValue: BigInt(rawStatus.positionValue),
        valuationBlock: BigInt(rawStatus.valuationBlock),
        verifiedAtBlock: BigInt(rawStatus.verifiedAtBlock),
      };
      const rawPosition = payload.position as Record<string, unknown>;
      if (rawPosition.status === 'NO_ACTIVE_POSITION') {
        return { position: { status: 'NO_ACTIVE_POSITION' }, strategyStatus, unavailableReason: null };
      }
      if (rawPosition.status !== 'POSITION_AVAILABLE'
        || rawPosition.unit !== 'USDC_BASE_UNITS'
        || typeof rawPosition.currentValueBaseUnits !== 'string'
        || !/^\d+$/.test(rawPosition.currentValueBaseUnits)) {
        throw new Error('The server returned an invalid user-specific Steakhouse position.');
      }
      return {
        position: {
          status: 'POSITION_AVAILABLE',
          currentValue: BigInt(rawPosition.currentValueBaseUnits),
        },
        strategyStatus,
        unavailableReason: null,
      };
    },
  });

  return {
    strategy: null,
    position: enabled && !query.error ? query.data?.position ?? null : null,
    strategyStatus: enabled && !query.error ? query.data?.strategyStatus ?? null : null,
    unavailableReason: enabled && !query.error ? query.data?.unavailableReason ?? null : null,
    isLoading: enabled && query.isLoading,
    error: enabled ? query.error instanceof Error ? query.error : query.error ? new Error('Strategy state read failed') : null : null,
    refetch: query.refetch,
  };
}
