import { describe, expect, it, vi } from 'vitest';
import type { AdminAiInput } from '../../../api/src/agent/types.js';
import { ARC_MAINNET_EXECUTION_CONFIG } from '../../../api/src/config/arc-mainnet.js';
import {
  ARC_MAINNET_MORPHO_ASSET,
  ARC_MAINNET_STEAKHOUSE_PROTOCOL_ID,
  ARC_MAINNET_STEAKHOUSE_VAULT,
  MARKET_SNAPSHOT_MAX_AGE_SECONDS,
  MORPHO_GRAPHQL_ENDPOINT,
  readVerifiedSteakhouseMarketSnapshot,
} from '../../api/steakhouse-market-data';
import type { CoreStateClient } from '../../api/core-state';

const walletAddress = '0x1111111111111111111111111111111111111111' as const;
const now = new Date('2026-10-03T02:15:09.000Z');

function createAdminProjection(): AdminAiInput {
  const wrapped = (value: unknown) => ({ source: 'CORE', availability: 'AVAILABLE' as const, value });
  return {
    scope: 'ADMIN',
    authenticatedWalletAddress: walletAddress,
    chainId: 5042,
    coreAddress: '0x2222222222222222222222222222222222222222',
    authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', zeroMeaning: 'NOT_APPLICABLE', value: true } },
    treasury: {
      totalUserLiabilities: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 500n },
      liquidUSDC: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 250n },
      requiredLiquidReserve: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 100n },
      availableLiquidity: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 150n },
      totalDeployed: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 250n },
      totalManagedAssets: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 500n },
      paused: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', zeroMeaning: 'NOT_APPLICABLE', value: false },
      blockNumber: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', zeroMeaning: 'AUTHORITATIVE_ZERO', value: 1234n },
    },
    strategy: {
      protocolId: wrapped(ARC_MAINNET_STEAKHOUSE_PROTOCOL_ID),
      assetAddress: wrapped(ARC_MAINNET_MORPHO_ASSET),
      protocolVaultAddress: wrapped(ARC_MAINNET_STEAKHOUSE_VAULT),
      approved: wrapped(true),
      enabled: wrapped(true),
    },
  };
}

