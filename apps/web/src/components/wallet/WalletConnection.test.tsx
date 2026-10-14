// @vitest-environment jsdom

import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wallet: {
    address: '0x1111111111111111111111111111111111111111' as string | undefined,
    chain: { name: 'Arc', id: 5042 },
    disconnect: vi.fn(),
    isArcMainnet: true,
    isConnected: true,
  },
  apiSession: {
    data: null as { authenticatedWalletAddress: string; expiresAt: string } | null,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    refetch: vi.fn(async () => undefined),
  },
  authProgress: { status: 'idle' as 'idle' | 'pending' | 'rejected' | 'failed', message: undefined as string | undefined },
  signMessageAsync: vi.fn(async () => '0xsignature'),
  authenticateWalletApi: vi.fn(async (
    _address: string,
    _signMessage: (input: { readonly message: string }) => Promise<string>,
  ) => ({
    authenticatedWalletAddress: mocks.wallet.address!,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(async () => undefined),
  removeQueries: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: mocks.open }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: mocks.setQueryData,
    invalidateQueries: mocks.invalidateQueries,
    removeQueries: mocks.removeQueries,
  }),
}));

vi.mock('wagmi', () => ({
  useSignMessage: () => ({ signMessageAsync: mocks.signMessageAsync, isPending: false }),
}));

vi.mock('../../hooks/useWalletStatus', () => ({
  useWalletStatus: () => mocks.wallet,
}));

vi.mock('../../hooks/useWalletApiAuth', () => ({
  authenticateWalletApi: (
    ...args: [string, (input: { readonly message: string }) => Promise<string>]
  ) => mocks.authenticateWalletApi(...args),
  hasWalletApiSession: (
    session: typeof mocks.apiSession.data,
    address: string | undefined,
  ) => Boolean(
    session
      && address
      && session.authenticatedWalletAddress.toLowerCase() === address.toLowerCase()
      && Date.parse(session.expiresAt) > Date.now(),
  ),
  useWalletApiAuthProgress: () => ({ data: mocks.authProgress }),
  useWalletApiSession: () => mocks.apiSession,
  walletApiAuthProgressQueryKey: (address: string | undefined) => ['wallet-api-auth-progress', address],
  walletApiSessionQueryKey: (address: string | undefined) => ['wallet-api-session', address],
}));

import { WalletConnection } from './WalletConnection';

