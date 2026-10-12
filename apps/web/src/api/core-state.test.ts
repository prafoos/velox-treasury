import { describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_CORE_ADDRESS,
  handleCoreStateRequest,
  readCoreState,
} from '../../api/core-state';
import { ARC_MAINNET_EXECUTION_CONFIG } from '../../../api/src/config/arc-mainnet.js';
import { createWalletSessionToken } from '../../server/wallet-auth';

const account = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;
const sessionSecret = 'test-only-session-secret-with-at-least-32-bytes';
process.env.AUTH_SESSION_SECRET = sessionSecret;
const authenticatedHeaders = { cookie: `velox_session=${createWalletSessionToken(account, sessionSecret)}` };

function createResponse() {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value;
      return response;
    },
    json(body: unknown) {
      response.body = body;
    },
    end() {},
  };
  return response;
}

function createClient() {
  const values: Record<string, unknown> = {
    paused: false,
    balanceOf: 75n,
    userBalance: 12n,
    immediatelyWithdrawableValue: 12n,
    userFinancialState: { principal: 10n, currentValue: 12n, unrealizedPnl: 2n, realizedPnl: 3n, totalPnl: 5n, immediatelyWithdrawableValue: 12n },
    totalUserLiabilities: 100n,
    liquidUSDC: 90n,
    requiredLiquidReserve: 10n,
    availableLiquidity: 80n,
    totalDeployed: 20n,
    totalManagedAssets: 110n,
    approvedProtocolCount: 1n,
    approvedAssetCount: 2n,
    approvedStrategyCount: 3n,
    riskPolicy: { minimumLiquidReserve: 10n, minimumLiquidReserveBps: 500, maximumTotalDeployed: 1000n },
    bucketPolicy: { liquidOperationalReserveBps: 4_000n, yieldStrategyBufferBps: 3_000n, sweepLiquidityBufferBps: 2_000n, automationAgentPoolBps: 1_000n },
    bucketTargets: [40n, 30n, 20n, 10n],
    yieldStrategyBufferCapacity: 30n,
    liquidBucketClassifications: [40n, 30n, 20n],
    hasRole: true,
  };
  const calls: Array<{ address: string; functionName: string; args?: readonly unknown[] }> = [];
  const client = {
    calls,
    getChainId: vi.fn(async () => 5042),
    getBlockNumber: vi.fn(async () => 250n),
    readContract: vi.fn(({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      calls.push({ address, functionName, args });
      return Promise.resolve(values[functionName]);
    }),
  };
  return client;
}

describe('core-state endpoint', () => {
  it('initializes its API Core target from the shared local-safe server configuration', () => {
    expect(ARC_MAINNET_CORE_ADDRESS).toBe(ARC_MAINNET_EXECUTION_CONFIG.coreAddress);
    expect(ARC_MAINNET_EXECUTION_CONFIG.mode).toBe('FINAL_DEPLOYMENT');
  });

  it('rejects unsupported methods', async () => {
    const response = createResponse();
    await handleCoreStateRequest({ method: 'POST' }, response, () => createClient() as never);

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET');
  });

  it('does not treat an account query parameter as authentication', async () => {
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleCoreStateRequest({ method: 'GET', query: { account: '0x2222222222222222222222222222222222222222' } }, response, clientFactory);
    expect(response.statusCode).toBe(401);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('rejects invalid accounts', async () => {
    const response = createResponse();
    await handleCoreStateRequest({ method: 'GET', query: { account: 'not-an-address' }, headers: authenticatedHeaders }, response, () => createClient() as never);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid account address.' });
  });

  it('does not expose another wallet\'s financial state to an authenticated user', async () => {
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleCoreStateRequest({
      method: 'GET',
      query: { account: '0x2222222222222222222222222222222222222222' },
      headers: authenticatedHeaders,
    }, response, clientFactory);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: 'Requested account does not match the authenticated wallet.' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('returns only user-scoped financial state and public operational status', async () => {
    const client = createClient();
    const response = createResponse();
    await handleCoreStateRequest({ method: 'GET', query: { account, method: 'eth_sendTransaction', params: 'arbitrary' }, headers: authenticatedHeaders }, response, () => client as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).toEqual({
      scope: 'USER',
      authenticatedWalletAddress: getAddress(account),
      chainId: 5042,
      walletUSDC: '75',
      userBalance: '12',
      treasuryFinancialState: {
        principal: '10',
        currentValue: '12',
        unrealizedPnl: '2',
        realizedPnl: '3',
        totalPnl: '5',
      },
      publicOperationalStatus: { paused: false, blockNumber: '250' },
      immediateWithdrawalLiquidity: {
        source: 'CORE',
        availability: 'AVAILABLE',
        status: 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        value: '12',
      },
      fieldMetadata: {
        walletUSDC: {
          source: 'TOKEN_CONTRACT',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        userBalance: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        treasuryFinancialState: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'NONE',
          zeroMeaning: 'NOT_APPLICABLE',
        },
        principal: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        currentValue: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        unrealizedPnl: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        realizedPnl: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        totalPnl: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        immediateWithdrawalLiquidity: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'USDC_BASE_UNITS',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
        paused: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'BOOLEAN',
          zeroMeaning: 'NOT_APPLICABLE',
        },
        blockNumber: {
          source: 'CORE',
          availability: 'AVAILABLE',
          unit: 'BLOCK',
          zeroMeaning: 'AUTHORITATIVE_ZERO',
        },
      },
    });
    expect(client.calls.map((call) => call.functionName).sort()).toEqual(['balanceOf', 'immediatelyWithdrawableValue', 'paused', 'userBalance', 'userFinancialState']);
    expect(client.calls.filter((call) => call.functionName !== 'balanceOf').every((call) => call.address === ARC_MAINNET_CORE_ADDRESS)).toBe(true);
    expect(client.calls.find((call) => call.functionName === 'balanceOf')?.address).toBeDefined();
    const responseKeys = Object.keys(response.body as object);
    expect(responseKeys).not.toEqual(expect.arrayContaining([
      'totalManagedAssets', 'totalUserLiabilities', 'totalDeployed', 'liquidUSDC', 'riskPolicy', 'bucketPolicy',
      'bucketTargets', 'liquidBucketClassifications', 'yieldStrategyBufferCapacity', 'roles',
    ]));
    expect(client.getChainId).toHaveBeenCalledOnce();
  });

  it('fails closed on wrong or unreadable RPC chain before reading User state', async () => {
    for (const getChainId of [
      vi.fn(async () => 1),
      vi.fn(async () => Number.NaN),
      vi.fn(async () => { throw new Error('RPC unavailable'); }),
    ]) {
      const client = { ...createClient(), getChainId, readContract: vi.fn() };
      const response = createResponse();
      await handleCoreStateRequest({ method: 'GET', headers: authenticatedHeaders }, response, () => client as never);
      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({ error: 'User financial state is temporarily unavailable.' });
      expect(client.readContract).not.toHaveBeenCalled();
      expect((response.body as Record<string, unknown>).chainId).toBeUndefined();
    }
  });

  it('rejects another account even when the request has an authenticated session', async () => {
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleCoreStateRequest({
      method: 'GET',
      query: { account: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
      headers: authenticatedHeaders,
    }, response, clientFactory);
    expect(response.statusCode).toBe(403);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('accepts a mixed-case equivalent of the authenticated account', async () => {
    const client = createClient();
    const response = createResponse();
    await handleCoreStateRequest({
      method: 'GET',
      query: { account: `0x${account.slice(2).toUpperCase()}` },
      headers: authenticatedHeaders,
    }, response, () => client as never);
    expect(response.statusCode).toBe(200);
    expect((response.body as Record<string, unknown>).authenticatedWalletAddress).toBe(getAddress(account));
  });

  it('keeps genuine on-chain zero values as zero', async () => {
    const client = createClient();
    const zeroClient = {
      ...client,
      readContract: vi.fn(({ functionName }: { functionName: string }) => {
        if (functionName === 'liquidUSDC') return Promise.resolve(0n);
        return Promise.resolve(client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, functionName }));
      }),
    };
    const state = await readCoreState(zeroClient as never, account);
    expect(state.liquidUSDC).toBe(0n);
    expect(state.requiredLiquidReserve).not.toBeNull();
  });

  it('reports reverted userFinancialState reads as unavailable instead of failing the whole endpoint', async () => {
    const client = createClient();
    const response = createResponse();
    const badClient = {
      ...client,
      readContract: vi.fn(({ functionName }: { functionName: string }) => {
        if (functionName === 'userFinancialState') return Promise.reject(new Error('execution reverted'));
        return client.readContract({ address: ARC_MAINNET_CORE_ADDRESS, functionName });
      }),
    };

    await handleCoreStateRequest({ method: 'GET', query: { account }, headers: authenticatedHeaders }, response, () => badClient as never);

    const body = response.body as Record<string, unknown>;
    expect(response.statusCode).toBe(200);
    expect(body.treasuryFinancialState).toBeNull();
  });

  it('keeps successful userFinancialState values intact', async () => {
    const client = createClient();
    const state = await readCoreState(client as never, account);
    expect(state.userFinancialState).toMatchObject({
      principal: 10n,
      currentValue: 12n,
      unrealizedPnl: 2n,
      realizedPnl: 3n,
      totalPnl: 5n,
      immediatelyWithdrawableValue: 12n,
    });
  });

  it('keeps immediate withdrawal unavailable when an older Core lacks the explicit selector', async () => {
    const client = createClient();
    client.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'immediatelyWithdrawableValue') return Promise.reject(new Error('unsupported selector'));
      return Promise.resolve(({ paused: false, userBalance: 12n, userFinancialState: { principal: 10n, currentValue: 12n, unrealizedPnl: 2n, realizedPnl: 3n, totalPnl: 5n, immediatelyWithdrawableValue: 12n }, totalUserLiabilities: 100n, liquidUSDC: 90n, requiredLiquidReserve: 10n, availableLiquidity: 80n, totalDeployed: 20n, totalManagedAssets: 110n, approvedProtocolCount: 1n, approvedAssetCount: 2n, approvedStrategyCount: 3n, riskPolicy: { minimumLiquidReserve: 10n, minimumLiquidReserveBps: 500, maximumTotalDeployed: 1000n }, bucketPolicy: { liquidOperationalReserveBps: 4_000n, yieldStrategyBufferBps: 3_000n, sweepLiquidityBufferBps: 2_000n, automationAgentPoolBps: 1_000n }, bucketTargets: [40n, 30n, 20n, 10n], yieldStrategyBufferCapacity: 30n, liquidBucketClassifications: [40n, 30n, 20n], hasRole: true } as Record<string, unknown>)[functionName]);
    });

    const state = await readCoreState(client as never, account);
    expect(state.userFinancialState).toMatchObject({ currentValue: 12n, immediatelyWithdrawableValue: null });
  });

  it('keeps failed user financial reads unavailable without converting them to zero', async () => {
    const response = createResponse();
    const badClient = {
      ...createClient(),
      readContract: vi.fn(({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
        if (functionName === 'userFinancialState') return Promise.reject(new Error('execution reverted'));
        return createClient().readContract({ address, functionName, args });
      }),
    };
    await handleCoreStateRequest({ method: 'GET', query: { account }, headers: authenticatedHeaders }, response, () => badClient as never);
    expect(response.statusCode).toBe(200);
    expect((response.body as Record<string, unknown>).treasuryFinancialState).toBeNull();
  });

  it('uses the authenticated wallet when no account selector is supplied', async () => {
    const client = createClient();
    const response = createResponse();
    await handleCoreStateRequest({ method: 'GET', headers: authenticatedHeaders }, response, () => client as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ authenticatedWalletAddress: getAddress(account), userBalance: '12' });
    expect(client.calls.some((call) => call.functionName === 'userBalance' && call.args?.[0] === getAddress(account))).toBe(true);
  });
});