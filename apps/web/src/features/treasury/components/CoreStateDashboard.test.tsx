import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BucketConfigurationPanel } from './BucketConfigurationPanel';
import { CoreStateDashboard } from './CoreStateDashboard';
import { TreasuryAllocationOverview } from './TreasuryAllocationOverview';
import { TreasuryBalanceCards } from './TreasuryBalanceCards';
import type { TreasuryStrategyState } from '../hooks/useTreasuryStrategyState';
import { isAuthorizedTreasuryAdminProjection } from '../hooks/useTreasurySummary';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';

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
  totalDeployed: 500_000n,
  totalManagedAssets: 1_500_000n,
  approvedProtocolCount: 1n,
  approvedAssetCount: 1n,
  approvedStrategyCount: 1n,
  minimumLiquidReserve: 100_000n,
  minimumLiquidReserveBps: 1_000,
  maximumTotalDeployed: 900_000n,
  roles: { policyAdmin: false, timelockExecutor: false, automation: false, emergency: false },
};

const strategyState: TreasuryStrategyState = {
  strategyAddress: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86',
  strategyLabel: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86',
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

const userProjection: UserFinancialProjectionModel = {
  scope: 'USER',
  authenticatedWalletAddress: '0x0ebad7ecda409d72aacc529efd46077d1cf012be',
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

describe('CoreStateDashboard strategy state', () => {
  it('renders the authenticated user Core balance as 1.00 USDC', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={coreState}
        userProjection={userProjection}
        isLoading={false}
        error={null}
        strategyState={strategyState}
        strategyLoading={false}
        strategyError={null}
      />,
    );

    expect(markup).toContain('0.90 USDC');
    expect(markup).toContain('1.00 USDC');
    expect(markup).toContain('Your Treasury balance');
    expect(markup).toContain('+0.05 USDC');
    expect(markup).toContain('Immediately withdrawable from liquid USDC');
    expect(markup).toContain('0.40 USDC');
    expect(markup).toContain('Earning position');
    expect(markup).toContain('User-specific Steakhouse position data cannot currently be retrieved');
    expect(markup).not.toMatch(/accounting|shared strategy|Core state|valuation block|On-chain state/i);
    expect(markup).not.toContain('1.20 USDC');
    expect(markup).not.toContain('Funded');
    expect(markup).not.toContain('Total user liabilities');
    expect(markup).not.toContain('Valuation Current');
  });

  it('hides admin-only operational sections for the normal user view', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={coreState}
        userProjection={userProjection}
        isLoading={false}
        error={null}
        strategyState={strategyState}
        strategyLoading={false}
        strategyError={null}
        isAdminView={false}
      />,
    );

    expect(markup).toContain('Your balance');
    expect(markup).not.toContain('Public Operational Status');
    expect(markup).not.toContain('Treasury Liquidity');
    expect(markup).not.toContain('Strategy Exposure');
    expect(markup).not.toContain('Risk Policy & Roles');
    expect(markup).not.toContain('Total user liabilities');
  });

  it('shows paused immediate withdrawal as unavailable instead of numeric zero', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={null}
        userProjection={{
          ...userProjection,
          immediateWithdrawalLiquidity: {
            source: 'CORE', availability: 'UNAVAILABLE', status: 'PAUSED', unit: 'USDC_BASE_UNITS', value: null,
          },
        }}
        isLoading={false}
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
      />,
    );

    expect(markup).toContain('Withdrawals are temporarily unavailable.');
    expect(markup).toContain('Immediately withdrawable from liquid USDC');
  });

  it('keeps Treasury visible while wallet authentication is pending', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={null}
        userProjection={null}
        isLoading
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
        isConnected
        isAuthenticated={false}
        authenticationLoading
      />,
    );

    expect(markup).toContain('Your Treasury');
    expect(markup).not.toContain('Reading Core');
    expect(markup).not.toContain('On-chain state');
    expect(markup).toContain('Checking access to your Treasury information.');
    expect(markup).not.toContain('Total user liabilities');
  });

  it('shows unavailable user Treasury fields without substituting zero', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={null}
        userProjection={{ ...userProjection, userBalance: null, treasuryFinancialState: null }}
        isLoading={false}
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
        isConnected
        isAuthenticated
      />,
    );

    expect(markup).toContain('Your Treasury balance');
    expect(markup).toContain('—');
    expect(markup).not.toContain('Unavailable');
    expect(markup).not.toContain('Your Treasury balance</span><strong>0');
  });

  it('hides cached user Treasury data after authentication expires', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={null}
        userProjection={userProjection}
        isLoading={false}
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
        isConnected
        isAuthenticated={false}
      />,
    );

    expect(markup).toContain('Your Treasury information will appear after wallet sign-in is completed.');
    expect(markup).not.toContain('Your Treasury balance');
    expect(markup).not.toContain('1.00 USDC');
  });

  it('shows the admin-only operational sections when the admin view is active', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={coreState}
        userProjection={null}
        isLoading={false}
        error={null}
        strategyState={strategyState}
        strategyLoading={false}
        strategyError={null}
        isAdminView={true}
      />,
    );

    expect(markup).toContain('Strategy Exposure');
    expect(markup).toContain('Risk Policy');
    expect(markup).toContain('Roles');
    expect(markup).toContain('Approved protocols');
    expect(markup).toContain('Total deployed');
  });

  it('renders the existing server-authorized Admin projection only in Admin view', () => {
    const walletAddress = '0x1111111111111111111111111111111111111111';
    const adminProjection = {
      scope: 'ADMIN',
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      coreAddress: '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7',
      authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
      treasury: {
        totalUserLiabilities: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '1000000' },
        liquidUSDC: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '400000' },
        requiredLiquidReserve: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', value: null },
        availableLiquidity: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '300000' },
        totalDeployed: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '600000' },
        totalManagedAssets: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '1000000' },
        paused: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', value: false },
        blockNumber: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', value: '500' },
      },
      approvals: {},
      riskPolicy: {},
      bucketPolicy: {},
      strategy: {
        adapterAddress: { source: 'LOCAL_CONFIGURATION', availability: 'AVAILABLE', unit: 'ADDRESS', value: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86' },
        protocolId: { source: 'CORE', availability: 'AVAILABLE', unit: 'BYTES32', value: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450' },
        assetAddress: { source: 'CORE', availability: 'AVAILABLE', unit: 'ADDRESS', value: '0x3600000000000000000000000000000000000000' },
        principal: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '100000' },
        currentValue: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '110000' },
        shares: { source: 'CORE', availability: 'AVAILABLE', unit: 'SHARES', value: '90000' },
        approved: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', value: true },
        enabled: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', value: true },
        realizedYield: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '10000' },
        totalPnl: { source: 'API_DERIVED', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: '-100000' },
        valuationBlock: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', value: '500' },
      },
      strategies: {
        availability: 'PARTIAL',
        data: { registry: { availability: 'UNAVAILABLE', data: null } },
        reason: 'The complete strategy registry is unavailable.',
      },
      exposure: { availability: 'UNAVAILABLE', data: null },
    };
    const adminMarkup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={null}
        adminProjection={adminProjection}
        isLoading={false}
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
        isAdminView
      />,
    );
    const userMarkup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={null}
        adminProjection={adminProjection}
        userProjection={userProjection}
        isLoading={false}
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
      />,
    );

    expect(isAuthorizedTreasuryAdminProjection(adminProjection, walletAddress, adminProjection.coreAddress)).toBe(true);
    expect(isAuthorizedTreasuryAdminProjection(adminProjection, '0x2222222222222222222222222222222222222222', adminProjection.coreAddress)).toBe(false);
    expect(isAuthorizedTreasuryAdminProjection({ ...adminProjection, coreAddress: '0x2222222222222222222222222222222222222222' }, walletAddress, adminProjection.coreAddress)).toBe(false);
    expect(isAuthorizedTreasuryAdminProjection({ ...adminProjection, authorization: { policyAdmin: { source: 'API_DERIVED', availability: 'AVAILABLE', value: true } } }, walletAddress, adminProjection.coreAddress)).toBe(false);
    expect(adminMarkup).toContain('Total user liabilities');
    expect(adminMarkup).toContain('System-wide Configured Strategy (partial)');
    expect(adminMarkup).toContain('Strategy address');
    expect(adminMarkup).toContain('1.00 USDC');
    expect(adminMarkup).toContain('-0.10 USDC');
    expect(adminMarkup).toContain('Complete strategy registry');
    expect(adminMarkup).toContain('The complete strategy registry is unavailable.');
    expect(adminMarkup).toContain('Unavailable');
    expect(userMarkup).not.toContain('Total user liabilities');
    expect(userMarkup).not.toContain('600000');
    expect(userMarkup).not.toContain('System-wide Configured Strategy');
    expect(userMarkup).not.toContain('Strategy address');
    expect(userMarkup).not.toContain('0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86');
    expect(userMarkup).not.toContain('0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450');
  });

  it('removes treasury-wide balances from the normal user render path', () => {
    const markup = renderToStaticMarkup(
      <TreasuryBalanceCards
        balances={{
          total: { state: 'synced', rawAmount: 2_000_000n, formattedAmount: '2.00', symbol: 'USDC', decimals: 6, message: 'ok' },
          available: { state: 'synced', rawAmount: 1_500_000n, formattedAmount: '1.50', symbol: 'USDC', decimals: 6, message: 'ok' },
          allocated: { state: 'synced', rawAmount: 500_000n, formattedAmount: '0.50', symbol: 'USDC', decimals: 6, message: 'ok' },
        }}
        walletBalance={{ state: 'synced', rawAmount: 250_000n, formattedAmount: '0.25', symbol: 'USDC', decimals: 6, message: 'ok' }}
        onOpenDeposit={() => undefined}
        isDepositEnabled={true}
        onOpenWithdraw={() => undefined}
        isWithdrawEnabled={true}
      />,
    );

    expect(markup).toContain('Wallet USDC Balance');
    expect(markup).not.toContain('Total Treasury Balance');
    expect(markup).not.toContain('Available Balance');
    expect(markup).not.toContain('Allocated Balance');
  });

  it('shows a neutral wallet balance message instead of a technical read error', () => {
    const markup = renderToStaticMarkup(
      <TreasuryBalanceCards
        balances={{
          total: { state: 'pending_integration', rawAmount: null, formattedAmount: null, symbol: 'USDC', decimals: 6, message: 'internal' },
          available: { state: 'pending_integration', rawAmount: null, formattedAmount: null, symbol: 'USDC', decimals: 6, message: 'internal' },
          allocated: { state: 'pending_integration', rawAmount: null, formattedAmount: null, symbol: 'USDC', decimals: 6, message: 'internal' },
        }}
        walletBalance={{
          state: 'error',
          rawAmount: null,
          formattedAmount: null,
          symbol: 'USDC',
          decimals: 6,
          message: 'RPC Error: Core contract call reverted.',
        }}
        onOpenDeposit={() => undefined}
        isDepositEnabled={false}
        onOpenWithdraw={() => undefined}
        isWithdrawEnabled={false}
      />,
    );

    expect(markup).toContain('Balance temporarily unavailable. Try refreshing.');
    expect(markup).not.toMatch(/RPC Error|Core contract call|6 Decimals/i);
  });

  it('does not render local allocation defaults in the normal user view', () => {
    const markup = renderToStaticMarkup(
      <TreasuryAllocationOverview
        allocations={{
          buckets: [{
            id: 'yield_strategy',
            name: 'Yield Strategy Buffer',
            category: 'yield_strategy',
            targetAmount: null,
            targetPercentageBps: 10_000n,
            currentAmount: null,
            status: 'unallocated',
            description: 'Local policy draft.',
            targetStage: 'Unavailable on current Core',
          }],
          totalAllocatedPercentageBps: 10_000n,
          statusMessage: 'Local allocation preview.',
        } as any}
        canViewAdmin={false}
      />,
    );
    expect(markup).toBe('');
  });

  it('renders stale valuation status instead of presenting it as current', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={coreState}
        userProjection={null}
        isLoading={false}
        error={null}
        strategyState={{ ...strategyState, valuationStatus: 2, valuationStatusLabel: 'stale' }}
        strategyLoading={false}
        strategyError={null}
        isAdminView={true}
      />,
    );

    expect(markup).toContain('stale');
  });

  it('hides raw strategy addresses and admin-only operational details from the normal user view', () => {
    const markup = renderToStaticMarkup(
      <CoreStateDashboard
        coreState={coreState}
        userProjection={userProjection}
        isLoading={false}
        error={null}
        strategyState={strategyState}
        strategyLoading={false}
        strategyError={null}
        isAdminView={false}
      />,
    );

    expect(markup).not.toContain('0xprotocol');
    expect(markup).not.toContain('0x3600000000000000000000000000000000000000');
    expect(markup).not.toContain('Approved protocols');
    expect(markup).not.toContain('Absolute cap');
    expect(markup).not.toContain('Relative cap');
    expect(markup).not.toContain('Liquid USDC');
    expect(markup).not.toContain('Required liquid reserve');
    expect(markup).not.toContain('Available liquidity');
    expect(markup).not.toContain('Strategy status');
    expect(markup).toContain('Immediately withdrawable from liquid USDC');
  });

  it('shows the bucket configuration panel for admins and disables actions on the current live Core', () => {
    const markup = renderToStaticMarkup(
      <BucketConfigurationPanel
        draftPolicy={{
          minimumLiquidReserve: 100_000n,
          surplusSweepThreshold: 150_000n,
          dailyOutflowCap: 200_000n,
          maximumSingleWithdrawal: 50_000n,
          automatedSweepEnabled: false,
          allocations: {
            operational_reserve: 4_000n,
            yield_strategy: 3_000n,
            swap_liquidity: 2_000n,
            automation_agent: 1_000n,
          },
        }}
        currentPolicy={null}
        scheduledPolicy={null}
        canViewAdmin={true}
        currentCoreSupported={false}
      />,
    );

    expect(markup).toContain('Bucket Configuration');
    expect(markup).toContain('Current deployed Core');
    expect(markup).toContain('Unavailable on current Core');
    expect(markup).toContain('Action disabled on current live Core');
  });

  it('does not present missing or incomplete Admin bucket choices as zero allocations', () => {
    const markup = renderToStaticMarkup(
      <BucketConfigurationPanel
        draftPolicy={{
          minimumLiquidReserve: 0n,
          surplusSweepThreshold: 0n,
          dailyOutflowCap: 0n,
          maximumSingleWithdrawal: 0n,
          automatedSweepEnabled: false,
          allocations: {
            operational_reserve: 0n,
            yield_strategy: 0n,
            swap_liquidity: 0n,
            automation_agent: 0n,
          },
        }}
        currentPolicy={null}
        canViewAdmin
      />,
    );
    expect(markup).toContain('>Draft</div>');
    expect(markup).toContain('Unavailable / no complete draft');
  });

  it('shows the verified pending bucket policy and ETA and only enables execution for the executor', () => {
    const props = {
      draftPolicy: null,
      currentPolicy: null,
      scheduledPolicy: {
        liquidOperationalReserveBps: 3_000,
        yieldStrategyBufferBps: 5_000,
        sweepLiquidityBufferBps: 1_000,
        automationAgentPoolBps: 1_000,
      },
      scheduledEta: 123_456n,
      scheduledOperationId: `0x${'12'.repeat(32)}`,
      currentCoreSupported: true,
      onExecuteBucketPolicy: async () => undefined,
    };
    const executorMarkup = renderToStaticMarkup(
      <BucketConfigurationPanel {...props} canViewAdmin={false} canExecuteBucketPolicy />,
    );
    expect(executorMarkup).toContain('3000 BPS');
    expect(executorMarkup).toContain('ETA 123456');
    expect(executorMarkup).toContain(`0x${'12'.repeat(32)}`);
    expect(executorMarkup).toContain('Execute scheduled bucket policy');

    const adminMarkup = renderToStaticMarkup(
      <BucketConfigurationPanel {...props} canViewAdmin canExecuteBucketPolicy={false} />,
    );
    expect(adminMarkup).toContain('ETA 123456');
    expect(adminMarkup).not.toContain('Execute scheduled bucket policy');

    const unauthorizedMarkup = renderToStaticMarkup(
      <BucketConfigurationPanel {...props} canViewAdmin={false} canExecuteBucketPolicy={false} />,
    );
    expect(unauthorizedMarkup).toBe('');
  });

  it('shows explicit no-pending status to an executor with no discovered Bucket Policy', () => {
    const markup = renderToStaticMarkup(
      <BucketConfigurationPanel
        draftPolicy={null}
        currentPolicy={null}
        canViewAdmin={false}
        canExecuteBucketPolicy
        pendingDiscoveryLoading={false}
      />,
    );
    expect(markup).toContain('No pending Bucket Policy operation was found');
  });

  it('surfaces an incomplete history error even when a recently verified Bucket Policy is present', () => {
    const markup = renderToStaticMarkup(
      <BucketConfigurationPanel
        draftPolicy={null}
        currentPolicy={null}
        scheduledPolicy={{
          liquidOperationalReserveBps: 3_000,
          yieldStrategyBufferBps: 5_000,
          sweepLiquidityBufferBps: 1_000,
          automationAgentPoolBps: 1_000,
        }}
        canViewAdmin
        canExecuteBucketPolicy
        pendingDiscoveryError={new Error('Historical event chunk failed.')}
      />,
    );

    expect(markup).toContain('Historical event chunk failed.');
    expect(markup).toContain('Pending Bucket Policy status is unavailable');
  });
});