describe('WalletConnection automatic authentication', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.wallet.address = '0x1111111111111111111111111111111111111111';
    mocks.wallet.chain = { name: 'Arc', id: 5042 };
    mocks.wallet.isArcMainnet = true;
    mocks.wallet.isConnected = true;
    mocks.apiSession.data = null;
    mocks.apiSession.isLoading = false;
    mocks.apiSession.isFetching = false;
    mocks.apiSession.error = null;
    mocks.apiSession.refetch.mockReset().mockResolvedValue(undefined);
    mocks.authProgress = { status: 'idle', message: undefined };
    mocks.signMessageAsync.mockReset().mockResolvedValue('0xsignature');
    mocks.authenticateWalletApi.mockReset().mockImplementation(async () => ({
      authenticatedWalletAddress: mocks.wallet.address!,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    mocks.setQueryData.mockReset();
    mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
    mocks.removeQueries.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(strict = false) {
    await act(async () => {
      root.render(strict
        ? createElement(StrictMode, null, createElement(WalletConnection))
        : createElement(WalletConnection));
    });
  }

  it('automatically authenticates once when a wallet connects to Arc', async () => {
    mocks.wallet.isConnected = false;
    await render();
    expect(mocks.authenticateWalletApi).not.toHaveBeenCalled();

    mocks.authenticateWalletApi.mockImplementation(async (_address, signMessage) => {
      await signMessage({ message: 'Wallet authentication challenge' });
      return {
        authenticatedWalletAddress: mocks.wallet.address!,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    });
    mocks.wallet.isConnected = true;
    await render(true);

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);
    expect(mocks.authenticateWalletApi.mock.calls[0]?.[0]).toBe(mocks.wallet.address);
    expect(mocks.signMessageAsync).toHaveBeenCalledTimes(1);
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ['wallet-api-session', mocks.wallet.address],
      expect.objectContaining({ authenticatedWalletAddress: mocks.wallet.address }),
    );
    expect(container.querySelector('button[aria-label*="sign"]')).toBeNull();
    expect(container.textContent).not.toContain('Sign in to view your Treasury balance');
  });

  it('does not prompt when the connected wallet already has a valid session', async () => {
    mocks.apiSession.data = {
      authenticatedWalletAddress: mocks.wallet.address!,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await render();

    expect(mocks.authenticateWalletApi).not.toHaveBeenCalled();
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
  });

  it('automatically reauthenticates an expired session', async () => {
    mocks.apiSession.data = {
      authenticatedWalletAddress: mocks.wallet.address!,
      expiresAt: new Date(Date.now() - 1).toISOString(),
    };

    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);
    expect(mocks.authenticateWalletApi.mock.calls[0]?.[0]).toBe(mocks.wallet.address);
  });

  it('allows automatic reauthentication after a previously valid session expires', async () => {
    await render();
    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);

    mocks.apiSession.data = {
      authenticatedWalletAddress: mocks.wallet.address!,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await render();

    mocks.apiSession.data = {
      authenticatedWalletAddress: mocks.wallet.address!,
      expiresAt: new Date(Date.now() - 1).toISOString(),
    };
    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(2);
    expect(mocks.authenticateWalletApi.mock.calls.map(([address]) => address)).toEqual([
      mocks.wallet.address,
      mocks.wallet.address,
    ]);
  });

  it('authenticates the new wallet after the connected address changes', async () => {
    await render();
    mocks.wallet.address = '0x2222222222222222222222222222222222222222';
    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(2);
    expect(mocks.authenticateWalletApi.mock.calls.map(([address]) => address)).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
    ]);
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ['treasury-user-projection'] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ['treasury-strategy-state'] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ['wallet-api-session'] });
  });

  it('does not repeat a signature prompt after authentication fails until the user retries', async () => {
    mocks.authenticateWalletApi.mockRejectedValue(new Error('User rejected request'));
    mocks.setQueryData.mockImplementation((key, value) => {
      if (
        Array.isArray(key)
        && key[0] === 'wallet-api-auth-progress'
        && value
        && typeof value === 'object'
        && 'status' in value
      ) {
        mocks.authProgress = value as typeof mocks.authProgress;
      }
    });

    await render();
    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Wallet signature was rejected');
    expect(container.textContent).toContain('User rejected request');
    expect(container.textContent).toContain('No authenticated session was created.');
    expect(Array.from(container.querySelectorAll('button')).some((button) => (
      button.textContent?.includes('Retry wallet sign-in')
    ))).toBe(true);
    expect(container.querySelector('button[aria-label*="sign"]')).toBeNull();
  });

  it('retries a rejected signature only after an explicit user action', async () => {
    let attempts = 0;
    mocks.authenticateWalletApi.mockImplementation(async (address, signMessage) => {
      attempts += 1;
      await signMessage({ message: 'Wallet authentication challenge' });
      if (attempts === 1) throw new Error('User rejected request');
      return {
        authenticatedWalletAddress: address,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    });
    mocks.setQueryData.mockImplementation((key, value) => {
      if (Array.isArray(key) && key[0] === 'wallet-api-auth-progress') {
        mocks.authProgress = value as typeof mocks.authProgress;
      }
    });

    await render();
    await render();
    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);

    const retry = Array.from(container.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('Retry wallet sign-in')
    ));
    expect(retry).toBeDefined();
    await act(async () => retry?.click());

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(2);
    expect(mocks.signMessageAsync).toHaveBeenCalledTimes(2);
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ['wallet-api-session', mocks.wallet.address],
      expect.objectContaining({ authenticatedWalletAddress: mocks.wallet.address }),
    );
  });

  it('automatically authenticates when a connected wallet session check fails', async () => {
    mocks.apiSession.error = new Error('Wallet session authentication is not configured.');

    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);
    expect(mocks.authenticateWalletApi.mock.calls[0]?.[0]).toBe(mocks.wallet.address);
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ['wallet-api-session', mocks.wallet.address],
      expect.objectContaining({ authenticatedWalletAddress: mocks.wallet.address }),
    );
  });

  it('offers wallet-auth retry when automatic authentication fails after a session check error', async () => {
    mocks.apiSession.error = new Error('Wallet session authentication is not configured.');
    mocks.authenticateWalletApi.mockRejectedValue(new Error('Authentication service unavailable.'));
    mocks.setQueryData.mockImplementation((key, value) => {
      if (Array.isArray(key) && key[0] === 'wallet-api-auth-progress') {
        mocks.authProgress = value as typeof mocks.authProgress;
      }
    });

    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Authentication service unavailable.');
    expect(Array.from(container.querySelectorAll('button')).some((button) => (
      button.textContent?.includes('Retry wallet sign-in')
    ))).toBe(true);
  });

  it('does not authenticate on the wrong chain and starts after switching to Arc', async () => {
    mocks.wallet.isArcMainnet = false;
    mocks.wallet.chain = { name: 'Ethereum', id: 1 };

    await render();
    expect(mocks.authenticateWalletApi).not.toHaveBeenCalled();

    mocks.wallet.isArcMainnet = true;
    mocks.wallet.chain = { name: 'Arc', id: 5042 };
    await render();
    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);
  });

  it('allows automatic sign-in again after disconnecting and reconnecting the same wallet', async () => {
    await render();
    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(1);

    mocks.wallet.isConnected = false;
    await render();
    mocks.wallet.isConnected = true;
    await render();

    expect(mocks.authenticateWalletApi).toHaveBeenCalledTimes(2);
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ['treasury-user-projection'] });
    expect(mocks.removeQueries).toHaveBeenCalledWith({ queryKey: ['treasury-strategy-state'] });
  });

  it('waits for session status before automatically authenticating', async () => {
    mocks.apiSession.isLoading = true;
    mocks.apiSession.isFetching = true;

    await render();

    expect(mocks.authenticateWalletApi).not.toHaveBeenCalled();
  });
});
