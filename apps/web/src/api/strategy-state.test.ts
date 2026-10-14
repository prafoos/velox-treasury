import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { ARC_MAINNET_CORE_ADDRESS, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS } from '../../api/core-state';
import { handleStrategyStateRequest, readStrategyState, readUserStrategyPosition } from '../../api/strategy-state';
import { createWalletSessionToken } from '../../server/wallet-auth';

const userA = '0x1111111111111111111111111111111111111111' as const;
const userB = '0x2222222222222222222222222222222222222222' as const;
const sessionSecret = 'test-only-session-secret-with-at-least-32-bytes';
process.env.AUTH_SESSION_SECRET = sessionSecret;
const userAHeaders = { cookie: `velox_session=${createWalletSessionToken(userA, sessionSecret)}` };
const userBHeaders = { cookie: `velox_session=${createWalletSessionToken(userB, sessionSecret)}` };

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
  };
  return response;
}

function createClient(
  position: readonly [bigint, bigint] = [0n, 0n],
  currentBlock = 350n,
  freshnessBlocks = 1_200n,
  valuationBlock = 300n,
) {
  const readBlocks: Array<bigint | undefined> = [];
  return {
    readBlocks,
    getChainId: vi.fn(async () => 5042),
    getBlockNumber: vi.fn(async () => currentBlock),
    readContract: vi.fn(({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      readBlocks.push(blockNumber);
      if (functionName === 'userStrategyPosition') return Promise.resolve(position);
      if (functionName === 'totalDeployed') return Promise.resolve(1_200n);
      if (functionName === 'valuationFreshnessBlocks') return Promise.resolve(freshnessBlocks);
      if (functionName === 'paused') return Promise.resolve(false);
      return Promise.resolve([
        '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
        '0x3600000000000000000000000000000000000000',
        2_000n,
        5_000,
        1_000n,
        900n,
        1_200n,
        250n,
        50n,
        5n,
        10n,
        valuationBlock,
        ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
        1,
        true,
        true,
      ]);
    }),
  };
}

describe('strategy-state endpoint', () => {
  it('uses Node ESM-resolvable imports for the Steakhouse position route', () => {
    const source = readFileSync(new URL('../../api/strategy-state.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './core-state.js'");
    expect(source).toContain("from '../server/wallet-auth.js'");
  });

  it('does not treat a strategy query parameter as authentication', async () => {
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleStrategyStateRequest({ method: 'GET', query: { strategy: ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS } }, response, clientFactory);
    expect(response.statusCode).toBe(401);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('retains the system-wide strategy reader for the authorized admin projection', async () => {
    const client = createClient();
    const state = await readStrategyState(client as never, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS);

    expect(state.strategyAddress).toBe(ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS);
    expect(state.shares).toBe(900n);
    expect(state.currentValue).toBe(1_200n);
    expect(state.feesAccrued).toBe(5n);
    expect(state.valuationSource).toBe(ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS);
    expect(state.valuationStatusLabel).toBe('current');
    expect(state.totalDeployed).toBe(1_200n);
    expect(client.readBlocks).toEqual([350n, 350n, 350n]);
  });

  it('labels a stored Current valuation stale when Core block freshness has elapsed', async () => {
    const client = createClient([0n, 0n], 1_501n, 1_200n);
    const state = await readStrategyState(client as never, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS);

    expect(state.valuationStatus).toBe(1);
    expect(state.valuationBlock).toBe(300n);
    expect(state.valuationStatusLabel).toBe('stale');
    expect(client.readBlocks).toEqual([1_501n, 1_501n, 1_501n]);
  });

  it('labels a Current valuation stale when Core freshness is disabled', async () => {
    const client = createClient([0n, 0n], 350n, 0n);
    const state = await readStrategyState(client as never, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS);

    expect(state.valuationStatusLabel).toBe('stale');
  });

  it('returns a confirmed no-position result using only the authenticated wallet and configured strategy', async () => {
    const response = createResponse();
    const client = createClient();
    await handleStrategyStateRequest(
      { method: 'GET', query: { strategy: ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS }, headers: userAHeaders },
      response,
      () => client as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      scope: 'USER',
      authenticatedWalletAddress: userA,
      chainId: 5042,
      availability: 'AVAILABLE',
      position: { status: 'NO_ACTIVE_POSITION' },
      strategyStatus: {
        reason: 'APPROVED_ENABLED_NO_POSITION',
        approved: true,
        enabled: true,
        paused: false,
        valuationStatus: 'CURRENT',
        positionShares: '0',
        positionValue: '0',
        valuationBlock: '300',
        verifiedAtBlock: '350',
      },
    });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: ARC_MAINNET_CORE_ADDRESS,
      functionName: 'userStrategyPosition',
      args: [userA, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS],
    }));
    expect(JSON.stringify(response.body)).not.toMatch(/totalDeployed|totalManagedAssets|realizedYield|otherUsers/i);
  });

  it('returns only the authenticated user-specific position when one exists', async () => {
    const clientA = createClient([500n, 1_200n]);
    const clientB = createClient([100n, 240n]);
    const responseA = createResponse();
    const responseB = createResponse();
    await handleStrategyStateRequest({ method: 'GET', headers: userAHeaders }, responseA, () => clientA as never);
    await handleStrategyStateRequest({ method: 'GET', headers: userBHeaders }, responseB, () => clientB as never);

    expect(responseA.body).toEqual({
      scope: 'USER',
      authenticatedWalletAddress: userA,
      chainId: 5042,
      availability: 'AVAILABLE',
      position: { status: 'POSITION_AVAILABLE', currentValueBaseUnits: '1200', unit: 'USDC_BASE_UNITS' },
      strategyStatus: {
        reason: 'POSITION_AVAILABLE',
        approved: true,
        enabled: true,
        paused: false,
        valuationStatus: 'CURRENT',
        positionShares: '500',
        positionValue: '1200',
        valuationBlock: '300',
        verifiedAtBlock: '350',
      },
    });
    expect(responseB.body).toEqual({
      scope: 'USER',
      authenticatedWalletAddress: userB,
      chainId: 5042,
      availability: 'AVAILABLE',
      position: { status: 'POSITION_AVAILABLE', currentValueBaseUnits: '240', unit: 'USDC_BASE_UNITS' },
      strategyStatus: {
        reason: 'POSITION_AVAILABLE',
        approved: true,
        enabled: true,
        paused: false,
        valuationStatus: 'CURRENT',
        positionShares: '100',
        positionValue: '240',
        valuationBlock: '300',
        verifiedAtBlock: '350',
      },
    });
    expect(clientA.readContract).toHaveBeenCalledWith(expect.objectContaining({ args: [userA, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS] }));
    expect(clientB.readContract).toHaveBeenCalledWith(expect.objectContaining({ args: [userB, ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS] }));
    for (const body of [responseA.body, responseB.body]) {
      expect(JSON.stringify(body)).not.toMatch(/totalDeployed|totalManagedAssets|realizedYield|otherUsers/i);
    }
    expect(JSON.stringify(responseA.body)).not.toContain('240');
    expect(JSON.stringify(responseB.body)).not.toContain('1200');
  });

  it('rejects attempts to read another wallet or an unconfigured strategy before RPC calls', async () => {
    const otherWalletResponse = createResponse();
    const wrongStrategyResponse = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleStrategyStateRequest(
      { method: 'GET', query: { account: userB }, headers: userAHeaders },
      otherWalletResponse,
      clientFactory,
    );
    await handleStrategyStateRequest(
      { method: 'GET', query: { strategy: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, headers: userAHeaders },
      wrongStrategyResponse,
      clientFactory,
    );

    expect(otherWalletResponse.statusCode).toBe(403);
    expect(wrongStrategyResponse.statusCode).toBe(400);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('returns a recoverable error, not a zero position, when the RPC read fails', async () => {
    const response = createResponse();
    const client = createClient();
    client.readContract.mockRejectedValue(new Error('RPC unavailable'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await handleStrategyStateRequest({ method: 'GET', headers: userAHeaders }, response, () => client as never);
    } finally {
      errorLog.mockRestore();
    }

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      error: 'Your Steakhouse position is temporarily unavailable. Please try again.',
    });
    expect(response.body).not.toHaveProperty('position');
  });

  it('does not read strategy state from an RPC on the wrong chain', async () => {
    const response = createResponse();
    const client = createClient();
    client.getChainId.mockResolvedValue(1);
    await handleStrategyStateRequest({ method: 'GET', headers: userAHeaders }, response, () => client as never);

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toHaveProperty('position');
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('distinguishes an empty user position from an RPC failure in the read helper', async () => {
    const empty = await readUserStrategyPosition(createClient([0n, 0n]) as never, userA);
    expect(empty).toMatchObject({
      status: 'NO_ACTIVE_POSITION',
      strategyStatus: {
        reason: 'APPROVED_ENABLED_NO_POSITION',
        positionShares: 0n,
        positionValue: 0n,
      },
    });
    await expect(readUserStrategyPosition(createClient([10n, 0n]) as never, userA))
      .resolves.toMatchObject({ status: 'POSITION_AVAILABLE', currentValue: 0n });
  });

  it('identifies stale valuation as the verified eligibility blocker without returning Core totals', async () => {
    const client = createClient([0n, 0n], 25_561_179n, 1_200n, 25_416_075n);
    const result = await readUserStrategyPosition(client as never, userA);

    expect(result.strategyStatus).toMatchObject({
      reason: 'VALUATION_STALE',
      approved: true,
      enabled: true,
      valuationStatus: 'STALE',
      valuationBlock: 25_416_075n,
      verifiedAtBlock: 25_561_179n,
    });
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'strategies',
      args: [ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS],
      blockNumber: 25_561_179n,
    }));
  });
});
