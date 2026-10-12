import { useQuery } from '@tanstack/react-query';

export interface WalletApiSession {
  readonly authenticatedWalletAddress: string;
  readonly expiresAt: string;
}

export type WalletApiAuthProgress = {
  readonly status: 'idle' | 'pending' | 'rejected' | 'failed';
  readonly message?: string;
};

export function isWalletApiAddressMatch(authenticatedAddress: unknown, address: string | undefined): boolean {
  return Boolean(typeof authenticatedAddress === 'string'
    && address
    && authenticatedAddress.toLowerCase() === address.toLowerCase());
}

export function hasWalletApiSession(
  session: WalletApiSession | null | undefined,
  address: string | undefined,
  now = Date.now(),
): boolean {
  if (!session || !isWalletApiAddressMatch(session.authenticatedWalletAddress, address)) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function walletApiSessionQueryKey(address: string | undefined) {
  return ['wallet-api-session', address?.toLowerCase() ?? null] as const;
}

export function walletApiAuthProgressQueryKey(address: string | undefined) {
  return ['wallet-api-auth-progress', address?.toLowerCase() ?? null] as const;
}

export function useWalletApiAuthProgress(address: string | undefined, enabled = true) {
  return useQuery<WalletApiAuthProgress>({
    queryKey: walletApiAuthProgressQueryKey(address),
    enabled: Boolean(enabled && address),
    initialData: { status: 'idle' },
    staleTime: Infinity,
    retry: false,
    queryFn: async () => ({ status: 'idle' }),
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function useWalletApiSession(address: string | undefined, enabled = true) {
  return useQuery<WalletApiSession | null, Error>({
    queryKey: walletApiSessionQueryKey(address),
    enabled: Boolean(enabled && address),
    staleTime: 0,
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      if (!expiresAt) return false;
      const delay = Date.parse(expiresAt) - Date.now();
      return Number.isFinite(delay) && delay > 0 ? delay : false;
    },
    retry: false,
    queryFn: async () => {
      const response = await fetch('/api/auth/session', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const payload = asRecord(await response.json().catch(() => null));
      if (response.status === 401) return null;
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Wallet authentication is temporarily unavailable.');
      }
      if (typeof payload?.authenticatedWalletAddress !== 'string' || typeof payload.expiresAt !== 'string') return null;
      if (payload.authenticatedWalletAddress.toLowerCase() !== address?.toLowerCase()) return null;
      return {
        authenticatedWalletAddress: payload.authenticatedWalletAddress,
        expiresAt: payload.expiresAt,
      };
    },
  });
}

export type WalletMessageSigner = (input: { readonly message: string }) => Promise<string>;

export async function authenticateWalletApi(
  address: string,
  signMessage: WalletMessageSigner,
  fetcher: typeof fetch = fetch,
): Promise<WalletApiSession> {
  const challengeResponse = await fetcher('/api/auth/challenge', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const challenge = asRecord(await challengeResponse.json().catch(() => null));
  if (!challengeResponse.ok || typeof challenge?.nonce !== 'string' || typeof challenge.message !== 'string') {
    throw new Error(typeof challenge?.error === 'string' ? challenge.error : 'Wallet authentication is temporarily unavailable.');
  }

  const signature = await signMessage({ message: challenge.message });
  const verifyResponse = await fetcher('/api/auth/verify', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  const verification = asRecord(await verifyResponse.json().catch(() => null));
  if (!verifyResponse.ok || typeof verification?.authenticatedWalletAddress !== 'string') {
    throw new Error(typeof verification?.error === 'string' ? verification.error : 'Wallet authentication failed.');
  }
  if (verification.authenticatedWalletAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Signed wallet does not match the connected wallet.');
  }

  const sessionResponse = await fetcher('/api/auth/session', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const session = asRecord(await sessionResponse.json().catch(() => null));
  if (!sessionResponse.ok
    || typeof session?.authenticatedWalletAddress !== 'string'
    || typeof session.expiresAt !== 'string') {
    throw new Error(typeof session?.error === 'string'
      ? session.error
      : 'The authenticated wallet session could not be confirmed.');
  }
  if (session.authenticatedWalletAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Authenticated session does not match the connected wallet.');
  }
  if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error('The authenticated wallet session is expired or invalid.');
  }

  return {
    authenticatedWalletAddress: session.authenticatedWalletAddress,
    expiresAt: session.expiresAt,
  };
}