function createMorphoResponse(overrides: {
  readonly chainId?: number;
  readonly vaultAddress?: string;
  readonly assetAddress?: string;
  readonly assetDecimals?: number;
  readonly headTimestamp?: string;
  readonly marketTimestamp?: string;
  readonly totalAssets?: string | number | null;
  readonly liquidity?: string | number | null;
  readonly apy?: number | null;
  readonly utilization?: number | null;
  readonly marketLoanAssetAddress?: string;
  readonly unavailableSupplementalFields?: boolean;
  readonly warnings?: unknown;
} = {}) {
  const chainId = overrides.chainId ?? 5042;
  const head = {
    number: '23977224',
    timestamp: overrides.headTimestamp ?? '1790993698',
  };
  return {
    data: {
      chain: { id: chainId, headBlock: head },
      vaultV2ByAddress: {
        address: overrides.vaultAddress ?? ARC_MAINNET_STEAKHOUSE_VAULT,
        chain: { id: chainId, headBlock: head },
        asset: {
          address: overrides.assetAddress ?? ARC_MAINNET_MORPHO_ASSET,
          decimals: overrides.assetDecimals ?? 6,
        },
        totalAssets: overrides.totalAssets === undefined ? '2588945063084' : overrides.totalAssets,
        totalSupply: overrides.unavailableSupplementalFields ? null : '2588881384990533466041473',
        idleAssets: overrides.unavailableSupplementalFields ? null : '2480851070524',
        liquidity: overrides.liquidity === undefined ? '2480854053334' : overrides.liquidity,
        apy: overrides.apy === undefined ? 0.0003576588314253735 : overrides.apy,
        netApy: overrides.unavailableSupplementalFields ? null : 0.0003576588314253735,
        warnings: overrides.unavailableSupplementalFields ? null : (overrides.warnings ?? []),
        timelocks: overrides.unavailableSupplementalFields ? null : [{ functionName: 'setSendAssetsGate', duration: '604800', abdicatedAt: null }],
        gatesConfig: overrides.unavailableSupplementalFields ? null : { receiveAssetsGate: { address: null, abdicated: true } },
        liquidityData: {
          __typename: 'MarketV1LiquidityData',
          market: {
            chain: { id: chainId },
            marketId: '0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d',
            loanAsset: { address: overrides.marketLoanAssetAddress ?? ARC_MAINNET_MORPHO_ASSET, decimals: 6 },
            lltv: overrides.unavailableSupplementalFields ? null : '860000000000000000',
            collateralAsset: { address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
            state: {
              blockNumber: '23976144',
              timestamp: overrides.marketTimestamp ?? '1790993150',
              liquidityAssets: '2982810',
              utilization: overrides.utilization === undefined ? 0.9999999842952184 : overrides.utilization,
              collateralAssets: '363872096253',
            },
            oracle: overrides.unavailableSupplementalFields ? null : { address: '0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab', type: 'ChainlinkOracleV2' },
            badDebt: overrides.unavailableSupplementalFields ? null : { underlying: '0', usd: 0 },
            warnings: overrides.unavailableSupplementalFields ? null : [],
          },
        },
      },
    },
  };
}

function createFetcher(data: unknown = createMorphoResponse()) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { variables: { address: string; chainId: number } };
    expect(String(input)).toBe(MORPHO_GRAPHQL_ENDPOINT);
    expect(body.variables).toEqual({ address: ARC_MAINNET_STEAKHOUSE_VAULT, chainId: 5042 });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('verified Morpho GraphQL vault and market snapshot', () => {
  it('uses identity-checked Arc RPC vault facts when Morpho is unavailable', async () => {
    const readContract = vi.fn(async ({ functionName }: { readonly functionName: string }) => {
      switch (functionName) {
        case 'asset': return ARC_MAINNET_MORPHO_ASSET;
        case 'totalAssets': return 2_500_000n;
        case 'totalSupply': return 2_400_000n;
        case 'maxWithdraw': return 200_000n;
        case 'maxDeposit': return 300_000n;
        default: throw new Error(`Unexpected ERC-4626 read ${functionName}`);
      }
    });
    const rpcClient = {
      getChainId: vi.fn(async () => 5042),
      getBlockNumber: vi.fn(async () => 23_977_224n),
      getBlock: vi.fn(async () => ({ timestamp: 1_790_993_698n })),
      readContract,
    } as unknown as CoreStateClient;
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher({ errors: [{ message: 'Morpho unavailable' }] }),
      now,
      rpcClient,
    );

    expect(snapshot.source).toBe('ARC_MAINNET_RPC');
    expect(snapshot.status).toBe('PARTIAL');
    expect(snapshot.identityVerified).toBe(true);
    expect(snapshot.freshness.status).toBe('CURRENT');
    expect(snapshot.vault.totalAssets).toMatchObject({
      source: 'ARC_MAINNET_RPC',
      availability: 'AVAILABLE',
      value: '2500000',
    });
    expect(snapshot.vault.availableLiquidity).toMatchObject({
      source: 'ARC_MAINNET_RPC',
      availability: 'AVAILABLE',
      value: '200000',
    });
    expect(snapshot.vault.depositAvailability.value).toBe('300000');
    expect(snapshot.vault.apy.availability).toBe('UNAVAILABLE');
    expect(snapshot.underlyingMarket.utilizationBps.availability).toBe('UNAVAILABLE');
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: ARC_MAINNET_STEAKHOUSE_VAULT,
      functionName: 'maxWithdraw',
      args: [ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress],
      blockNumber: 23_977_224n,
    }));
  });

  it('combines Morpho analytics with independently verified Arc RPC vault facts', async () => {
    const rpcClient = {
      getChainId: vi.fn(async () => 5042),
      getBlockNumber: vi.fn(async () => 23_977_225n),
      getBlock: vi.fn(async () => ({ timestamp: 1_790_993_699n })),
      readContract: vi.fn(async ({ functionName }: { readonly functionName: string }) => {
        switch (functionName) {
          case 'asset': return ARC_MAINNET_MORPHO_ASSET;
          case 'totalAssets': return 2_588_945_063_084n;
          case 'totalSupply': return 2_588_881_384_990_533_466_041_473n;
          case 'maxWithdraw': return 2_480_854_053_334n;
          case 'maxDeposit': return 3_000_000n;
          default: throw new Error(`Unexpected ERC-4626 read ${functionName}`);
        }
      }),
    } as unknown as CoreStateClient;
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(),
      now,
      rpcClient,
    );

    expect(snapshot.source).toBe('MULTIPLE_VERIFIED_SOURCES');
    expect(snapshot.vault.apy.source).toBe('MORPHO_GRAPHQL');
    expect(snapshot.vault.totalAssets.source).toBe('MORPHO_GRAPHQL');
    expect(snapshot.underlyingMarket.utilizationBps.source).toBe('MORPHO_GRAPHQL');
    expect(snapshot.freshness.sourceHeadBlockNumber).toBe('23977224');
    expect(snapshot.vault.depositAvailability).toMatchObject({
      source: 'ARC_MAINNET_RPC',
      value: '3000000',
    });
  });

  it('parses real Morpho fields for the exact Arc vault and linked market', async () => {
    const fetcher = createFetcher();
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(createAdminProjection(), fetcher, now);

    expect(snapshot.status).toBe('PARTIAL');
    expect(snapshot.identityVerified).toBe(true);
    expect(snapshot.chainId).toBe(5042);
    expect(snapshot.vaultAddress).toBe(ARC_MAINNET_STEAKHOUSE_VAULT);
    expect(snapshot.assetAddress).toBe(ARC_MAINNET_MORPHO_ASSET);
    expect(snapshot.protocolId).toBe(ARC_MAINNET_STEAKHOUSE_PROTOCOL_ID);
    expect(snapshot.freshness.status).toBe('CURRENT');
    expect(snapshot.freshness.ageSeconds).toBe(11);
    expect(snapshot.freshness.maximumAgeSeconds).toBe(MARKET_SNAPSHOT_MAX_AGE_SECONDS);
    expect(snapshot.freshness.blockNumber).toBe('23977224');
    expect(snapshot.freshness.sourceHeadBlockNumber).toBe('23977224');
    expect(snapshot.vault.totalAssets).toMatchObject({ source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '2588945063084' });
    expect(snapshot.vault.availableLiquidity).toMatchObject({ source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '2480854053334' });
    expect(snapshot.vault.apy).toMatchObject({ source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0.0003576588314253735', unit: 'RATIO' });
    expect(snapshot.underlyingMarket.marketId?.value).toBe('0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d');
    expect(snapshot.underlyingMarket.liquidity.value).toBe('2982810');
    expect(snapshot.underlyingMarket.utilizationBps.value).toBe(10_000);
    expect(snapshot.underlyingMarket.lltv.value).toBe('860000000000000000');
    expect(snapshot.underlyingMarket.oracleStatus.value).toBe('ChainlinkOracleV2 at 0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab');
    expect(snapshot.underlyingMarket.badDebtStatus.value).toContain('no bad debt');
    expect(snapshot.vault.warnings).toMatchObject({ availability: 'AVAILABLE', value: [] });
    expect(snapshot.vault.depositGateStatus.value).toContain('abdicated=true');
    expect(snapshot.vault.timelock.value).toContain('setSendAssetsGate');
    expect(snapshot.underlyingMarket.warnings).toMatchObject({ availability: 'AVAILABLE', value: [] });
    expect(snapshot.vault.allocation.availability).toBe('UNAVAILABLE');
    expect(snapshot.underlyingMarket.liquidationRisk.availability).toBe('UNAVAILABLE');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('verifies the configured market target independently of Core strategy approval state', async () => {
    const adminProjection = createAdminProjection();
    const snapshot = await readVerifiedSteakhouseMarketSnapshot({
      ...adminProjection,
      strategy: {
        approved: { source: 'CORE', availability: 'UNAVAILABLE', value: null },
        enabled: { source: 'CORE', availability: 'UNAVAILABLE', value: null },
      },
    }, createFetcher(), now);

    expect(snapshot.status).toBe('PARTIAL');
    expect(snapshot.identityVerified).toBe(true);
    expect(snapshot.protocolId).toBe(ARC_MAINNET_STEAKHOUSE_PROTOCOL_ID);
    expect(snapshot.vault.totalAssets.availability).toBe('AVAILABLE');
  });

  it('does not query Morpho for an Admin projection on a different chain', async () => {
    const fetcher = createFetcher();
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      { ...createAdminProjection(), chainId: 1 } as unknown as AdminAiInput,
      fetcher,
      now,
    );

    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(snapshot.identityVerified).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong chain', { chainId: 1 }],
    ['wrong vault', { vaultAddress: '0x3333333333333333333333333333333333333333' }],
    ['wrong asset', { assetAddress: '0x4444444444444444444444444444444444444444' }],
    ['wrong asset decimals', { assetDecimals: 18 }],
  ])('rejects a %s response identity', async (_label, overrides) => {
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse(overrides)),
      now,
    );
    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(snapshot.identityVerified).toBe(false);
    expect(snapshot.vault.totalAssets.value).toBeNull();
  });

  it('rejects an underlying Morpho market with a mismatched loan asset', async () => {
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse({ marketLoanAssetAddress: '0x1111111111111111111111111111111111111111' })),
      now,
    );

    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(snapshot.unavailableData.join(' ')).toContain('Underlying market loan asset');
  });

  it('keeps current required market data usable when supplemental risk fields are unavailable', async () => {
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse({ unavailableSupplementalFields: true })),
      now,
    );

    expect(snapshot.status).toBe('PARTIAL');
    expect(snapshot.freshness.status).toBe('CURRENT');
    expect(snapshot.vault.totalAssets.availability).toBe('AVAILABLE');
    expect(snapshot.vault.availableLiquidity.availability).toBe('AVAILABLE');
    expect(snapshot.vault.apy.availability).toBe('AVAILABLE');
    expect(snapshot.underlyingMarket.liquidity.availability).toBe('AVAILABLE');
    expect(snapshot.underlyingMarket.utilizationBps.availability).toBe('AVAILABLE');
    expect(snapshot.vault.netApy.availability).toBe('UNAVAILABLE');
    expect(snapshot.vault.warnings.availability).toBe('UNAVAILABLE');
    expect(snapshot.vault.timelock.availability).toBe('UNAVAILABLE');
    expect(snapshot.underlyingMarket.lltv.availability).toBe('UNAVAILABLE');
    expect(snapshot.underlyingMarket.oracleStatus.availability).toBe('UNAVAILABLE');
    expect(snapshot.underlyingMarket.badDebtStatus.availability).toBe('UNAVAILABLE');
    expect(snapshot.unavailableData.join(' ')).toContain('Underlying market LLTV is missing');
  });

  it('rejects a stale Morpho API head and inconsistent future market state', async () => {
    const staleHead = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse({ headTimestamp: String(Math.floor(now.getTime() / 1000) - 601) })),
      now,
    );
    const futureMarketState = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse({ marketTimestamp: String(Math.floor(now.getTime() / 1000) + 1) })),
      now,
    );
    expect(staleHead.freshness.status).toBe('STALE');
    expect(futureMarketState.status).toBe('UNAVAILABLE');
  });

  it.each([
    ['total assets', { totalAssets: null }],
    ['available liquidity', { liquidity: null }],
    ['APY', { apy: null }],
    ['utilization', { utilization: null }],
  ])('fails closed for missing %s without substituting zero', async (_label, overrides) => {
    const snapshot = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse(overrides)),
      now,
    );
    expect(snapshot.status).toBe('UNAVAILABLE');
    expect(snapshot.unavailableData.join(' ')).toMatch(new RegExp(_label, 'i'));
    expect(snapshot.vault.totalAssets.value).toBeNull();
    expect(snapshot.vault.availableLiquidity.value).toBeNull();
    expect(snapshot.vault.apy.value).toBeNull();
    expect(snapshot.underlyingMarket.utilizationBps.value).toBeNull();
  });

  it('fails closed for malformed numerics and GraphQL errors', async () => {
    const malformed = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher(createMorphoResponse({ totalAssets: 'not-a-number' })),
      now,
    );
    const graphqlError = await readVerifiedSteakhouseMarketSnapshot(
      createAdminProjection(),
      createFetcher({ errors: [{ message: 'Unavailable' }] }),
      now,
    );
    expect(malformed.status).toBe('UNAVAILABLE');
    expect(malformed.vault.totalAssets.value).toBeNull();
    expect(graphqlError.status).toBe('UNAVAILABLE');
  });
});
