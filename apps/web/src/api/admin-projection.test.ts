import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getAddress } from 'viem';
import { ARC_MAINNET_RETIRED_ADDRESSES } from '@velox/domain';

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_CORE_ADDRESS,
} from '../../api/core-state';
import { handleAdminProjectionRequest } from '../../api/admin-projection';
import { createWalletSessionToken } from '../../server/wallet-auth';
import {
  ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
  POLICY_ADMIN_ROLE,
} from '../contracts/treasury';

const adminAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;
const otherAddress = '0x1111111111111111111111111111111111111111' as const;
const sessionSecret = 'admin-projection-test-secret-at-least-32-bytes';

describe('admin-projection Node ESM imports', () => {
  it('uses explicit JavaScript specifiers for its local serverless dependencies', () => {
    const source = readFileSync(new URL('../../api/admin-projection.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './core-state.js'");
    expect(source).toContain("from '../src/contracts/treasury.js'");
    expect(source).toContain("from '../server/wallet-auth.js'");
    expect(source).toContain("from './strategy-state.js'");
  });
});
const retiredCoreAddress = ARC_MAINNET_RETIRED_ADDRESSES.core;
process.env.AUTH_SESSION_SECRET = sessionSecret;
const adminHeaders = { cookie: `velox_session=${createWalletSessionToken(adminAddress, sessionSecret)}` };
const mixedCaseAdminHeaders = {
  cookie: `velox_session=${createWalletSessionToken(`0x${adminAddress.slice(2).toUpperCase()}`, sessionSecret)}`,
};
const otherHeaders = { cookie: `velox_session=${createWalletSessionToken(otherAddress, sessionSecret)}` };

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

function createClient(options: { role?: boolean; chainId?: number; failPolicyRoleRead?: boolean } = {}) {
  const calls: Array<{ address: string; functionName: string; args?: readonly unknown[] }> = [];
  const strategy = [
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
    300n,
    ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
    1,
    true,
    true,
  ] as const;
  const client = {
    calls,
    getChainId: vi.fn(async () => options.chainId ?? ARC_MAINNET_CHAIN_ID),
    getBlockNumber: vi.fn(async () => 500n),
    readContract: vi.fn(({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      calls.push({ address, functionName, args });
      if (functionName === 'hasRole') {
        if (args?.[0] === POLICY_ADMIN_ROLE && options.failPolicyRoleRead) return Promise.reject(new Error('RPC failed'));
        return Promise.resolve(args?.[0] === POLICY_ADMIN_ROLE ? options.role ?? true : false);
      }
      if (functionName === 'paused') return Promise.resolve(false);
      if (functionName === 'totalUserLiabilities') return Promise.resolve(1_500n);
      if (functionName === 'liquidUSDC') return Promise.resolve(700n);
      if (functionName === 'requiredLiquidReserve') return Promise.resolve(100n);
      if (functionName === 'availableLiquidity') return Promise.resolve(600n);
      if (functionName === 'totalDeployed') return Promise.resolve(300n);
      if (functionName === 'totalManagedAssets') return Promise.resolve(1_000n);
      if (functionName === 'approvedProtocolCount') return Promise.resolve(1n);
      if (functionName === 'approvedAssetCount') return Promise.resolve(1n);
      if (functionName === 'approvedStrategyCount') return Promise.resolve(1n);
      if (functionName === 'riskPolicy') return Promise.resolve({ minimumLiquidReserve: 100n, minimumLiquidReserveBps: 1_000, maximumTotalDeployed: 900n });
      if (functionName === 'TIMELOCK_DELAY') return Promise.resolve(172_800n);
      if (functionName === 'valuationFreshnessBlocks') return Promise.resolve(100n);
      if (functionName === 'bucketPolicy') return Promise.resolve({ liquidOperationalReserveBps: 4_000n, yieldStrategyBufferBps: 3_000n, sweepLiquidityBufferBps: 2_000n, automationAgentPoolBps: 1_000n });
      if (functionName === 'bucketTargets') return Promise.resolve([400n, 300n, 200n, 100n]);
      if (functionName === 'yieldStrategyBufferCapacity') return Promise.resolve(0n);
      if (functionName === 'liquidBucketClassifications') return Promise.resolve([500n, 100n, 100n]);
      if (functionName === 'strategies') return Promise.resolve(strategy);
      if (functionName === 'protocolCaps' || functionName === 'assetCaps') return Promise.resolve([2_000n, 5_000, true, true]);
      if (functionName === 'protocolVaults') return Promise.resolve('0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298');
      if (functionName === 'protocolExposure' || functionName === 'assetExposure') return Promise.resolve(300n);
      return Promise.reject(new Error(`Unexpected Admin projection read: ${functionName}`));
    }),
  };
  return client;
}

describe('Admin projection authorization and minimization', () => {
  it('rejects unauthenticated requests before creating a Core client', async () => {
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleAdminProjectionRequest({ method: 'GET', query: { admin: 'true' } }, response, clientFactory);
    expect(response.statusCode).toBe(401);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('rejects malformed or tampered session identities', async () => {
    expect(() => createWalletSessionToken('not-an-address', sessionSecret)).toThrow(/valid wallet address/i);
    const response = createResponse();
    const clientFactory = vi.fn(() => createClient() as never);
    await handleAdminProjectionRequest({ method: 'GET', headers: { cookie: 'velox_session=forged' } }, response, clientFactory);
    expect(response.statusCode).toBe(401);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('denies a non-admin despite admin/account/role query flags and checks the authenticated wallet only', async () => {
    const client = createClient({ role: false });
    const response = createResponse();
    await handleAdminProjectionRequest({
      method: 'GET',
      query: { account: adminAddress, admin: 'true', role: 'true', isPolicyAdmin: 'true' },
      headers: otherHeaders,
    }, response, () => client as never);

    expect(response.statusCode).toBe(403);
    expect(client.calls).toEqual([{
      address: ARC_MAINNET_CORE_ADDRESS,
      functionName: 'hasRole',
      args: [POLICY_ADMIN_ROLE, getAddress(otherAddress)],
    }]);
  });

  it('allows an authenticated POLICY_ADMIN after chain and Core role verification', async () => {
    const client = createClient({ role: true });
    const response = createResponse();
    await handleAdminProjectionRequest({ method: 'GET', headers: mixedCaseAdminHeaders }, response, () => client as never);

    expect(response.statusCode).toBe(200);
    expect(client.getChainId).toHaveBeenCalledOnce();
    expect(client.calls[0]).toEqual({
      address: ARC_MAINNET_CORE_ADDRESS,
      functionName: 'hasRole',
      args: [POLICY_ADMIN_ROLE, getAddress(adminAddress)],
    });
    expect(client.calls.every((call) => call.address === ARC_MAINNET_CORE_ADDRESS)).toBe(true);
    expect(client.calls.some((call) => call.address.toLowerCase() === retiredCoreAddress.toLowerCase())).toBe(false);
    const projection = response.body as Record<string, any>;
    expect(projection).toMatchObject({
      scope: 'ADMIN',
      authenticatedWalletAddress: getAddress(adminAddress),
      chainId: 5042,
      coreAddress: ARC_MAINNET_CORE_ADDRESS,
      treasury: {
        totalUserLiabilities: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '1500', zeroMeaning: 'AUTHORITATIVE_ZERO' },
        liquidUSDC: { source: 'CORE', unit: 'USDC_BASE_UNITS', value: '700' },
        totalManagedAssets: { source: 'CORE', unit: 'USDC_BASE_UNITS', value: '1000' },
        nav: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', value: null, zeroMeaning: 'UNAVAILABLE' },
        allocatedBalance: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', value: null },
      },
      approvals: {
        approvedProtocolCount: { source: 'CORE', availability: 'AVAILABLE', unit: 'COUNT', value: '1', zeroMeaning: 'AUTHORITATIVE_ZERO' },
        protocolRegistry: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'ADDRESS', value: null },
      },
      bucketPolicy: {
        yieldStrategyBufferBps: { source: 'CORE', availability: 'AVAILABLE', unit: 'BPS', value: '3000', zeroMeaning: 'AUTHORITATIVE_ZERO' },
      },
      coreExecutionConstraints: {
        timelockDelaySeconds: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', value: '172800' },
        valuationFreshnessBlocks: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', value: '100' },
      },
      historicalYieldSeries: { source: 'INDEXER', availability: 'UNAVAILABLE', value: null },
      pendingTimelocks: { source: 'CORE', availability: 'UNAVAILABLE', value: null },
      userStrategyAccounting: { source: 'CORE', availability: 'UNAVAILABLE', value: null },
      localDraftPolicy: { source: 'LOCAL_DRAFT', availability: 'UNAVAILABLE', value: null },
      strategy: {
        adapterAddress: { source: 'LOCAL_CONFIGURATION', availability: 'AVAILABLE' },
        principal: { source: 'CORE', availability: 'AVAILABLE', value: '1000' },
        currentValue: { source: 'CORE', availability: 'AVAILABLE', value: '1200' },
        shares: { source: 'CORE', availability: 'AVAILABLE', value: '900' },
        realizedYield: { source: 'CORE', availability: 'AVAILABLE', value: '250' },
        realizedLoss: { source: 'CORE', availability: 'AVAILABLE', value: '50' },
        withdrawalShortfall: { source: 'CORE', availability: 'AVAILABLE', value: '10' },
        valuationBlock: { source: 'CORE', availability: 'AVAILABLE', value: '300' },
        approved: { source: 'CORE', availability: 'AVAILABLE', value: true },
        enabled: { source: 'CORE', availability: 'AVAILABLE', value: true },
        unrealizedYield: { source: 'API_DERIVED', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '200' },
        totalPnl: { source: 'API_DERIVED', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '400' },
        protocolCap: {
          absoluteCap: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '2000', zeroMeaning: 'AUTHORITATIVE_ZERO' },
          relativeCapBps: { source: 'CORE', availability: 'AVAILABLE', unit: 'BPS', value: 5000, zeroMeaning: 'AUTHORITATIVE_ZERO' },
        },
        protocolVaultAddress: { source: 'CORE', availability: 'AVAILABLE' },
        protocolExposure: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '300' },
        assetExposure: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '300' },
      },
    });
    expect(JSON.stringify(projection)).not.toMatch(/POSTGRES_URL|AUTH_SESSION_SECRET|privateKey|seedPhrase|mnemonic|sessionToken/i);
  });

  it('fails closed on wrong RPC network before role or Admin data reads', async () => {
    const client = createClient({ chainId: 1 });
    const response = createResponse();
    await handleAdminProjectionRequest({ method: 'GET', headers: adminHeaders }, response, () => client as never);
    expect(response.statusCode).toBe(503);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it('fails closed when the Core role read fails', async () => {
    const client = createClient({ failPolicyRoleRead: true });
    const response = createResponse();
    await handleAdminProjectionRequest({ method: 'GET', headers: adminHeaders }, response, () => client as never);
    expect(response.statusCode).toBe(503);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].functionName).toBe('hasRole');
  });

  it('preserves unavailable optional Core fields rather than serializing zero', async () => {
    const client = createClient({ role: true });
    client.readContract.mockImplementation((({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === 'bucketPolicy') return Promise.reject(new Error('unsupported getter'));
      return createClient({ role: true }).readContract({ address, functionName, args });
    }) as never);
    const response = createResponse();
    await handleAdminProjectionRequest({ method: 'GET', headers: adminHeaders }, response, () => client as never);
    expect(response.statusCode).toBe(200);
    expect((response.body as Record<string, any>).bucketPolicy).toMatchObject({
      liquidOperationalReserveBps: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'BPS', value: null, zeroMeaning: 'UNAVAILABLE' },
      yieldStrategyBufferBps: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'BPS', value: null, zeroMeaning: 'UNAVAILABLE' },
      sweepLiquidityBufferBps: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'BPS', value: null, zeroMeaning: 'UNAVAILABLE' },
      automationAgentPoolBps: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'BPS', value: null, zeroMeaning: 'UNAVAILABLE' },
    });
  });

  it('makes registry, configured-strategy, timelock, and history completeness explicit', async () => {
    const response = createResponse();
    await handleAdminProjectionRequest({ method: 'GET', headers: adminHeaders }, response, () => createClient() as never);

    expect(response.statusCode).toBe(200);
    const projection = response.body as Record<string, any>;
    expect(projection.strategies).toMatchObject({
      availability: 'PARTIAL',
      data: {
        registry: { availability: 'UNAVAILABLE', data: null },
        configuredStrategy: {
          classification: 'CONFIGURED_STRATEGY_ONLY',
          availability: 'AVAILABLE',
          data: {
            principal: { source: 'CORE', availability: 'AVAILABLE', value: '1000' },
            currentValue: { source: 'CORE', availability: 'AVAILABLE', value: '1200' },
            shares: { source: 'CORE', availability: 'AVAILABLE', value: '900' },
            approved: { source: 'CORE', availability: 'AVAILABLE', value: true },
          },
        },
      },
    });
    expect(projection.strategies.reason).toMatch(/complete strategy registry is unavailable/i);
    expect(projection.protocols).toMatchObject({ availability: 'UNAVAILABLE', data: null });
    expect(projection.assets).toMatchObject({ availability: 'UNAVAILABLE', data: null });
    expect(projection.timelocks).toMatchObject({ availability: 'UNAVAILABLE', data: null });
    expect(projection.history).toMatchObject({ source: 'INDEXER', availability: 'UNAVAILABLE', data: null });
    expect(projection.history.reason).toMatch(/does not query or expose/i);
  });

  it('labels locally calculated configured-strategy remaining capacity as API_DERIVED', async () => {
    const response = createResponse();
    await handleAdminProjectionRequest({ method: 'GET', headers: adminHeaders }, response, () => createClient() as never);

    const exposure = (response.body as Record<string, any>).exposure;
    expect(exposure).toMatchObject({ availability: 'PARTIAL' });
    expect(exposure.data.configuredStrategyRemainingAbsoluteCapacity).toMatchObject({
      source: 'API_DERIVED', availability: 'AVAILABLE', value: '800', unit: 'USDC_BASE_UNITS',
    });
    expect(exposure.data.historicalExposure).toMatchObject({ source: 'INDEXER', availability: 'UNAVAILABLE', value: null });
  });
});
