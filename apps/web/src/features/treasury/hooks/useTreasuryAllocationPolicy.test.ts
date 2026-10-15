import { beforeEach, describe, expect, it, vi } from 'vitest';

interface AllocationPolicy {
  readonly operationalReserveBps: bigint;
  readonly yieldStrategyBps: bigint;
  readonly liquidityAvailabilityBps: bigint;
  readonly automationAndAiBps: bigint;
}

interface AllocationPolicyQueryOptions {
  readonly enabled: boolean;
  readonly staleTime: number;
  readonly refetchInterval: number;
  readonly retry: boolean;
  readonly queryFn: () => Promise<AllocationPolicy>;
}

interface AllocationPolicyQueryResult {
  readonly data?: AllocationPolicy;
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly refetch: () => Promise<unknown>;
}

const mocks = vi.hoisted(() => ({
  coreAddress: '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7',
  publicClient: {
    getChainId: vi.fn(),
    readContract: vi.fn(),
  },
  queryOptions: null as AllocationPolicyQueryOptions | null,
  queryResult: {} as AllocationPolicyQueryResult,
}));

vi.mock('../../../contracts/treasury', () => ({
  APPROVED_ARC_MAINNET_CORE_ADDRESS: mocks.coreAddress,
  getArcMainnetTreasuryAddress: () => mocks.coreAddress,
  veloxTreasuryAbi: [],
}));

vi.mock('../services/arcMainnetPublicClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/arcMainnetPublicClient')>();
  return {
    ...actual,
    arcMainnetReadClient: mocks.publicClient,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: AllocationPolicyQueryOptions) => {
    mocks.queryOptions = options;
    return mocks.queryResult;
  },
}));

import { useTreasuryAllocationPolicy } from './useTreasuryAllocationPolicy';

describe('useTreasuryAllocationPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publicClient.getChainId.mockResolvedValue(5042);
    mocks.publicClient.readContract.mockResolvedValue({
      liquidOperationalReserveBps: 4_500,
      yieldStrategyBufferBps: 2_500,
      sweepLiquidityBufferBps: 2_000,
      automationAgentPoolBps: 1_000,
    });
    mocks.queryOptions = null;
    mocks.queryResult = {
      isLoading: true,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('reads only the active allocation getter and converts the returned values to BPS integers', async () => {
    useTreasuryAllocationPolicy(true);
    const options = mocks.queryOptions;
    if (!options) throw new Error('Allocation query was not configured.');

    const policy = await options.queryFn();

    expect(policy).toEqual({
      operationalReserveBps: 4_500n,
      yieldStrategyBps: 2_500n,
      liquidityAvailabilityBps: 2_000n,
      automationAndAiBps: 1_000n,
    });
    expect(mocks.publicClient.readContract).toHaveBeenCalledTimes(1);
    expect(mocks.publicClient.readContract.mock.calls[0]?.[0]).toMatchObject({
      functionName: 'bucketPolicy',
    });
  });

  it('polls periodically and leaves the query disabled outside the supported network', () => {
    useTreasuryAllocationPolicy(false);

    expect(mocks.queryOptions).toMatchObject({
      enabled: false,
      staleTime: 10_000,
      refetchInterval: 30_000,
      retry: false,
    });
    expect(mocks.publicClient.readContract).not.toHaveBeenCalled();
  });

  it('does not return stale policy values when the latest read has failed', () => {
    const error = new Error('RPC read failed.');
    mocks.queryResult = {
      data: {
        operationalReserveBps: 5_000n,
        yieldStrategyBps: 3_000n,
        liquidityAvailabilityBps: 1_000n,
        automationAndAiBps: 1_000n,
      },
      isLoading: false,
      error,
      refetch: vi.fn().mockResolvedValue(undefined),
    };

    expect(useTreasuryAllocationPolicy(true)).toMatchObject({
      policy: null,
      error,
    });
  });

  it('rejects malformed allocation values rather than displaying them', async () => {
    mocks.publicClient.readContract.mockResolvedValue({
      liquidOperationalReserveBps: 5_000,
      yieldStrategyBufferBps: 3_000,
      sweepLiquidityBufferBps: 1_000,
      automationAgentPoolBps: 999,
    });
    useTreasuryAllocationPolicy(true);
    const options = mocks.queryOptions;
    if (!options) throw new Error('Allocation query was not configured.');

    await expect(options.queryFn()).rejects.toThrow('active allocation values returned by Core are invalid');
  });

  it('verifies chain ID 5042 before reading the active policy', async () => {
    useTreasuryAllocationPolicy(true);
    const options = mocks.queryOptions;
    if (!options) throw new Error('Allocation query was not configured.');

    await options.queryFn();

    expect(mocks.publicClient.getChainId).toHaveBeenCalledOnce();
    expect(mocks.publicClient.readContract).toHaveBeenCalledOnce();
  });

  it('fails closed when RPC chain ID verification fails', async () => {
    mocks.publicClient.getChainId.mockRejectedValue(new Error('RPC offline'));
    useTreasuryAllocationPolicy(true);
    const options = mocks.queryOptions;
    if (!options) throw new Error('Allocation query was not configured.');

    await expect(options.queryFn()).rejects.toThrow('Arc Mainnet RPC chain ID could not be verified');
    expect(mocks.publicClient.readContract).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC returns a chain ID other than 5042', async () => {
    mocks.publicClient.getChainId.mockResolvedValue(1);
    useTreasuryAllocationPolicy(true);
    const options = mocks.queryOptions;
    if (!options) throw new Error('Allocation query was not configured.');

    await expect(options.queryFn()).rejects.toThrow('Arc Mainnet (Chain ID 5042)');
    expect(mocks.publicClient.readContract).not.toHaveBeenCalled();
  });
});
