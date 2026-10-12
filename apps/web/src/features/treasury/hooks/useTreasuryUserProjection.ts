import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getChainId } from 'viem/actions';
import { useConnectorClient } from 'wagmi';

import { getArcMainnetTreasuryAddress } from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';
import {
  hasWalletApiSession,
  isWalletApiAddressMatch,
  useWalletApiSession,
  walletApiSessionQueryKey,
} from '../../../hooks/useWalletApiAuth';

export function treasuryUserProjectionQueryKey(
  address: string | undefined,
  coreAddress: string | null | undefined = getArcMainnetTreasuryAddress(),
) {
  return [
    'treasury-user-projection',
    ARC_MAINNET_CHAIN_ID,
    coreAddress?.toLowerCase() ?? null,
    address?.toLowerCase() ?? null,
  ] as const;
}

export interface TreasuryUserProjectionScope {
  readonly address: string;
  readonly coreAddress: string | null;
}

export function clearTreasuryUserProjectionScope(
  queryClient: Pick<QueryClient, 'removeQueries'>,
  scope: TreasuryUserProjectionScope,
): void {
  queryClient.removeQueries({
    queryKey: treasuryUserProjectionQueryKey(scope.address, scope.coreAddress),
    exact: true,
  });
  queryClient.removeQueries({
    queryKey: walletApiSessionQueryKey(scope.address),
    exact: true,
  });
}

interface UserFinancialProjectionPayload {
  readonly scope?: unknown;
  readonly authenticatedWalletAddress?: unknown;
  readonly chainId?: unknown;
  readonly walletUSDC?: unknown;
  readonly userBalance?: unknown;
  readonly treasuryFinancialState?: {
    readonly principal?: unknown;
    readonly currentValue?: unknown;
    readonly unrealizedPnl?: unknown;
    readonly realizedPnl?: unknown;
    readonly totalPnl?: unknown;
  } | null;
  readonly immediateWithdrawalLiquidity?: {
    readonly source?: unknown;
    readonly availability?: unknown;
    readonly status?: unknown;
    readonly value?: unknown;
  };
  readonly publicOperationalStatus?: {
    readonly paused?: unknown;
    readonly blockNumber?: unknown;
  };
  readonly error?: string;
}

function parseBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function useTreasuryUserProjection(
  isConnected: boolean,
  isArcMainnet: boolean,
  walletAddress: string | undefined,
) {
  const queryClient = useQueryClient();
  const enabled = Boolean(isConnected && isArcMainnet);
  const { data: client } = useConnectorClient({ chainId: ARC_MAINNET_CHAIN_ID, query: { enabled } });
  const connectorAddress = client?.account?.address;
  const identityMatches = Boolean(walletAddress && connectorAddress
    && isWalletApiAddressMatch(connectorAddress, walletAddress));
  const coreAddress = getArcMainnetTreasuryAddress();
  const apiSession = useWalletApiSession(walletAddress, enabled && identityMatches);
  const isApiAuthenticated = identityMatches && hasWalletApiSession(apiSession.data, walletAddress);
  const previousScope = useRef<TreasuryUserProjectionScope | null>(null);
  useEffect(() => {
    const nextScope = enabled && identityMatches && isApiAuthenticated && walletAddress
      ? { address: walletAddress.toLowerCase(), coreAddress: coreAddress?.toLowerCase() ?? null }
      : null;
    const previous = previousScope.current;
    if (previous && (!nextScope
      || previous.address !== nextScope.address
      || previous.coreAddress !== nextScope.coreAddress)) {
      clearTreasuryUserProjectionScope(queryClient, previous);
    }
    previousScope.current = nextScope;
  }, [coreAddress, enabled, identityMatches, isApiAuthenticated, queryClient, walletAddress]);
  const query = useQuery({
    queryKey: treasuryUserProjectionQueryKey(walletAddress, coreAddress),
    enabled: enabled && Boolean(client && identityMatches && walletAddress && isApiAuthenticated),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    queryFn: async (): Promise<UserFinancialProjectionModel> => {
      if (!client || !walletAddress || !identityMatches) {
        throw new Error('The connected wallet does not match the active Arc Mainnet account.');
      }
      if (await getChainId(client) !== ARC_MAINNET_CHAIN_ID) throw new Error('Treasury reads require Arc Mainnet (Chain ID 5042).');

      const response = await fetch('/api/user-financial', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as UserFinancialProjectionPayload | null;
      if (response.status === 401) {
        await queryClient.invalidateQueries({ queryKey: walletApiSessionQueryKey(walletAddress) });
        throw new Error('Wallet sign-in expired. Sign in again to view your Treasury balance.');
      }
      if (!response.ok || !payload) throw new Error(payload?.error ?? 'User financial state request failed.');
      if (payload.scope !== 'USER' || payload.chainId !== ARC_MAINNET_CHAIN_ID) {
        throw new Error('The server returned an invalid user projection.');
      }
      if (typeof payload.authenticatedWalletAddress !== 'string'
        || !isWalletApiAddressMatch(payload.authenticatedWalletAddress, walletAddress)) {
        throw new Error('Authenticate the connected wallet to read its Treasury state.');
      }

      const rawState = payload.treasuryFinancialState;
      const parsedFinancialState = rawState
        ? {
            principal: parseBigIntOrNull(rawState.principal),
            currentValue: parseBigIntOrNull(rawState.currentValue),
            unrealizedPnl: parseBigIntOrNull(rawState.unrealizedPnl),
            realizedPnl: parseBigIntOrNull(rawState.realizedPnl),
            totalPnl: parseBigIntOrNull(rawState.totalPnl),
          }
        : null;
      const hasCompleteFinancialState = parsedFinancialState !== null
        && Object.values(parsedFinancialState).every((value) => value !== null);
      const treasuryFinancialState = hasCompleteFinancialState && parsedFinancialState
        ? parsedFinancialState
        : null;
      const operationalStatus = payload.publicOperationalStatus;
      const walletUSDC = parseBigIntOrNull(payload.walletUSDC);
      const userBalance = parseBigIntOrNull(payload.userBalance);
      const paused = typeof operationalStatus?.paused === 'boolean' ? operationalStatus.paused : null;
      const blockNumber = parseBigIntOrNull(operationalStatus?.blockNumber);
      const withdrawalPayload = payload.immediateWithdrawalLiquidity;
      const validWithdrawalStatuses = ['AVAILABLE', 'CONSTRAINED', 'PAUSED', 'UNAVAILABLE'] as const;
      const withdrawalStatus = typeof withdrawalPayload?.status === 'string'
        && validWithdrawalStatuses.includes(withdrawalPayload.status as typeof validWithdrawalStatuses[number])
        ? withdrawalPayload.status as typeof validWithdrawalStatuses[number]
        : 'UNAVAILABLE';
      const withdrawalValue = withdrawalPayload?.source === 'CORE'
        && withdrawalPayload.availability === 'AVAILABLE'
        && (withdrawalStatus === 'AVAILABLE' || withdrawalStatus === 'CONSTRAINED')
        ? parseBigIntOrNull(withdrawalPayload.value)
        : null;
      const immediateWithdrawalLiquidity = {
        source: withdrawalPayload?.source === 'CORE' && withdrawalStatus !== 'UNAVAILABLE' ? 'CORE' as const : 'UNAVAILABLE' as const,
        availability: withdrawalValue === null ? 'UNAVAILABLE' as const : 'AVAILABLE' as const,
        status: withdrawalStatus,
        unit: 'USDC_BASE_UNITS' as const,
        value: withdrawalValue,
      };
      return {
        scope: 'USER',
        authenticatedWalletAddress: payload.authenticatedWalletAddress,
        chainId: ARC_MAINNET_CHAIN_ID,
        walletUSDC,
        userBalance,
        treasuryFinancialState,
        publicOperationalStatus: {
          paused,
          blockNumber,
        },
        immediateWithdrawalLiquidity,
        fieldMetadata: {
          walletUSDC: {
            source: 'TOKEN_CONTRACT',
            availability: walletUSDC === null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: walletUSDC === null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          userBalance: {
            source: 'CORE',
            availability: userBalance === null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: userBalance === null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          treasuryFinancialState: {
            source: 'CORE',
            availability: treasuryFinancialState === null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'NONE',
            zeroMeaning: 'NOT_APPLICABLE',
          },
          principal: {
            source: 'CORE',
            availability: treasuryFinancialState?.principal == null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: treasuryFinancialState?.principal == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          currentValue: {
            source: 'CORE',
            availability: treasuryFinancialState?.currentValue == null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: treasuryFinancialState?.currentValue == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          unrealizedPnl: {
            source: 'CORE',
            availability: treasuryFinancialState?.unrealizedPnl == null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: treasuryFinancialState?.unrealizedPnl == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          realizedPnl: {
            source: 'CORE',
            availability: treasuryFinancialState?.realizedPnl == null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: treasuryFinancialState?.realizedPnl == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          totalPnl: {
            source: 'CORE',
            availability: treasuryFinancialState?.totalPnl == null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: treasuryFinancialState?.totalPnl == null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          immediateWithdrawalLiquidity: {
            source: immediateWithdrawalLiquidity.source,
            availability: immediateWithdrawalLiquidity.availability,
            unit: 'USDC_BASE_UNITS',
            zeroMeaning: immediateWithdrawalLiquidity.value === null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
          paused: {
            source: 'CORE',
            availability: paused === null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'BOOLEAN',
            zeroMeaning: paused === null ? 'UNAVAILABLE' : 'NOT_APPLICABLE',
          },
          blockNumber: {
            source: 'CORE',
            availability: blockNumber === null ? 'UNAVAILABLE' : 'AVAILABLE',
            unit: 'BLOCK',
            zeroMeaning: blockNumber === null ? 'UNAVAILABLE' : 'AUTHORITATIVE_ZERO',
          },
        },
      };
    },
  });

  return {
    projection: isApiAuthenticated && !query.isFetching && !query.error ? query.data ?? null : null,
    isLoading: isApiAuthenticated && (query.isLoading || query.isFetching),
    error: identityMatches && isApiAuthenticated
      ? query.error instanceof Error ? query.error : query.error ? new Error('User financial state read failed.') : null
      : null,
    isAuthenticated: isApiAuthenticated,
    isAuthenticationLoading: apiSession.isLoading,
    authenticationError: identityMatches && apiSession.error instanceof Error ? apiSession.error : null,
    refetch: query.refetch,
    canSelfWithdraw: Boolean(identityMatches && isArcMainnet),
  };
}