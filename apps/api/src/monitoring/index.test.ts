import { describe, expect, it } from 'vitest';
import { ARC_MAINNET_CURRENT_LIVE_REFERENCES } from '@velox/domain';

import { monitorTreasury, type TreasuryMonitoringSnapshot } from './index.js';

const baseSnapshot: TreasuryMonitoringSnapshot = {
  chainId: 5042,
  coreAddress: ARC_MAINNET_CURRENT_LIVE_REFERENCES.core,
  block: 500n,
  timestamp: 1700000000n,
  treasuryAssets: {
    totalManagedAssets: 1000n,
    liquidUSDC: 400n,
    totalDeployed: 600n,
    requiredLiquidReserve: 100n,
    availableLiquidity: 300n,
  },
  userLiabilities: {
    totalUserLiabilities: 1000n,
    aggregateUserLedgerValue: 1000n,
  },
  strategies: [
    {
      strategyAddress: '0x1111111111111111111111111111111111111111',
      protocolId: '0x2222222222222222222222222222222222222222222222222222222222222222',
      assetAddress: '0x3600000000000000000000000000000000000000',
      core: {
        currentValue: 600n,
        position: 600n,
        shares: 600n,
        principal: 600n,
        realizedYield: 0n,
        realizedLoss: 0n,
        withdrawalShortfall: 0n,
        valuationStatus: 1,
        valuationBlock: 490n,
      },
      adapter: {
        currentValue: 600n,
        position: 600n,
        shares: 600n,
        principal: 600n,
      },
    },
  ],
  exposure: {
    protocolExposure: { '0x2222222222222222222222222222222222222222': 600n },
    assetExposure: { '0x3600000000000000000000000000000000000000': 600n },
    strategyDeployment: { '0x1111111111111111111111111111111111111111': 600n },
    totalDeployed: 600n,
  },
  approvals: {
    approvedProtocols: ['0x2222222222222222222222222222222222222222'],
    approvedAssets: ['0x3600000000000000000000000000000000000000'],
    approvedStrategies: ['0x1111111111111111111111111111111111111111'],
    riskPolicy: { minimumLiquidReserve: 100n },
    caps: { totalDeployed: 1000n },
    paused: false,
    pendingTimelocks: [],
  },
  treasuryUsdc: {
    actualCoreBalance: 1000n,
    expectedAccountingBalance: 1000n,
  },
  indexer: {
    lastProcessedBlock: 490n,
    currentHead: 500n,
    finalizedBlock: 500n,
    rpcAvailable: true,
    staleThreshold: 25n,
  },
};

describe('treasury monitoring', () => {
  it('accepts a healthy Treasury state without alerts', () => {
    const { summary, alerts } = monitorTreasury(baseSnapshot);

    expect(alerts).toHaveLength(0);
    expect(summary.treasuryHealth).toBe('healthy');
    expect(summary.reconciliationStatus).toBe('healthy');
  });

  it('raises a managed-assets mismatch when the invariant is broken', () => {
    const snapshot = {
      ...baseSnapshot,
      treasuryAssets: {
        ...baseSnapshot.treasuryAssets,
        totalManagedAssets: 1500n,
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'reconciliation_mismatch')).toBe(true);
  });

  it('raises a liability mismatch when ledger value differs from on-chain liabilities', () => {
    const snapshot = {
      ...baseSnapshot,
      userLiabilities: {
        totalUserLiabilities: 900n,
        aggregateUserLedgerValue: 1000n,
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'reconciliation_mismatch' && alert.contract === baseSnapshot.coreAddress)).toBe(true);
  });

  it('raises a strategy mismatch when Core and adapter values differ', () => {
    const snapshot = {
      ...baseSnapshot,
      strategies: [
        {
          strategyAddress: '0x1111111111111111111111111111111111111111',
          protocolId: '0x2222222222222222222222222222222222222222222222222222222222222222',
          assetAddress: '0x3600000000000000000000000000000000000000',
          core: { ...baseSnapshot.strategies![0].core },
          adapter: {
            ...(baseSnapshot.strategies![0].adapter ?? {}),
            currentValue: 500n,
          },
        },
      ],
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'unexpected_strategy_value_share_change')).toBe(true);
  });

  it('raises an exposure mismatch when totals diverge', () => {
    const snapshot = {
      ...baseSnapshot,
      exposure: {
        ...baseSnapshot.exposure,
        totalDeployed: 900n,
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'reconciliation_mismatch')).toBe(true);
  });

  it('raises an unexpected USDC balance change', () => {
    const snapshot = {
      ...baseSnapshot,
      treasuryUsdc: {
        actualCoreBalance: 500n,
        expectedAccountingBalance: 1000n,
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'unexpected_usdc_balance_change')).toBe(true);
  });

  it('raises a stale valuation alert when the valuation block is behind head', () => {
    const snapshot = {
      ...baseSnapshot,
      block: 1000n,
      indexer: {
        ...baseSnapshot.indexer,
        currentHead: 1000n,
        staleThreshold: 25n,
      },
      strategies: [
        {
          strategyAddress: '0x1111111111111111111111111111111111111111',
          protocolId: '0x2222222222222222222222222222222222222222222222222222222222222222',
          assetAddress: '0x3600000000000000000000000000000000000000',
          core: {
            ...baseSnapshot.strategies![0].core,
            valuationBlock: 950n,
          },
          adapter: { ...(baseSnapshot.strategies![0].adapter ?? {}) },
        },
      ],
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'stale_valuation')).toBe(true);
  });

  it('raises a paused Treasury alert', () => {
    const snapshot = {
      ...baseSnapshot,
      approvals: {
        ...baseSnapshot.approvals,
        paused: true,
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'paused_treasury')).toBe(true);
  });

  it('raises a pending risk-increasing timelock alert', () => {
    const snapshot = {
      ...baseSnapshot,
      approvals: {
        ...baseSnapshot.approvals,
        pendingTimelocks: [{ id: 'op-1', kind: 'risk_policy', riskIncreasing: true }],
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.some((alert) => alert.category === 'pending_risk_increasing_timelock')).toBe(true);
  });

  it('raises multiple simultaneous alerts without false negatives', () => {
    const snapshot = {
      ...baseSnapshot,
      treasuryAssets: {
        ...baseSnapshot.treasuryAssets,
        totalManagedAssets: 1250n,
      },
      userLiabilities: {
        totalUserLiabilities: 900n,
        aggregateUserLedgerValue: 1000n,
      },
      treasuryUsdc: {
        actualCoreBalance: 700n,
        expectedAccountingBalance: 1000n,
      },
      approvals: {
        ...baseSnapshot.approvals,
        paused: true,
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts.length).toBeGreaterThanOrEqual(3);
    expect(alerts.some((alert) => alert.category === 'reconciliation_mismatch')).toBe(true);
    expect(alerts.some((alert) => alert.category === 'paused_treasury')).toBe(true);
  });

  it('does not create a false alert when values reconcile correctly', () => {
    const snapshot = {
      ...baseSnapshot,
      approvals: {
        ...baseSnapshot.approvals,
        pendingTimelocks: [],
      },
    };

    const { alerts } = monitorTreasury(snapshot);
    expect(alerts).toHaveLength(0);
    expect(snapshot.treasuryAssets?.totalManagedAssets).toBe(1000n);
  });
});
