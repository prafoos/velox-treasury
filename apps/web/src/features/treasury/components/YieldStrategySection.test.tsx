import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { YieldStrategySection } from './YieldStrategySection';
import type { TreasuryStrategyState } from '../hooks/useTreasuryStrategyState';
import type { TreasuryBucketTargetState } from '../hooks/useTreasuryBucketTargets';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';

const strategyState: TreasuryStrategyState = {
  strategyAddress: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86',
  strategyLabel: 'Steakhouse Prime USDC',
  protocolLabel: 'Steakhouse Prime USDC',
  protocol: '0xprotocol',
  asset: '0x3600000000000000000000000000000000000000',
  absoluteCap: 2_000_000n,
  relativeCapBps: 5_000,
  principal: 1_000_000n,
  shares: 900_000n,
  currentValue: 1_200_000n,
  realizedYield: 250_000n,
  realizedLoss: 50_000n,
  unrealizedYield: 200_000n,
  unrealizedLoss: 0n,
  feesAccrued: 5_000n,
  withdrawalShortfall: 10_000n,
  valuationStatus: 1,
  valuationStatusLabel: 'current',
  valuationBlock: 300n,
  valuationSource: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86',
  totalDeployed: 1_200_000n,
  approved: true,
  enabled: true,
};

const coreState = {
  paused: false,
  userBalance: 1_000_000n,
  userFinancialState: {
    principal: 900_000n,
    currentValue: 1_000_000n,
    unrealizedPnl: 50_000n,
    realizedPnl: 50_000n,
    totalPnl: 100_000n,
    immediatelyWithdrawableValue: 400_000n,
  },
  totalUserLiabilities: 1_000_000n,
  liquidUSDC: 500_000n,
  requiredLiquidReserve: 100_000n,
  availableLiquidity: 400_000n,
  totalDeployed: 1_200_000n,
  totalManagedAssets: 1_500_000n,
  approvedProtocolCount: 1n,
  approvedAssetCount: 1n,
  approvedStrategyCount: 1n,
  minimumLiquidReserve: 100_000n,
  minimumLiquidReserveBps: 1_000,
  maximumTotalDeployed: 900_000n,
  bucketTargets: [400_000n, 300_000n, 200_000n, 100_000n],
  yieldStrategyBufferCapacity: 300_000n,
  liquidBucketClassifications: [200_000n, 150_000n, 50_000n],
  blockNumber: 321n,
  roles: { policyAdmin: false, timelockExecutor: false, automation: false, emergency: false },
};

