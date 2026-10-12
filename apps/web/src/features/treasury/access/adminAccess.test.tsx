import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CoreStateDashboard } from '../components/CoreStateDashboard';
import { EmergencyRiskControls } from '../components/EmergencyRiskControls';
import { TreasuryRulesSection } from '../components/TreasuryRulesSection';
import { canViewAdminPanel } from './adminAccess';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';

const userProjection: UserFinancialProjectionModel = {
  scope: 'USER',
  authenticatedWalletAddress: '0x1111111111111111111111111111111111111111',
  chainId: 5042,
  walletUSDC: null,
  userBalance: 10_000n,
  treasuryFinancialState: {
    principal: 10_000n,
    currentValue: 10_000n,
    unrealizedPnl: 0n,
    realizedPnl: 0n,
    totalPnl: 0n,
  },
  publicOperationalStatus: { paused: false, blockNumber: null },
  immediateWithdrawalLiquidity: { source: 'CORE', availability: 'AVAILABLE', status: 'AVAILABLE', unit: 'USDC_BASE_UNITS', value: 10_000n },
  fieldMetadata: {
    walletUSDC: { source: 'TOKEN_CONTRACT', availability: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'UNAVAILABLE' },
    userBalance: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    treasuryFinancialState: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    principal: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    currentValue: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    unrealizedPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    realizedPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    totalPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    immediateWithdrawalLiquidity: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    paused: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', zeroMeaning: 'NOT_APPLICABLE' },
    blockNumber: { source: 'CORE', availability: 'UNAVAILABLE', unit: 'BLOCK', zeroMeaning: 'UNAVAILABLE' },
  },
};

const sampleRules = [
  {
    id: 'minimumLiquidReserve',
    name: 'Minimum liquid reserve',
    description: 'Minimum liquid reserve before operational actions.',
    thresholdDisplay: '10 USDC',
    executionMode: 'manual_approval',
    implementationStage: 'Step 4',
  },
] as const;

const sampleEmergency = {
  status: 'nominal',
  statusNotice: 'No active emergency actions.',
  limits: [
    {
      id: 'outflow-cap',
      label: '24h Outflow Cap',
      configuredValue: '100 USDC',
      description: 'Maximum future outflow ceiling.',
      status: 'active_boundary',
    },
  ],
};

describe('admin panel visibility', () => {
  it('requires a connected Arc Mainnet policy-admin wallet', () => {
    expect(canViewAdminPanel(false, false, false)).toBe(false);
    expect(canViewAdminPanel(true, false, true)).toBe(false);
    expect(canViewAdminPanel(true, true, false)).toBe(false);
    expect(canViewAdminPanel(true, true, true)).toBe(true);
  });

  it('hides admin-only controls for non-admin wallets', () => {
    const rulesMarkup = renderToStaticMarkup(
      <TreasuryRulesSection
        rules={sampleRules as any}
        onOpenRules={() => undefined}
        hasOnChainPolicy={true}
        isTreasuryConfigured={true}
        canViewAdmin={false}
      />,
    );
    const emergencyMarkup = renderToStaticMarkup(
      <EmergencyRiskControls emergency={sampleEmergency as any} onOpenEmergency={() => undefined} canViewAdmin={false} />,
    );

    expect(rulesMarkup).not.toContain('Treasury Policy & Automation Rules');
    expect(rulesMarkup).not.toContain('Configure Rules');
    expect(emergencyMarkup).not.toContain('Emergency Controls');
  });

  it('shows admin-only controls for the authorized policy admin', () => {
    const rulesMarkup = renderToStaticMarkup(
      <TreasuryRulesSection
        rules={sampleRules as any}
        onOpenRules={() => undefined}
        hasOnChainPolicy={true}
        isTreasuryConfigured={true}
        canViewAdmin={true}
      />,
    );
    const emergencyMarkup = renderToStaticMarkup(
      <EmergencyRiskControls emergency={sampleEmergency as any} onOpenEmergency={() => undefined} canViewAdmin={true} />,
    );

    expect(rulesMarkup).toContain('Treasury Policy &amp; Automation Rules');
    expect(rulesMarkup).toContain('Configure Rules');
    expect(emergencyMarkup).toContain('Emergency Controls');
  });

  it('keeps the admin operational section hidden from non-admin users even when the core state is available', () => {
    const coreStateMarkup = renderToStaticMarkup(
      <CoreStateDashboard
        userProjection={userProjection}
        coreState={{
          paused: false,
          userBalance: 10_000n,
          userFinancialState: { principal: 10_000n, currentValue: 10_000n, unrealizedPnl: 0n, realizedPnl: 0n, totalPnl: 0n, immediatelyWithdrawableValue: 10_000n },
          totalUserLiabilities: 0n,
          liquidUSDC: 10_000n,
          requiredLiquidReserve: 0n,
          availableLiquidity: 10_000n,
          totalDeployed: 0n,
          totalManagedAssets: 10_000n,
          approvedProtocolCount: 0n,
          approvedAssetCount: 0n,
          approvedStrategyCount: 0n,
          minimumLiquidReserve: 0n,
          minimumLiquidReserveBps: 0,
          maximumTotalDeployed: 10_000n,
          roles: { policyAdmin: false, timelockExecutor: false, automation: false, emergency: false },
        }}
        isLoading={false}
        error={null}
        strategyState={null}
        strategyLoading={false}
        strategyError={null}
        isAdminView={false}
      />,
    );

    expect(coreStateMarkup).toContain('Your Treasury');
    expect(coreStateMarkup).toContain('Your Treasury balance');
    expect(coreStateMarkup).toContain('Your balance and available withdrawal information.');
    expect(coreStateMarkup).not.toContain('Strategy Exposure');
    expect(coreStateMarkup).not.toContain('Risk Policy & Roles');
  });
});
