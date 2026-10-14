import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getAddress, recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  createWalletAuthMessage,
  issueWalletChallenge,
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  verifyWalletChallenge,
  WalletAuthConfigurationError,
  type WalletAuthDependencies,
  type WalletChallenge,
  type WalletChallengeStore,
} from '../../server/wallet-auth';
import { handleWalletAuthChallengeRequest } from '../../api/auth/challenge';
import { handleWalletAuthSessionRequest } from '../../api/auth/session';
import { handleWalletAuthVerifyRequest } from '../../api/auth/verify';
import {
  authenticateWalletApi,
  hasWalletApiSession,
  isWalletApiAddressMatch,
} from '../hooks/useWalletApiAuth';

const signature = '0xa461f509887bd19e312c0c58467ce8ff8e300d3c1a90b608a760c5b80318eaf15fe57c96f9175d6cd4daad4663763baa7e78836e067d0163e9a2ccf2ff753f5b1b';
const sessionSecret = 'test-only-session-secret-with-at-least-32-bytes';
const authOrigin = 'http://localhost:5173';
const now = new Date('2026-09-27T12:00:00.000Z');
const nonce = 'a'.repeat(64);
process.env.AUTH_SESSION_SECRET = sessionSecret;

function createStore(challenge: WalletChallenge): WalletChallengeStore & { isConsumed(): boolean } {
  let consumed = false;
  return {
    async create() { throw new Error('Not used by this store fixture.'); },
    async get(requestedNonce) {
      return requestedNonce === challenge.nonce ? { ...challenge, consumedAt: consumed ? now : null } : null;
    },
    async consume(requestedNonce, address, consumedAt) {
      if (consumed || requestedNonce !== challenge.nonce || address.toLowerCase() !== challenge.address.toLowerCase() || challenge.expiresAt <= consumedAt) return false;
      consumed = true;
      return true;
    },
    isConsumed() { return consumed; },
  };
}

function createDependencies(store: WalletChallengeStore, overrides: Partial<WalletAuthDependencies> = {}): WalletAuthDependencies {
  return {
    authOrigin,
    sessionSecret,
    store,
    now: () => now,
    createNonce: () => nonce,
    ...overrides,
  };
}

function fixtureChallenge(address: string, expiresAt = new Date(now.getTime() + 60_000)): WalletChallenge {
  return {
    nonce,
    address: address as WalletChallenge['address'],
    message: 'hello world',
    issuedAt: now,
    expiresAt,
  };
}

function createResponse() {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { response.statusCode = code; return response; },
    setHeader(name: string, value: string) { response.headers[name] = value; return response; },
    json(body: unknown) { response.body = body; },
  };
  return response;
}

