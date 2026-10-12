import { describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

import { handleUserFinancialStateRequest, readUserFinancialState } from '../../api/user-financial';
import { createWalletSessionToken } from '../../server/wallet-auth';

const account = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;
const canonicalAccount = getAddress(account);
const sessionSecret = 'test-only-session-secret-with-at-least-32-bytes';
process.env.AUTH_SESSION_SECRET = sessionSecret;
const authenticatedHeaders = { cookie: `velox_session=${createWalletSessionToken(account, sessionSecret)}` };

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

function createClient(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    paused: false,
    userBalance: 12n,
    immediatelyWithdrawableValue: 12n,
    userFinancialState: { principal: 10n, currentValue: 12n, unrealizedPnl: 2n, realizedPnl: 3n, totalPnl: 5n, immediatelyWithdrawableValue: 12n },
    balanceOf: 75n,
    ...overrides,
  };
  const calls: Array<{ address: string; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }> = [];
  return {
    calls,
    getChainId: vi.fn(async () => 5042),
    getBlockNumber: vi.fn(async () => 250n),
    readContract: vi.fn(({ address, functionName, args, blockNumber }: { address: string; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
      calls.push({ address, functionName, args, blockNumber });
      if (Object.hasOwn(values, functionName)) return Promise.resolve(values[functionName]);
      return Promise.reject(new Error(`Unexpected projection read: ${functionName}`));
    }),
  };
}

describe('user-financial projection', () => {
  it('returns only authenticated-user state and public operational status', async () => {
    const client = createClient();
    const state = await readUserFinancialState(client as never, canonicalAccount);

    expect(state.scope).toBe('USER');
    expect(state.authenticatedWalletAddress).toBe(canonicalAccount);
    expect(state.chainId).toBe(5042);
    expect(state.userBalance).toBe(12n);
    expect(state.walletUSDC).toBe(75n);
    expect(state.treasuryFinancialState).toEqual({
      principal: 10n,
      currentValue: 12n,
      unrealizedPnl: 2n,
      realizedPnl: 3n,
      totalPnl: 5n,
    });
    expect(state.publicOperationalStatus).toEqual({ paused: false, blockNumber: 250n });
    expect(state.immediateWithdrawalLiquidity).toEqual({
      source: 'CORE', availability: 'AVAILABLE', status: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: 12n,
    });
    expect(state.fieldMetadata.walletUSDC).toEqual({
      source: 'TOKEN_CONTRACT', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(state.fieldMetadata.treasuryFinancialState).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'NONE', zeroMeaning: 'NOT_APPLICABLE',
    });
    expect(state.fieldMetadata.principal).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(state.fieldMetadata.currentValue).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(state.fieldMetadata.unrealizedPnl).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(state.fieldMetadata.realizedPnl).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(state.fieldMetadata.totalPnl).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(state.fieldMetadata.immediateWithdrawalLiquidity).toEqual({
      source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO',
    });
    expect(client.calls.map((call) => call.functionName).sort()).toEqual(['balanceOf', 'immediatelyWithdrawableValue', 'paused', 'userBalance', 'userFinancialState']);
    expect(client.calls.every((call) => call.blockNumber === 250n)).toBe(true);
    expect(client.getChainId).toHaveBeenCalledOnce();
    expect(Object.keys(state).sort()).toEqual([
      'authenticatedWalletAddress', 'chainId', 'fieldMetadata', 'immediateWithdrawalLiquidity', 'publicOperationalStatus', 'scope', 'treasuryFinancialState', 'userBalance', 'walletUSDC',
    ]);
  });

  it('fails closed before contract reads when it cannot pin a coherent projection block', async () => {
    const client = createClient();
    client.getBlockNumber.mockRejectedValue(new Error('RPC unavailable'));

    await expect(readUserFinancialState(client as never, canonicalAccount))
      .rejects.toThrow('Unable to determine the Arc Mainnet read block');
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('rejects User reads when actual RPC chain ID is wrong, missing, malformed, or unavailable', async () => {
    const wrongChainClient = createClient();
    wrongChainClient.getChainId.mockResolvedValue(1);
    await expect(readUserFinancialState(wrongChainClient as never, canonicalAccount))
      .rejects.toThrow('RPC chain ID must be 5042');
    expect(wrongChainClient.readContract).not.toHaveBeenCalled();

    const unavailableChainClient = createClient();
    unavailableChainClient.getChainId.mockRejectedValue(new Error('RPC unavailable'));
    await expect(readUserFinancialState(unavailableChainClient as never, canonicalAccount))
      .rejects.toThrow('Unable to verify the RPC chain ID');
    expect(unavailableChainClient.readContract).not.toHaveBeenCalled();

    const malformedChainClient = createClient();
    malformedChainClient.getChainId.mockResolvedValue(Number.NaN);
    await expect(readUserFinancialState(malformedChainClient as never, canonicalAccount))
      .rejects.toThrow('RPC chain ID must be 5042');
    expect(malformedChainClient.readContract).not.toHaveBeenCalled();
  });

  it('does not return configured Mainnet chain metadata when the User RPC is on another chain', async () => {
    const client = createClient();
    client.getChainId.mockResolvedValue(1);
    const response = createResponse();
    await handleUserFinancialStateRequest({ method: 'GET', headers: authenticatedHeaders }, response, () => client as never);
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'User financial state is temporarily unavailable.' });
    expect(response.body).not.toHaveProperty('chainId', 5042);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('derives identity from the session when account is omitted and excludes aggregates', async () => {
    const client = createClient();
    const response = createResponse();
    await handleUserFinancialStateRequest({ method: 'GET', headers: authenticatedHeaders }, response, () => client as never);
    expect(response.statusCode).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body.authenticatedWalletAddress).toBe(canonicalAccount);
    expect(body.treasuryFinancialState).toMatchObject({
      principal: '10', currentValue: '12', realizedPnl: '3', unrealizedPnl: '2', totalPnl: '5',
    });
    expect(body.immediateWithdrawalLiquidity).toEqual({
      source: 'CORE', availability: 'AVAILABLE', status: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '12',
    });
    expect(Object.keys(body).sort()).toEqual([
      'authenticatedWalletAddress', 'chainId', 'fieldMetadata', 'immediateWithdrawalLiquidity', 'publicOperationalStatus', 'scope', 'treasuryFinancialState', 'userBalance', 'walletUSDC',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/totalManagedAssets|totalUserLiabilities|totalDeployed|liquidUSDC|riskPolicy|bucketPolicy|bucketTargets|roles|strategyState|shares|withdrawalShortfall/i);
  });

  it('reads each wallet’s own financial ledger and keeps Core-wide assets out of the User projection', async () => {
    const walletA = getAddress('0x1111111111111111111111111111111111111111');
    const walletB = getAddress('0x2222222222222222222222222222222222222222');
    const walletAClient = createClient({
      userBalance: 1_000_000n,
      immediatelyWithdrawableValue: 1_000_000n,
      userFinancialState: {
        principal: 1_000_000n,
        currentValue: 1_000_000n,
        unrealizedPnl: 0n,
        realizedPnl: 0n,
        totalPnl: 0n,
        immediatelyWithdrawableValue: 1_000_000n,
      },
    });
    const walletBClient = createClient({
      userBalance: 0n,
      immediatelyWithdrawableValue: 0n,
      balanceOf: 0n,
      userFinancialState: {
        principal: 0n,
        currentValue: 0n,
        unrealizedPnl: 0n,
        realizedPnl: 0n,
        totalPnl: 0n,
        immediatelyWithdrawableValue: 0n,
      },
    });

    const [projectionA, projectionB] = await Promise.all([
      readUserFinancialState(walletAClient as never, walletA),
      readUserFinancialState(walletBClient as never, walletB),
    ]);

    expect(walletAClient.calls.filter((call) => call.args?.length).every((call) => call.args?.[0] === walletA)).toBe(true);
    expect(walletBClient.calls.filter((call) => call.args?.length).every((call) => call.args?.[0] === walletB)).toBe(true);
    expect(projectionA.authenticatedWalletAddress).toBe(walletA);
    expect(projectionA.treasuryFinancialState?.principal).toBe(1_000_000n);
    expect(projectionB.authenticatedWalletAddress).toBe(walletB);
    expect(projectionB.userBalance).toBe(0n);
    expect(projectionB.treasuryFinancialState?.principal).toBe(0n);
    expect(projectionB.treasuryFinancialState?.currentValue).toBe(0n);
    expect(projectionB.immediateWithdrawalLiquidity.value).toBe(0n);
    expect(Object.keys(projectionB)).not.toContain('totalManagedAssets');
    expect(walletBClient.calls.every((call) => ![
      'totalManagedAssets', 'totalDeployed', 'totalUserLiabilities', 'bucketTargets',
    ].includes(call.functionName))).toBe(true);
  });

  it('reports the actual response block rather than a fixed snapshot value', async () => {
    const client = createClient();
    client.getBlockNumber.mockResolvedValue(25_557_801n);

    const projection = await readUserFinancialState(client as never, canonicalAccount);

    expect(projection.publicOperationalStatus.blockNumber).toBe(25_557_801n);
    expect(client.calls.every((call) => call.blockNumber === 25_557_801n)).toBe(true);
  });

  it('rejects another account before performing reads', async () => {
    for (const requestedAccount of [
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    ]) {
      const response = createResponse();
      const clientFactory = vi.fn(() => createClient() as never);
      await handleUserFinancialStateRequest({
        method: 'GET', query: { account: requestedAccount }, headers: authenticatedHeaders,
      }, response, clientFactory);
      expect(response.statusCode).toBe(403);
      expect(clientFactory).not.toHaveBeenCalled();
    }
  });

  it('accepts mixed-case equivalents but rejects malformed account selectors', async () => {
    const equivalentResponse = createResponse();
    await handleUserFinancialStateRequest({
      method: 'GET', query: { account: `0x${account.slice(2).toUpperCase()}` }, headers: authenticatedHeaders,
    }, equivalentResponse, () => createClient() as never);
    expect(equivalentResponse.statusCode).toBe(200);
    expect((equivalentResponse.body as Record<string, unknown>).authenticatedWalletAddress).toBe(canonicalAccount);

    const malformedResponse = createResponse();
    await handleUserFinancialStateRequest({ method: 'GET', query: { account: 'nope' }, headers: authenticatedHeaders }, malformedResponse, () => createClient() as never);
    expect(malformedResponse.statusCode).toBe(400);
  });

  it('rejects missing authentication without falling back to the requested account', async () => {
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleUserFinancialStateRequest({ method: 'GET', query: { account } }, response, clientFactory);
    expect(response.statusCode).toBe(401);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('preserves unavailable financial state and genuine zeros distinctly', async () => {
    const failedClient = createClient();
    failedClient.readContract.mockImplementation(({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === 'userFinancialState') return Promise.reject(new Error('unsupported getter'));
      return createClient().readContract({ address, functionName, args });
    });
    const failed = await readUserFinancialState(failedClient as never, canonicalAccount);
    expect(failed.treasuryFinancialState).toBeNull();
    expect(failed.fieldMetadata.treasuryFinancialState.availability).toBe('UNAVAILABLE');
    expect(failed.immediateWithdrawalLiquidity).toEqual({
      source: 'UNAVAILABLE', availability: 'UNAVAILABLE', status: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', value: null,
    });

    const zeroClient = createClient({
      userBalance: 0n,
      balanceOf: 0n,
      immediatelyWithdrawableValue: 0n,
      userFinancialState: { principal: 0n, currentValue: 0n, unrealizedPnl: 0n, realizedPnl: 0n, totalPnl: 0n, immediatelyWithdrawableValue: 0n },
    });
    const zero = await readUserFinancialState(zeroClient as never, canonicalAccount);
    expect(zero.userBalance).toBe(0n);
    expect(zero.walletUSDC).toBe(0n);
    expect(zero.treasuryFinancialState).toEqual({
      principal: 0n,
      currentValue: 0n,
      unrealizedPnl: 0n,
      realizedPnl: 0n,
      totalPnl: 0n,
    });
    expect(zero.immediateWithdrawalLiquidity.value).toBe(0n);
    expect(zero.immediateWithdrawalLiquidity.status).toBe('AVAILABLE');
    expect(zero.fieldMetadata.treasuryFinancialState.zeroMeaning).toBe('NOT_APPLICABLE');
    expect(zero.fieldMetadata.principal.zeroMeaning).toBe('AUTHORITATIVE_ZERO');
    expect(zero.fieldMetadata.immediateWithdrawalLiquidity.zeroMeaning).toBe('AUTHORITATIVE_ZERO');
  });

  it('represents paused withdrawal availability as unavailable rather than numeric zero', async () => {
    const paused = await readUserFinancialState(createClient({ paused: true }) as never, canonicalAccount);
    expect(paused.immediateWithdrawalLiquidity).toEqual({
      source: 'CORE', availability: 'UNAVAILABLE', status: 'PAUSED', unit: 'USDC_BASE_UNITS', value: null,
    });
  });

  it('preserves an authoritative constrained liquid amount without substituting the full NAV', async () => {
    const constrained = await readUserFinancialState(createClient({
      immediatelyWithdrawableValue: 4n,
    }) as never, canonicalAccount);
    expect(constrained.immediateWithdrawalLiquidity).toEqual({
      source: 'CORE', availability: 'AVAILABLE', status: 'CONSTRAINED', unit: 'USDC_BASE_UNITS', value: 4n,
    });
  });

  it('fails closed when an older Core lacks the explicit immediate-withdrawal selector', async () => {
    const client = createClient();
    client.readContract.mockImplementation(({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === 'immediatelyWithdrawableValue') return Promise.reject(new Error('function selector was not recognized'));
      return Promise.resolve(({ paused: false, userBalance: 12n, userFinancialState: { principal: 10n, currentValue: 12n, unrealizedPnl: 2n, realizedPnl: 3n, totalPnl: 5n, immediatelyWithdrawableValue: 12n }, balanceOf: 75n } as Record<string, unknown>)[functionName]);
    });

    const state = await readUserFinancialState(client as never, canonicalAccount);
    expect(state.treasuryFinancialState?.currentValue).toBe(12n);
    expect(state.immediateWithdrawalLiquidity).toEqual({
      source: 'UNAVAILABLE', availability: 'UNAVAILABLE', status: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', value: null,
    });
  });
});