const userProjection: UserFinancialProjectionModel = {
  scope: 'USER',
  authenticatedWalletAddress: '0x1111111111111111111111111111111111111111',
  chainId: 5042,
  walletUSDC: 25_000n,
  userBalance: 1_000_000n,
  treasuryFinancialState: {
    principal: 900_000n,
    currentValue: 1_000_000n,
    unrealizedPnl: 50_000n,
    realizedPnl: 50_000n,
    totalPnl: 100_000n,
  },
  publicOperationalStatus: { paused: false, blockNumber: 321n },
  immediateWithdrawalLiquidity: { source: 'CORE', availability: 'AVAILABLE', status: 'CONSTRAINED', unit: 'USDC_BASE_UNITS', value: 400_000n },
  fieldMetadata: {
    walletUSDC: { source: 'TOKEN_CONTRACT', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    userBalance: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    treasuryFinancialState: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    principal: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    currentValue: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    unrealizedPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    realizedPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    totalPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    immediateWithdrawalLiquidity: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    paused: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', zeroMeaning: 'NOT_APPLICABLE' },
    blockNumber: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', zeroMeaning: 'AUTHORITATIVE_ZERO' },
  },
};

const bucketTargets: TreasuryBucketTargetState = {
  liquidOperationalReserveBps: 5_000n,
  yieldStrategyBufferBps: 3_000n,
  sweepLiquidityBufferBps: 1_000n,
  automationAgentPoolBps: 1_000n,
  liquidOperationalReserve: 500_000n,
  yieldStrategyBuffer: 300_000n,
  sweepLiquidityBuffer: 100_000n,
  automationAgentPool: 100_000n,
  totalManagedAssets: 1_000_000n,
  totalDeployed: 0n,
  blockNumber: 321n,
};

describe('YieldStrategySection', () => {
  it('renders only user financial state and hides global bucket/strategy diagnostics', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={strategyState}
        coreState={null}
        userProjection={userProjection}
        bucketTargets={bucketTargets}
        canViewAdmin={false}
        strategyUnavailableReason="RPC position getter is unavailable."
        isAuthenticated
      />,
    );

    expect(markup).toContain('Yield / Earn');
    expect(markup).toContain('Current Value');
    expect(markup).toContain('Immediately Withdrawable');
    expect(markup).toContain('0.90 USDC');
    expect(markup).toContain('1.00 USDC');
    expect(markup).toContain('Earning position');
    expect(markup).toContain('User-specific Steakhouse position data cannot currently be retrieved');
    expect(markup).not.toContain('1.20 USDC');
    expect(markup).not.toContain('Approved / Enabled');
    expect(markup).not.toContain('Funded');
    expect(markup).not.toContain('Valuation Current');
    expect(markup).not.toContain('Treasury Bucket Targets');
    expect(markup).not.toContain('Yield Strategy Buffer');
    expect(markup).not.toContain('Core-wide');
    expect(markup).not.toContain('50%');
    expect(markup).not.toContain('1,200,000');
    expect(markup).not.toContain('900,000');
    expect(markup).toContain('0.05 USDC');
    expect(markup).not.toContain('APY');
    expect(markup).not.toContain('APR');
    expect(markup).not.toMatch(/shared strategy|historical charting|indexer|authoritative|core state/i);
  });

  it('shows global policy targets and actual deployment only in the authorized Admin view', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={userProjection}
        bucketTargets={bucketTargets}
        userStrategyPosition={{ status: 'NO_ACTIVE_POSITION' }}
        canViewAdmin
        isAuthenticated
      />,
    );

    expect(markup).toContain('Liquid Operational Reserve');
    expect(markup).toContain('50%');
    expect(markup).toContain('Yield Strategy Buffer');
    expect(markup).toContain('30%');
    expect(markup).toContain('Sweep Liquidity Buffer');
    expect(markup).toContain('10%');
    expect(markup).toContain('Automation / AI Agent Pool');
    expect(markup).toContain('Core-wide managed assets (all users)');
    expect(markup).toContain('Core-wide deployed to strategies');
    expect(markup).toContain('global Core policy targets/accounting classifications');
    expect(markup).toContain('They are not your personal balance');
    expect(markup).toContain('Core-wide snapshot block: 321');
    expect(markup).not.toContain('No active Steakhouse position exists for this wallet.');
  });

  it('shows live bucket reads as loading or unavailable without inventing zero values', () => {
    const loading = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={userProjection}
        bucketTargetsLoading
        canViewAdmin
      />,
    );
    expect(loading).toContain('Loading live Core bucket targets');
    expect(loading).not.toContain('0.00 USDC');

    const retry = () => undefined;
    const failed = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={userProjection}
        bucketTargetsError={new Error('RPC unavailable')}
        onRetryBucketTargets={retry}
        canViewAdmin
      />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('RPC unavailable');
    expect(failed).toContain('>Retry</button>');
    expect(failed).not.toContain('0.00 USDC');
  });

  it('renders authoritative zero financial values without inventing P/L or withdrawable funds', () => {
    const zeroProjection: UserFinancialProjectionModel = {
      ...userProjection,
      userBalance: 0n,
      treasuryFinancialState: {
        principal: 0n,
        currentValue: 0n,
        unrealizedPnl: 0n,
        realizedPnl: 0n,
        totalPnl: 0n,
      },
      immediateWithdrawalLiquidity: {
        source: 'CORE',
        availability: 'AVAILABLE',
        status: 'AVAILABLE',
        unit: 'USDC_BASE_UNITS',
        value: 0n,
      },
    };
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={zeroProjection}
        bucketTargets={bucketTargets}
        canViewAdmin={false}
        isAuthenticated
      />,
    );

    expect(markup.match(/0\.00 USDC/g)).toHaveLength(6);
    expect(markup).not.toMatch(/[+-]0\.00 USDC/);
    expect(markup).toContain('No funds are currently available to withdraw.');
    expect(markup).toContain('>0.00 USDC</strong>');
    expect(markup).not.toContain('Core-wide managed assets (all users)');
    expect(markup).not.toContain('Core-wide snapshot block');
    expect(markup).not.toMatch(/total deployed|valuation stale|shares|fees accrued|strategy diagnostics/i);
  });

  it('does not interpret a zero-valued shared strategy position as a user zero position', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={{ ...strategyState, principal: 0n, currentValue: 0n, shares: 0n, approved: true, enabled: true }}
        coreState={null}
        userProjection={userProjection}
        canViewAdmin={false}
        isAuthenticated
      />,
    );

    expect(markup).not.toContain('Approved / Enabled');
    expect(markup).not.toContain('Not Funded');
    expect(markup).not.toContain('Earning Yield');
    expect(markup).toContain('Earning position');
    expect(markup).toContain('User-specific Steakhouse position data cannot currently be retrieved');
    expect(markup).not.toContain('User strategy position');
  });

  it('renders unavailable immediate liquidity without substituting zero', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={{
          ...userProjection,
          immediateWithdrawalLiquidity: {
            source: 'UNAVAILABLE', availability: 'UNAVAILABLE', status: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', value: null,
          },
        }}
        canViewAdmin={false}
      />,
    );
    const immediateValue = markup.match(/<span class="vx-card-label">Immediately Withdrawable<\/span><strong>(.*?)<\/strong>/)?.[1];

    expect(immediateValue).toBe('—');
    expect(markup).toContain('Not available yet');
  });

  it('shows a loading state for user financial metrics while the projection is loading', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={null}
        userProjectionLoading
        canViewAdmin={false}
        isAuthenticated
      />,
    );

    expect(markup).toContain('Loading your Treasury financial data');
    expect(markup.match(/Loading…/g)).toHaveLength(5);
    expect(markup).not.toContain('0.00 USDC');
  });

  it('explains why user financial metrics are unavailable before wallet authentication', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={null}
        canViewAdmin={false}
      />,
    );

    expect(markup).toContain('User-specific Treasury financial data is unavailable until wallet sign-in is verified.');
    expect(markup).not.toContain('0.00 USDC');
  });

  it('surfaces user financial projection errors and offers retry without substituting zero', () => {
    const retry = () => undefined;
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={null}
        userProjectionError={new Error('User financial state request failed.')}
        onRetryUserProjection={retry}
        canViewAdmin={false}
        isAuthenticated
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Your Treasury financial data is temporarily unavailable.');
    expect(markup).toContain('User financial state request failed.');
    expect(markup).toContain('>Retry</button>');
    expect(markup.match(/Unavailable/g)).toHaveLength(5);
    expect(markup).not.toContain('0.00 USDC');
  });

  it('does not expose system stale-valuation diagnostics as user strategy state', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection
        strategyState={{ ...strategyState, valuationStatusLabel: 'stale' }}
        coreState={null}
        userProjection={userProjection}
        canViewAdmin={false}
      />,
    );

    expect(markup).toContain('Immediately Withdrawable');
    expect(markup).toContain('0.40 USDC');
    expect(markup).not.toContain('Configured strategy valuation is stale');
    expect(markup).toContain('Sign in to view your Steakhouse position.');
    expect(markup).not.toMatch(/valuation is stale|strategy-backed funds|accounting|shared strategy/i);
    expect(markup).not.toContain('1.20 USDC');
  });

  it('hides admin yield details for non-admin users', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection strategyState={strategyState} coreState={null} userProjection={userProjection} canViewAdmin={false} />,
    );

    expect(markup).not.toContain('Admin Yield View');
    expect(markup).not.toContain('Current Strategy Exposure');
    expect(markup).not.toContain('Strategy Details');
    expect(markup).not.toContain('Buffer capacity');
    expect(markup).not.toContain('Currently used / deployed');
    expect(markup).not.toContain('Remaining capacity');
    expect(markup).not.toContain('Policy buffer BPS');
    expect(markup).not.toContain('Liquid USDC');
    expect(markup).not.toContain('Required liquid reserve');
    expect(markup).not.toContain('Available liquidity');
  });

  it('shows admin-only financial and exposure details when authorized', () => {
    const markup = renderToStaticMarkup(
      <YieldStrategySection strategyState={strategyState} coreState={coreState} userProjection={null} canViewAdmin />,
    );

    expect(markup).toContain('Admin Yield View');
    expect(markup).toContain('Current Strategy Exposure');
    expect(markup).toContain('Allowed Strategy Capacity');
    expect(markup).toContain('Valuation Source');
    expect(markup).toContain('Historical charting requires authoritative time-series API/indexer support');
  });
});
