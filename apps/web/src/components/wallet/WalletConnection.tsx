import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from 'wagmi';

import { useWalletStatus } from '../../hooks/useWalletStatus';
import {
  authenticateWalletApi,
  hasWalletApiSession,
  useWalletApiAuthProgress,
  useWalletApiSession,
  walletApiAuthProgressQueryKey,
  walletApiSessionQueryKey,
} from '../../hooks/useWalletApiAuth';
import { formatWalletAddress } from '../../services/wallet';

export function WalletConnection() {
  const { open } = useAppKit();
  const { address, chain, disconnect, isArcMainnet, isConnected } = useWalletStatus();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const queryClient = useQueryClient();
  const apiSession = useWalletApiSession(address, isConnected && isArcMainnet);
  const authProgress = useWalletApiAuthProgress(address, isConnected && isArcMainnet);
  const isApiAuthenticated = hasWalletApiSession(apiSession.data, address);
  const attemptedAddress = useRef<string | null>(null);
  const previousWalletScope = useRef<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const walletScope = isConnected && address
    ? `${address.toLowerCase()}:${chain?.id ?? 'unknown'}`
    : null;

  useEffect(() => {
    const previous = previousWalletScope.current;
    if (previous && previous !== walletScope) {
      queryClient.removeQueries({ queryKey: ['treasury-user-projection'] });
      queryClient.removeQueries({ queryKey: ['treasury-strategy-state'] });
      queryClient.removeQueries({ queryKey: ['wallet-api-session'] });
      queryClient.removeQueries({ queryKey: ['wallet-api-auth-progress'] });
    }
    previousWalletScope.current = walletScope;
  }, [queryClient, walletScope]);

  const authenticate = useCallback(async () => {
    if (!address || !isArcMainnet || isSigning || isAuthenticating) return;
    const normalizedAddress = address.toLowerCase();
    if (attemptedAddress.current === normalizedAddress) return;
    attemptedAddress.current = normalizedAddress;
    const progressKey = walletApiAuthProgressQueryKey(address);
    setIsAuthenticating(true);
    queryClient.setQueryData(progressKey, { status: 'pending' as const });
    try {
      const session = await authenticateWalletApi(address, ({ message }) => signMessageAsync({ message }));
      queryClient.setQueryData(walletApiSessionQueryKey(address), session);
      queryClient.setQueryData(progressKey, { status: 'idle' as const });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet authentication failed.';
      const rejected = /reject|cancel/i.test(message);
      queryClient.setQueryData(progressKey, {
        status: rejected ? 'rejected' as const : 'failed' as const,
        message: rejected
          ? `Wallet signature was rejected (${message}). No authenticated session was created.`
          : `Wallet sign-in failed (${message}). No authenticated session was created.`,
      });
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, isArcMainnet, isAuthenticating, isSigning, queryClient, signMessageAsync]);

  const retryAuthentication = useCallback(() => {
    attemptedAddress.current = null;
    void authenticate();
  }, [authenticate]);

  const retrySessionCheck = useCallback(() => {
    void apiSession.refetch();
  }, [apiSession.refetch]);

  useEffect(() => {
    if (!isConnected || !address || !isArcMainnet) {
      attemptedAddress.current = null;
      return;
    }
    if (apiSession.isLoading || apiSession.isFetching || apiSession.error) return;
    if (isApiAuthenticated) {
      attemptedAddress.current = null;
      return;
    }
    if (isAuthenticating || isSigning || attemptedAddress.current === address.toLowerCase()) return;
    void authenticate();
  }, [
    address,
    apiSession.error,
    apiSession.isFetching,
    apiSession.isLoading,
    authenticate,
    isApiAuthenticated,
    isArcMainnet,
    isAuthenticating,
    isConnected,
    isSigning,
  ]);

  if (!isConnected || !address) {
    return (
      <button type="button" className="vx-btn vx-btn-primary" onClick={() => void open()}>
        Connect wallet
      </button>
    );
  }

  return (
    <section
      aria-label="Wallet connection"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.85rem' }}>Connected: {formatWalletAddress(address)}</p>
      <p style={{ margin: 0, fontSize: '0.85rem' }}>
        Network: {chain?.name ?? `Chain ${chain?.id ?? 'unknown'}`}
      </p>
      {!isApiAuthenticated && isArcMainnet && (
        <div
          role={authProgress.data?.status === 'failed' || authProgress.data?.status === 'rejected' || apiSession.error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {authProgress.data?.status === 'pending' || isSigning || isAuthenticating
            ? <span className="vx-stage-pill">Confirm wallet sign-in</span>
            : apiSession.error
              ? (
                <>
                  <span>Wallet session check failed: {apiSession.error.message}</span>
                  <button type="button" className="vx-btn vx-btn-outline" onClick={retrySessionCheck}>
                    Retry session check
                  </button>
                </>
              )
              : authProgress.data?.status === 'failed' || authProgress.data?.status === 'rejected'
                ? (
                  <>
                    <span>{authProgress.data.message ?? 'Wallet sign-in failed. No authenticated session was created.'}</span>
                    <button type="button" className="vx-btn vx-btn-outline" onClick={retryAuthentication}>
                      Retry wallet sign-in
                    </button>
                  </>
                )
            : (
              <span>
                Your Treasury data will appear after wallet sign-in is completed.
              </span>
            )}
        </div>
      )}
      {!isArcMainnet && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: '0.8rem',
            color: '#f43f5e',
            fontWeight: 600,
          }}
        >
          Wrong network. Switch to Arc Mainnet in your wallet, then reconnect.
        </p>
      )}
      <button
        type="button"
        className="vx-btn vx-btn-outline"
        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
        onClick={() => disconnect()}
      >
        Disconnect wallet
      </button>
    </section>
  );
}
