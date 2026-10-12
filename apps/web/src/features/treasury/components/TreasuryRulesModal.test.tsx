import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultPolicy } from '../services/policyService';
import type { AdminBucketPolicySuggestion } from '../../ai/services/adminBucketPolicySuggestion';
import { applyBucketPolicySuggestionToDraft, TreasuryRulesModal } from './TreasuryRulesModal';

function createSuggestionMarketData() {
  const unavailable = { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'UNAVAILABLE' };
  return {
    source: 'MORPHO_GRAPHQL' as const,
    status: 'PARTIAL' as const,
    network: 'Arc Mainnet' as const,
    chainId: 5042 as const,
    assetAddress: '0x3600000000000000000000000000000000000000',
    vaultAddress: '0xbeef0016cb2fd5c352ea7ca08a9f54739dfa7298',
    protocolName: 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2' as const,
    protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
    identityVerified: true,
    freshness: {
      status: 'CURRENT' as const,
      blockNumber: '500',
      blockTimestamp: String(Math.floor(Date.now() / 1000)),
      retrievedAt: new Date().toISOString(),
      ageSeconds: 0,
      maximumAgeSeconds: 600,
      sourceHeadBlockNumber: '500',
      sourceHeadBlockTimestamp: String(Math.floor(Date.now() / 1000)),
    },
    vault: {
      totalAssets: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '1000000', unit: 'USDC_BASE_UNITS' },
      availableLiquidity: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '250000', unit: 'USDC_BASE_UNITS' },
      idleLiquidity: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '250000', unit: 'USDC_BASE_UNITS' },
      utilizationBps: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'BPS' },
      totalSupply: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '900000', unit: 'SHARES' },
      apy: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0.0325', unit: 'RATIO' },
      netApy: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0.031', unit: 'RATIO' },
      warnings: unavailable,
      allocation: unavailable,
      depositAvailability: unavailable,
      depositGateStatus: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: 'receiveAssetsGate address=null; abdicated=true', unit: 'GATE_CONFIG' },
      timelock: { source: 'UNAVAILABLE', availability: 'UNAVAILABLE', value: null, unit: 'SECONDS' },
    },
    underlyingMarket: {
      allocation: unavailable,
      liquidity: unavailable,
      utilizationBps: unavailable,
      collateralExposure: unavailable,
      lltv: unavailable,
      oracleStatus: unavailable,
      badDebtStatus: unavailable,
      liquidationRisk: unavailable,
      warnings: unavailable,
      marketId: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: `0x${'1'.repeat(64)}`, unit: 'MARKET_ID' },
      stateBlockNumber: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '500', unit: 'BLOCK' },
      stateTimestamp: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: String(Math.floor(Date.now() / 1000)), unit: 'UNIX_SECONDS' },
      collateralAssetAddress: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: '0x5555555555555555555555555555555555555555', unit: 'ADDRESS' },
      collateralAssetDecimals: { source: 'MORPHO_GRAPHQL', availability: 'AVAILABLE', value: 18, unit: 'DECIMALS' },
    },
    unavailableData: ['Underlying Morpho market facts unavailable.'],
  };
}