describe('wallet authentication boundary', () => {
  it('uses Node ESM-resolvable imports in serverless authentication routes', () => {
    for (const route of ['challenge', 'session', 'verify']) {
      const source = readFileSync(new URL(`../../api/auth/${route}.ts`, import.meta.url), 'utf8');
      expect(source).toContain("from '../../server/wallet-auth.js'");
    }
  });

  it('matches API sessions only to the connected wallet address', () => {
    const address = '0x1111111111111111111111111111111111111111';
    const now = Date.parse('2026-10-09T09:00:00.000Z');
    expect(isWalletApiAddressMatch(address.toUpperCase().replace('0X', '0x'), address)).toBe(true);
    expect(hasWalletApiSession({
      authenticatedWalletAddress: address,
      expiresAt: new Date(now + 60_000).toISOString(),
    }, address, now)).toBe(true);
    expect(isWalletApiAddressMatch('0x2222222222222222222222222222222222222222', address)).toBe(false);
    expect(hasWalletApiSession(null, address)).toBe(false);
    expect(hasWalletApiSession({
      authenticatedWalletAddress: address,
      expiresAt: new Date(now).toISOString(),
    }, address, now)).toBe(false);
    expect(hasWalletApiSession({
      authenticatedWalletAddress: address,
      expiresAt: 'not-a-date',
    }, address, now)).toBe(false);
    expect(isWalletApiAddressMatch(address, undefined)).toBe(false);
  });

  it('does not request a wallet signature when the challenge endpoint rejects authentication', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'AUTH_ORIGIN is not configured.' }),
    } as Response));
    const signMessage = vi.fn(async () => '0x');

    await expect(authenticateWalletApi(
      '0x1111111111111111111111111111111111111111',
      signMessage,
      fetcher as typeof fetch,
    )).rejects.toThrow('Wallet challenge request failed (HTTP 503): AUTH_ORIGIN is not configured.');
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('returns actionable configuration errors without exposing configuration values', () => {
    const response = createResponse();
    respondToWalletAuthError(
      new WalletAuthConfigurationError('AUTH_SESSION_SECRET is not configured.'),
      response,
    );

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ error: 'AUTH_SESSION_SECRET is not configured.' });
    expect(JSON.stringify(response.body)).not.toContain(sessionSecret);
  });

  it('confirms the cookie-backed session for the connected wallet after signature verification', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce, message: 'Wallet authentication challenge' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticatedWalletAddress: address }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticatedWalletAddress: address, expiresAt }),
      } as Response);
    const signMessage = vi.fn(async () => signature);

    await expect(authenticateWalletApi(address, signMessage, fetcher as typeof fetch))
      .resolves.toEqual({ authenticatedWalletAddress: address, expiresAt });
    expect(signMessage).toHaveBeenCalledWith({ message: 'Wallet authentication challenge' });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/challenge',
      '/api/auth/verify',
      '/api/auth/session',
    ]);
    expect(fetcher.mock.calls[2]?.[0]).toBe('/api/auth/session');
    expect(fetcher.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('rejects a server-verified identity that differs from the connected wallet', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const otherAddress = '0x2222222222222222222222222222222222222222';
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce, message: 'Wallet authentication challenge' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticatedWalletAddress: otherAddress }),
      } as Response);

    await expect(authenticateWalletApi(address, async () => signature, fetcher as typeof fetch))
      .rejects.toThrow('Signed wallet does not match the connected wallet.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not complete authentication when the session endpoint rejects the issued session', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce, message: 'Wallet authentication challenge' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticatedWalletAddress: address }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Authentication required.' }),
      } as Response);

    await expect(authenticateWalletApi(address, async () => signature, fetcher as typeof fetch))
      .rejects.toThrow('Authenticated session confirmation failed (HTTP 401): Authentication required.');
  });

  it('completes wallet authentication through the challenge, signature, verify, and session routes', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    let challenge: WalletChallenge | null = null;
    let consumed = false;
    let sessionCookie = '';
    const store: WalletChallengeStore = {
      async create(value) { challenge = value; },
      async get(requestedNonce) {
        return challenge?.nonce === requestedNonce
          ? { ...challenge, consumedAt: consumed ? new Date() : null }
          : null;
      },
      async consume(requestedNonce, address) {
        if (consumed || challenge?.nonce !== requestedNonce || challenge.address.toLowerCase() !== address.toLowerCase()) {
          return false;
        }
        consumed = true;
        return true;
      },
    };
    const dependencies = createDependencies(store, {
      now: () => new Date(),
      createNonce: () => 'b'.repeat(64),
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const response = createResponse();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
      const request = {
        method: init?.method ?? 'GET',
        headers: { origin: authOrigin, cookie: sessionCookie },
        body,
      };

      if (path === '/api/auth/challenge') {
        await handleWalletAuthChallengeRequest(request, response, () => dependencies);
      } else if (path === '/api/auth/verify') {
        await handleWalletAuthVerifyRequest(request, response, () => dependencies);
        sessionCookie = response.headers['Set-Cookie']?.split(';')[0] ?? '';
      } else if (path === '/api/auth/session') {
        await handleWalletAuthSessionRequest(request, response);
      } else {
        throw new Error(`Unexpected wallet-auth request: ${path}`);
      }

      return {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        json: async () => response.body,
      } as Response;
    });

    const session = await authenticateWalletApi(
      account.address,
      ({ message }) => account.signMessage({ message }),
      fetcher as typeof fetch,
    );

    expect(session.authenticatedWalletAddress).toBe(account.address);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
    expect(sessionCookie).toMatch(/^velox_session=/);
    expect(consumed).toBe(true);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/challenge',
      '/api/auth/verify',
      '/api/auth/session',
    ]);
  });

  it('rejects missing authentication even when account query data is supplied', () => {
    expect(() => requireAuthenticatedWallet({ query: { account: '0x2222222222222222222222222222222222222222' } }, sessionSecret, now))
      .toThrow(/Authentication required/);
  });

  it('rejects malformed or tampered session authentication', () => {
    expect(() => requireAuthenticatedWallet({ headers: { cookie: 'velox_session=not-a-session' } }, sessionSecret, now))
      .toThrow(/Authentication required/);
  });

  it('rejects an invalid EIP-191 signature', async () => {
    const address = await recoverMessageAddress({ message: 'hello world', signature });
    const store = createStore(fixtureChallenge(address));
    await expect(verifyWalletChallenge(nonce, `0x${'11'.repeat(65)}`, createDependencies(store)))
      .rejects.toThrow(/signature could not be verified/i);
  });

  it('rejects expired challenges', async () => {
    const address = await recoverMessageAddress({ message: 'hello world', signature });
    const store = createStore(fixtureChallenge(address, new Date(now.getTime() - 1)));
    await expect(verifyWalletChallenge(nonce, signature, createDependencies(store)))
      .rejects.toThrow(/invalid or expired/i);
  });

  it('verifies the actual signature, returns its normalized wallet identity, and consumes the nonce once', async () => {
    const recoveredAddress = await recoverMessageAddress({ message: 'hello world', signature });
    const store = createStore(fixtureChallenge(recoveredAddress.toLowerCase()));
    const dependencies = createDependencies(store);

    const verified = await verifyWalletChallenge(nonce, signature, dependencies);
    expect(verified.context.authenticatedWalletAddress).toBe(getAddress(recoveredAddress));
    expect(store.isConsumed()).toBe(true);
    expect(requireAuthenticatedWallet({ headers: { cookie: `velox_session=${verified.sessionToken}` } }, sessionSecret, now))
      .toEqual(verified.context);
    await expect(verifyWalletChallenge(nonce, signature, dependencies)).rejects.toThrow(/invalid or expired/i);
  });

  it('binds the signed challenge to the address stored by the server', async () => {
    const expectedAddress = await recoverMessageAddress({ message: 'hello world', signature });
    const otherAddress = '0x2222222222222222222222222222222222222222';
    const store = createStore(fixtureChallenge(otherAddress));
    await expect(verifyWalletChallenge(nonce, signature, createDependencies(store)))
      .rejects.toThrow(/signature could not be verified/i);
    expect(expectedAddress.toLowerCase()).not.toBe(otherAddress.toLowerCase());
  });

  it('issues unpredictable-format, expiring messages bound to origin, wallet, and Arc chain', async () => {
    const address = await recoverMessageAddress({ message: 'hello world', signature });
    let inserted: WalletChallenge | undefined;
    const store: WalletChallengeStore = {
      async create(challenge) { inserted = challenge; },
      async get() { return null; },
      async consume() { return false; },
    };
    const challenge = await issueWalletChallenge(address, createDependencies(store));

    expect(challenge.nonce).toBe(nonce);
    expect(challenge.expiresAt.getTime() - challenge.issuedAt.getTime()).toBe(5 * 60 * 1000);
    expect(challenge.message).toBe(createWalletAuthMessage(getAddress(address), nonce, now, challenge.expiresAt, authOrigin));
    expect(inserted?.message).toBe(challenge.message);
    expect(challenge.message).toContain('Chain ID: 5042');
  });

  it('rejects challenge creation from a different origin', async () => {
    const response = createResponse();
    await handleWalletAuthChallengeRequest({
      method: 'POST',
      headers: { origin: 'https://attacker.invalid' },
      body: { address: '0x1111111111111111111111111111111111111111' },
    }, response, () => createDependencies(createStore(fixtureChallenge('0x1111111111111111111111111111111111111111'))));
    expect(response.statusCode).toBe(403);
  });

  it('sets an HttpOnly signed cookie on successful verification and exposes only the authenticated identity', async () => {
    const recoveredAddress = await recoverMessageAddress({ message: 'hello world', signature });
    const routeNow = new Date();
    const routeChallenge = {
      ...fixtureChallenge(recoveredAddress.toLowerCase(), new Date(routeNow.getTime() + 60_000)),
      issuedAt: routeNow,
    };
    const dependencies = createDependencies(createStore(routeChallenge), { now: () => routeNow });
    const expectedExpiry = new Date((Math.floor(routeNow.getTime() / 1000) + 15 * 60) * 1000).toISOString();
    const verifyResponse = createResponse();
    await handleWalletAuthVerifyRequest({
      method: 'POST',
      headers: { origin: authOrigin },
      body: { nonce, signature },
    }, verifyResponse, () => dependencies);

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.headers['Set-Cookie']).toContain('HttpOnly');
    expect(verifyResponse.headers['Set-Cookie']).toContain('SameSite=Strict');
    expect(verifyResponse.body).toEqual({
      authenticatedWalletAddress: getAddress(recoveredAddress),
      expiresAt: expectedExpiry,
    });
    expect(JSON.stringify(verifyResponse.body)).not.toContain('sessionToken');

    const sessionResponse = createResponse();
    await handleWalletAuthSessionRequest({
      method: 'GET',
      headers: { cookie: verifyResponse.headers['Set-Cookie'].split(';')[0] },
    }, sessionResponse);
    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.body).toEqual(verifyResponse.body);
  });
});