describe('TreasuryRulesModal Core policy readback', () => {
  it('keeps Apply disabled for an untouched draft without an authoritative bucket decision', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'NO_ONCHAIN_CHANGES', pendingOperations: [] }))}
        onChainPolicy={null}
        canApplyOnChain
      />,
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Apply on-chain policy<\/button>/);
    expect(markup).toContain('id="liquid-operational-reserve" class="vx-input" inputMode="decimal" value=""');
    expect(markup).not.toContain('value="25"');
    expect(markup).not.toContain('Save local policy');
    expect(markup).toContain('Apply on-chain policy');
    expect(markup).not.toContain('Surplus operational sweep threshold');
    expect(markup).toContain('Maximum Single Withdrawal');
    expect(markup).toContain('24-Hour Outflow Spending Cap');
    expect(markup).toContain('id="maximum-single-withdrawal" class="vx-input" inputMode="decimal" disabled="" readOnly="" value="Unavailable"');
    expect(markup).toContain('id="24-hour-outflow-spending-cap" class="vx-input" inputMode="decimal" disabled="" readOnly="" value="Unavailable"');
    expect(markup).toContain('Withdrawal policy controls are unavailable');
    expect(markup).not.toContain('Configure surplus sweep for future automation');
  });

  it('does not populate on-chain Core fields from locally saved policy when Core readback is unavailable', () => {
    const policy = {
      ...createDefaultPolicy(),
      minimumLiquidReserve: 8_000_000n,
      maximumSingleWithdrawal: 4_000_000n,
      dailyOutflowCap: 7_000_000n,
      allocations: {
        operational_reserve: 4_000n,
        yield_strategy: 3_000n,
        swap_liquidity: 2_000n,
        automation_agent: 1_000n,
      },
    };
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={policy}
        onApply={vi.fn(async () => ({ status: 'NO_ONCHAIN_CHANGES', pendingOperations: [] }))}
        onChainPolicy={null}
        canApplyOnChain
      />,
    );

    expect(markup).toContain('id="minimum-liquid-reserve" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="minimum-liquid-reserve-bps" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="maximum-total-deployed" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="maximum-single-withdrawal" class="vx-input" inputMode="decimal" disabled="" readOnly="" value="Unavailable"');
    expect(markup).toContain('id="24-hour-outflow-spending-cap" class="vx-input" inputMode="decimal" disabled="" readOnly="" value="Unavailable"');
    expect(markup).toContain('id="liquid-operational-reserve" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="yield-strategy-buffer" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="sweep-liquidity-buffer" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="automation-ai-agent-pool" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toMatch(/<button type="button" class="vx-btn vx-btn-primary" disabled="">Apply on-chain policy<\/button>/);
  });

  it('shows authoritative Core risk and bucket values without local-only policy controls', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'NO_ONCHAIN_CHANGES', pendingOperations: [] }))}
        onChainPolicy={{
          minimumLiquidReserve: '10000000',
          minimumLiquidReserveBps: 5000,
          maximumTotalDeployed: '100000000',
          maximumSingleWithdrawal: '25000000',
          dailyOutflowCap: '75000000',
          timelockDelaySeconds: '172800',
          valuationFreshnessBlocks: '100',
          bucketPolicy: {
            liquidOperationalReserveBps: 5000,
            yieldStrategyBufferBps: 3000,
            sweepLiquidityBufferBps: 1000,
            automationAgentPoolBps: 1000,
          },
        }}
        canApplyOnChain={false}
      />,
    );

    expect(markup).toContain('Authoritative Core policy readback');
    expect(markup).toContain('10.00 USDC');
    expect(markup).toContain('50%');
    expect(markup).toContain('30%');
    expect(markup).not.toContain('saved in this browser');
    expect(markup).toContain('25.00 USDC; 24-hour outflow spending cap: 75.00 USDC');
    expect(markup).toContain('id="maximum-single-withdrawal" class="vx-input" inputMode="decimal" value="25"');
    expect(markup).toContain('id="24-hour-outflow-spending-cap" class="vx-input" inputMode="decimal" value="75"');
    expect(markup).not.toContain('No on-chain policy has been read yet');
  });

  it('renders all Core policy inputs and keeps Core-fixed values read-only', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'APPLIED', pendingOperations: [] }))}
        onChainPolicy={{
          minimumLiquidReserve: '0',
          minimumLiquidReserveBps: 0,
          maximumTotalDeployed: '0',
          maximumSingleWithdrawal: '2500000',
          dailyOutflowCap: '10000000',
          timelockDelaySeconds: '172800',
          valuationFreshnessBlocks: '100',
          bucketPolicy: {
            liquidOperationalReserveBps: 0,
            yieldStrategyBufferBps: 10_000,
            sweepLiquidityBufferBps: 0,
            automationAgentPoolBps: 0,
          },
        }}
        canApplyOnChain
      />,
    );

    for (const label of [
      'Minimum Liquid Reserve',
      'Minimum Liquid Reserve BPS',
      'Maximum Total Deployed',
      'Liquid Operational Reserve',
      'Yield Strategy Buffer',
      'Sweep Liquidity Buffer',
      'Automation / AI Agent Pool',
      'Timelock Delay',
      'Valuation Freshness Blocks',
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('id="timelock-delay" class="vx-input" inputMode="decimal" disabled="" readOnly=""');
    expect(markup).toContain('id="valuation-freshness-blocks" class="vx-input" inputMode="decimal" disabled="" readOnly=""');
    expect(markup).toMatch(/<button type="button" class="vx-btn vx-btn-primary"[^>]*>Apply on-chain policy<\/button>/);
    expect(markup).not.toContain('Local/application-only policy');
    expect(markup).toContain('On-chain Core risk policy');
  });

  it('keeps incomplete bucket readback blank and prevents Apply without creating an allocation', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'APPLIED', pendingOperations: [] }))}
        onChainPolicy={{
          minimumLiquidReserve: '0',
          minimumLiquidReserveBps: 0,
          maximumTotalDeployed: '0',
          timelockDelaySeconds: '172800',
          valuationFreshnessBlocks: '100',
          bucketPolicy: {
            liquidOperationalReserveBps: null,
            yieldStrategyBufferBps: null,
            sweepLiquidityBufferBps: null,
            automationAgentPoolBps: null,
          },
        }}
        canApplyOnChain
      />,
    );

    expect(markup).toContain('id="liquid-operational-reserve" class="vx-input" inputMode="decimal" value=""');
    expect(markup).toContain('id="yield-strategy-buffer" class="vx-input" inputMode="decimal" value=""');
    expect(markup).not.toContain('value="25"');
    expect(markup).toMatch(/<button type="button" class="vx-btn vx-btn-primary" disabled="">Apply on-chain policy<\/button>/);
  });

  it('shows unavailable fixed Core values without validation errors and keeps Apply disabled', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'APPLIED', pendingOperations: [] }))}
        onChainPolicy={{
          minimumLiquidReserve: '0',
          minimumLiquidReserveBps: 0,
          maximumTotalDeployed: '0',
          timelockDelaySeconds: null,
          valuationFreshnessBlocks: null,
          bucketPolicy: {
            liquidOperationalReserveBps: 4000,
            yieldStrategyBufferBps: 3000,
            sweepLiquidityBufferBps: 2000,
            automationAgentPoolBps: 1000,
          },
        }}
        canApplyOnChain
      />,
    );

    expect(markup).toContain('id="timelock-delay" class="vx-input" inputMode="decimal" disabled="" readOnly="" value="Unavailable"');
    expect(markup).toContain('id="valuation-freshness-blocks" class="vx-input" inputMode="decimal" disabled="" readOnly="" value="Unavailable"');
    expect(markup).not.toContain('Timelock delay is required');
    expect(markup).not.toContain('Valuation freshness blocks is required');
    expect(markup).toMatch(/<button type="button" class="vx-btn vx-btn-primary" disabled="">Apply on-chain policy<\/button>/);
  });

  it('allows UI validation for an explicitly complete 10,000 BPS bucket policy', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'APPLIED', pendingOperations: [] }))}
        onChainPolicy={{
          minimumLiquidReserve: '0',
          minimumLiquidReserveBps: 0,
          maximumTotalDeployed: '0',
          timelockDelaySeconds: '172800',
          valuationFreshnessBlocks: '100',
          bucketPolicy: {
            liquidOperationalReserveBps: 4000,
            yieldStrategyBufferBps: 3000,
            sweepLiquidityBufferBps: 2000,
            automationAgentPoolBps: 1000,
          },
        }}
        canApplyOnChain
      />,
    );

    expect(markup).toContain('value="40"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain('value="20"');
    expect(markup).toContain('value="10"');
    expect(markup).not.toContain('Allocation percentages must total exactly 100%');
    expect(markup).toMatch(/<button type="button" class="vx-btn vx-btn-primary">Apply on-chain policy<\/button>/);
  });

  it('renders the Admin AI suggestion and Core policy actions without a local-save form', () => {
    const markup = renderToStaticMarkup(
      <TreasuryRulesModal
        isOpen
        onClose={vi.fn()}
        rules={[]}
        policy={createDefaultPolicy()}
        onApply={vi.fn(async () => ({ status: 'APPLIED', pendingOperations: [] }))}
        onChainPolicy={null}
        canApplyOnChain
        canRequestBucketSuggestion
        onSuggestBucketPolicy={vi.fn(async () => ({
          advisoryLabel: 'AI recommendation — Admin review required.',
          recommendationStatus: 'UNAVAILABLE',
          marketDataStatus: 'UNAVAILABLE',
          marketData: null,
          coreConstraints: { status: 'UNAVAILABLE', maximumYieldStrategyBufferBps: null, minimumLiquidOperationalReserveBps: null },
          veloxFacts: {
            treasury: {},
            currentBucketPolicy: {
              liquidOperationalReserveBps: { source: 'CORE', availability: 'AVAILABLE', value: 5_000, unit: 'BPS' },
              yieldStrategyBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 2_500, unit: 'BPS' },
              sweepLiquidityBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_500, unit: 'BPS' },
              automationAgentPoolBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_000, unit: 'BPS' },
            },
            strategy: {},
          },
          bucketPolicyValidation: { status: 'AVAILABLE', exceededBuckets: [] },
          allocations: [],
          totalPercentage: null,
          totalBps: null,
          missingVerifiedData: [],
          evidenceReferences: ['underlyingMarket.liquidity'],
          keyRiskAssumptions: ['Market data unavailable.'],
          unavailableData: ['Verified live market data are unavailable.'],
          executionStatus: 'NOT_EXECUTABLE',
        } satisfies AdminBucketPolicySuggestion))}
      />,
    );

    expect(markup).toContain('Get Current AI Recommendation');
    expect(markup).toContain('AI recommendation — Admin review required.');
    expect(markup).toContain('Apply on-chain policy');
    expect((markup.match(/<form(?:\s|>)/g) ?? [])).toHaveLength(0);
    expect(markup).not.toContain('Use recommendation in policy draft');
  });

  it('copies only the four suggestion percentages into the editable local draft', () => {
    const original = {
      minimumLiquidReserve: '10.25',
      minimumLiquidReserveBps: '5000',
      maximumTotalDeployed: '100',
      timelockDelaySeconds: '172800',
      valuationFreshnessBlocks: '100',
      surplusSweepThreshold: '12',
      dailyOutflowCap: '20',
      maximumSingleWithdrawal: '5',
      automatedSweepEnabled: true,
      allocations: {
        operational_reserve: '1',
        yield_strategy: '2',
        swap_liquidity: '3',
        automation_agent: '4',
      },
    };
    const suggestion: AdminBucketPolicySuggestion = {
      advisoryLabel: 'AI recommendation — Admin review required.',
      recommendationStatus: 'AVAILABLE',
      marketDataStatus: 'PARTIAL',
      marketData: createSuggestionMarketData(),
      coreConstraints: { status: 'AVAILABLE', maximumYieldStrategyBufferBps: 8_000, minimumLiquidOperationalReserveBps: 1_000 },
      veloxFacts: {
        treasury: {},
        currentBucketPolicy: {
          liquidOperationalReserveBps: { source: 'CORE', availability: 'AVAILABLE', value: 5_000, unit: 'BPS' },
          yieldStrategyBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 2_500, unit: 'BPS' },
          sweepLiquidityBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_500, unit: 'BPS' },
          automationAgentPoolBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_000, unit: 'BPS' },
        },
        strategy: {},
      },
      bucketPolicyValidation: { status: 'AVAILABLE', exceededBuckets: [] },
      allocations: [
        { id: 'liquidOperationalReserve', name: 'Liquid Operational Reserve', percentage: '50.00%', bps: 5_000, reasoning: 'Protect liquidity.' },
        { id: 'yieldStrategyBuffer', name: 'Yield Strategy Buffer', percentage: '25.00%', bps: 2_500, reasoning: 'Limit exposure.' },
        { id: 'sweepLiquidityBuffer', name: 'Sweep Liquidity Buffer', percentage: '15.00%', bps: 1_500, reasoning: 'Preserve sweeps.' },
        { id: 'automationAgentPool', name: 'Automation / AI Agent Pool', percentage: '10.00%', bps: 1_000, reasoning: 'Limit future capacity.' },
      ],
      totalPercentage: '100%',
      totalBps: 10_000,
      missingVerifiedData: [],
      evidenceReferences: ['underlyingMarket.liquidity'],
      keyRiskAssumptions: ['Market data unavailable.'],
      unavailableData: ['Verified live market data are unavailable.'],
      executionStatus: 'NOT_EXECUTABLE',
    };

    const updated = applyBucketPolicySuggestionToDraft(original, suggestion);

    expect(updated).toEqual({
      ...original,
      allocations: {
        operational_reserve: '50',
        yield_strategy: '25',
        swap_liquidity: '15',
        automation_agent: '10',
      },
    });
    expect(original.allocations).toEqual({
      operational_reserve: '1',
      yield_strategy: '2',
      swap_liquidity: '3',
      automation_agent: '4',
    });
  });

  it('copies an over-limit AI policy recommendation into the local draft without applying it', () => {
    const original = {
      minimumLiquidReserve: '10',
      minimumLiquidReserveBps: '1000',
      maximumTotalDeployed: '100',
      timelockDelaySeconds: '172800',
      valuationFreshnessBlocks: '100',
      surplusSweepThreshold: '12',
      dailyOutflowCap: '20',
      maximumSingleWithdrawal: '5',
      automatedSweepEnabled: true,
      allocations: {
        operational_reserve: '11',
        yield_strategy: '22',
        swap_liquidity: '33',
        automation_agent: '34',
      },
    };
    const suggestion: AdminBucketPolicySuggestion = {
      advisoryLabel: 'AI recommendation — Admin review required.',
      recommendationStatus: 'REQUIRES_ADMIN_ADJUSTMENT',
      marketDataStatus: 'PARTIAL',
      marketData: createSuggestionMarketData(),
      coreConstraints: { status: 'AVAILABLE', maximumYieldStrategyBufferBps: 8_000, minimumLiquidOperationalReserveBps: 1_000 },
      veloxFacts: {
        treasury: {},
        currentBucketPolicy: {
          liquidOperationalReserveBps: { source: 'CORE', availability: 'AVAILABLE', value: 1_000, unit: 'BPS' },
          yieldStrategyBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 8_000, unit: 'BPS' },
          sweepLiquidityBufferBps: { source: 'CORE', availability: 'AVAILABLE', value: 500, unit: 'BPS' },
          automationAgentPoolBps: { source: 'CORE', availability: 'AVAILABLE', value: 500, unit: 'BPS' },
        },
        strategy: {},
      },
      bucketPolicyValidation: { status: 'AVAILABLE', exceededBuckets: ['yieldStrategyBuffer'] },
      allocations: [
        { id: 'liquidOperationalReserve', name: 'Liquid Operational Reserve', percentage: '10.00%', bps: 1_000, reasoning: 'Reserve.' },
        { id: 'yieldStrategyBuffer', name: 'Yield Strategy Buffer', percentage: '81.00%', bps: 8_100, reasoning: 'Suggested beyond the enforceable Core maximum.' },
        { id: 'sweepLiquidityBuffer', name: 'Sweep Liquidity Buffer', percentage: '5.00%', bps: 500, reasoning: 'Sweep needs.' },
        { id: 'automationAgentPool', name: 'Automation / AI Agent Pool', percentage: '4.00%', bps: 400, reasoning: 'Bound future capacity.' },
      ],
      totalPercentage: '100%',
      totalBps: 10_000,
      missingVerifiedData: [],
      evidenceReferences: ['underlyingMarket.liquidity'],
      keyRiskAssumptions: ['Requires Admin adjustment.'],
      unavailableData: ['Some Morpho risk data are unavailable.'],
      executionStatus: 'NOT_EXECUTABLE',
    };

    expect(applyBucketPolicySuggestionToDraft(original, suggestion).allocations).toEqual({
      operational_reserve: '10',
      yield_strategy: '81',
      swap_liquidity: '5',
      automation_agent: '4',
    });
  });

  it('allows local draft copy while keeping on-chain Apply disabled when Core exposure constraints are unavailable', () => {
    const source = readFileSync(new URL('./TreasuryRulesModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('suggestion?.coreConstraints.status !== \'UNAVAILABLE\'');
    expect(source).not.toContain('disabled={suggestion.recommendationStatus !== \'AVAILABLE\' || suggestion.coreConstraints.status !== \'AVAILABLE\'}');
    expect(source).toContain('suggestion.allocations.length === 4 && (');
    expect(source).toContain('Executability has not been verified.');
    expect(source).toContain('suggestion.allocations.map((allocation) =>');
  });

  it('renders insufficient evidence without recommendation percentages or bucket cards', () => {
    const source = readFileSync(new URL('./TreasuryRulesModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain("suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA'\n                      ? <strong>INSUFFICIENT VERIFIED DATA</strong>");
    expect(source).toContain('{suggestion.missingVerifiedData.map((field) => <li key={field}>{field}</li>)}');
    expect(source).toContain("suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA' ? (");
    expect(source).toContain(': suggestion.recommendationStatus !== \'UNAVAILABLE\' ? (');
    expect(source).toContain('No allocation generated');
  });

  it('keeps the default recommendation summary concise and puts raw market facts behind disclosure', () => {
    const source = readFileSync(new URL('./TreasuryRulesModal.tsx', import.meta.url), 'utf8');
    const summaryStart = source.indexOf('<div className="vx-ai-recommendation-content"');
    const analysisStart = source.indexOf('<details className="vx-field-hint">', summaryStart);
    const analysisEnd = source.indexOf('</details>', analysisStart);
    const defaultSummary = source.slice(summaryStart, analysisStart);
    const marketAnalysis = source.slice(analysisStart, analysisEnd);

    expect(defaultSummary).toContain('AI RECOMMENDATION — ADMIN REVIEW REQUIRED');
    expect(defaultSummary).toContain('Market data status:');
    expect(defaultSummary).toContain('NOT EXECUTABLE');
    expect(defaultSummary).toContain('{allocation.percentage}');
    expect(defaultSummary).toContain('Total: {suggestion.totalPercentage} / {suggestion.totalBps} BPS');
    expect(defaultSummary).not.toContain('Total assets:');
    expect(defaultSummary).not.toContain('Market ID:');
    expect(defaultSummary).not.toContain('Collateral asset:');
    expect(defaultSummary).not.toContain('LLTV:');
    expect(marketAnalysis).toContain('View market analysis');
    expect(marketAnalysis).toContain('Share supply:');
    expect(marketAnalysis).toContain('Oracle identity');
    expect(marketAnalysis).toContain('Snapshot block');
  });

  it('keeps recommendation population separate from the explicit on-chain Apply handler', () => {
    const source = readFileSync(new URL('./TreasuryRulesModal.tsx', import.meta.url), 'utf8');
    const draftAction = source.match(/const useSuggestionInDraft = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    const applyAction = source.match(/const apply = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';

    expect(source).toContain('onClick={useSuggestionInDraft}');
    expect(source).toContain('onClick={apply}');
    expect(draftAction).toContain('setValues((previous) => applyBucketPolicySuggestionToDraft(previous, suggestion))');
    expect(draftAction).not.toMatch(/onApply|onSave|writeContract|sendTransaction|scheduleTimelock/i);
    expect(applyAction).toContain('onApply(coreResult.draft)');
  });
});
