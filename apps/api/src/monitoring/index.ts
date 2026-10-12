export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertCategory =
  | 'reconciliation_mismatch'
  | 'unexpected_usdc_balance_change'
  | 'unexpected_strategy_value_share_change'
  | 'stale_valuation'
  | 'stale_indexer'
  | 'rpc_failure'
  | 'withdrawal_shortfall'
  | 'missing_invalid_event_data'
  | 'paused_treasury'
  | 'pending_risk_increasing_timelock';

export type MaybeBigInt = bigint | number | string | null | undefined;

export interface Alert {
  severity: AlertSeverity;
  category: AlertCategory;
  contract?: string;
  strategy?: string;
  user?: string;
  observedValue: string | number | bigint | boolean | null;
  expectedValue: string | number | bigint | boolean | null;
  block: bigint | null;
  timestamp: bigint | null;
  explanation: string;
}

export interface StrategySnapshot {
  strategyAddress: string;
  protocolId?: string | null;
  assetAddress?: string | null;
  core?: {
    currentValue?: MaybeBigInt;
    position?: MaybeBigInt;
    shares?: MaybeBigInt;
    principal?: MaybeBigInt;
    realizedYield?: MaybeBigInt;
    realizedLoss?: MaybeBigInt;
    withdrawalShortfall?: MaybeBigInt;
    valuationStatus?: MaybeBigInt | number | string | null;
    valuationBlock?: MaybeBigInt;
    totalDeployed?: MaybeBigInt;
    protocolExposure?: MaybeBigInt;
    assetExposure?: MaybeBigInt;
  };
  adapter?: {
    currentValue?: MaybeBigInt;
    position?: MaybeBigInt;
    shares?: MaybeBigInt;
    principal?: MaybeBigInt;
    realizedYield?: MaybeBigInt;
    realizedLoss?: MaybeBigInt;
    withdrawalShortfall?: MaybeBigInt;
    valuationStatus?: MaybeBigInt | number | string | null;
    valuationBlock?: MaybeBigInt;
    totalDeployed?: MaybeBigInt;
    protocolExposure?: MaybeBigInt;
    assetExposure?: MaybeBigInt;
  };
}

export interface TreasuryMonitoringSnapshot {
  chainId: number;
  coreAddress: string;
  block?: MaybeBigInt;
  timestamp?: MaybeBigInt;
  treasuryAssets?: {
    totalManagedAssets?: MaybeBigInt;
    liquidUSDC?: MaybeBigInt;
    totalDeployed?: MaybeBigInt;
    requiredLiquidReserve?: MaybeBigInt;
    availableLiquidity?: MaybeBigInt;
  };
  userLiabilities?: {
    totalUserLiabilities?: MaybeBigInt;
    aggregateUserLedgerValue?: MaybeBigInt;
  };
  strategies?: StrategySnapshot[];
  exposure?: {
    protocolExposure?: Record<string, MaybeBigInt>;
    assetExposure?: Record<string, MaybeBigInt>;
    strategyDeployment?: Record<string, MaybeBigInt>;
    totalDeployed?: MaybeBigInt;
  };
  approvals?: {
    approvedProtocols?: string[];
    approvedAssets?: string[];
    approvedStrategies?: string[];
    riskPolicy?: Record<string, MaybeBigInt | string | boolean | number | null>;
    caps?: Record<string, MaybeBigInt>;
    paused?: boolean | null;
    pendingTimelocks?: Array<{ id?: string; kind?: string; eta?: MaybeBigInt; riskIncreasing?: boolean; }>
  };
  treasuryUsdc?: {
    actualCoreBalance?: MaybeBigInt;
    expectedAccountingBalance?: MaybeBigInt;
  };
  indexer?: {
    lastProcessedBlock?: MaybeBigInt;
    currentHead?: MaybeBigInt;
    finalizedBlock?: MaybeBigInt;
    rpcAvailable?: boolean;
    lastRpcError?: string | null;
    staleThreshold?: MaybeBigInt;
  };
  invalidEvents?: Array<{ eventName?: string; txHash?: string; logIndex?: MaybeBigInt; reason?: string }>;
}

export interface TreasuryMonitoringSummary {
  treasuryHealth: 'healthy' | 'warning' | 'critical';
  userAccountingStatus: 'healthy' | 'warning' | 'critical';
  liquidityStatus: 'healthy' | 'warning' | 'critical';
  strategyStatus: 'healthy' | 'warning' | 'critical';
  exposureStatus: 'healthy' | 'warning' | 'critical';
  policyStatus: 'healthy' | 'warning' | 'critical';
  indexerStatus: 'healthy' | 'warning' | 'critical';
  reconciliationStatus: 'healthy' | 'warning' | 'critical';
  activeAlerts: Alert[];
}

function toBigInt(value: MaybeBigInt): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '0x') return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function severityFromCount(count: number): AlertSeverity {
  if (count === 0) return 'info';
  if (count <= 2) return 'warning';
  return 'critical';
}

function addAlert(alerts: Alert[], alert: Alert): void {
  alerts.push(alert);
}

export function buildTreasuryMonitoringSummary(snapshot: TreasuryMonitoringSnapshot): TreasuryMonitoringSummary {
  const alerts: Alert[] = [];
  const t = snapshot.treasuryAssets;
  const u = snapshot.userLiabilities;
  const e = snapshot.exposure;
  const p = snapshot.approvals;
  const usdc = snapshot.treasuryUsdc;
  const idx = snapshot.indexer;

  if (t?.totalManagedAssets !== undefined && t?.liquidUSDC !== undefined && t?.totalDeployed !== undefined) {
    const totalManaged = toBigInt(t.totalManagedAssets);
    const liquid = toBigInt(t.liquidUSDC);
    const deployed = toBigInt(t.totalDeployed);
    if (totalManaged !== null && liquid !== null && deployed !== null) {
      const expected = liquid + deployed;
      if (totalManaged !== expected) {
        addAlert(alerts, {
          severity: 'critical',
          category: 'reconciliation_mismatch',
          contract: snapshot.coreAddress,
          observedValue: totalManaged,
          expectedValue: expected,
          block: toBigInt(snapshot.block),
          timestamp: toBigInt(snapshot.timestamp),
          explanation: 'totalManagedAssets must equal liquidUSDC + totalDeployed.',
        });
      }
    }
  }

  if (t?.availableLiquidity !== undefined && t?.requiredLiquidReserve !== undefined) {
    const available = toBigInt(t.availableLiquidity);
    const required = toBigInt(t.requiredLiquidReserve);
    if (available !== null && required !== null) {
      if (available < required) {
        addAlert(alerts, {
          severity: 'warning',
          category: 'reconciliation_mismatch',
          contract: snapshot.coreAddress,
          observedValue: available,
          expectedValue: required,
          block: toBigInt(snapshot.block),
          timestamp: toBigInt(snapshot.timestamp),
          explanation: 'Available liquidity is below the required reserve.',
        });
      }
    }
  }

  if (u?.totalUserLiabilities !== undefined && u?.aggregateUserLedgerValue !== undefined) {
    const liabilities = toBigInt(u.totalUserLiabilities);
    const ledgerValue = toBigInt(u.aggregateUserLedgerValue);
    if (liabilities !== null && ledgerValue !== null && liabilities !== ledgerValue) {
      addAlert(alerts, {
        severity: 'critical',
        category: 'reconciliation_mismatch',
        contract: snapshot.coreAddress,
        observedValue: liabilities,
        expectedValue: ledgerValue,
        block: toBigInt(snapshot.block),
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'User liabilities do not match the aggregate ledger-derived user value.',
      });
    }
  }

  for (const strategy of snapshot.strategies ?? []) {
    const core = strategy.core ?? {};
    const adapter = strategy.adapter;

    if (adapter) {
      const fields: Array<{ label: string; expected: MaybeBigInt; observed: MaybeBigInt; }> = [
        { label: 'currentValue', expected: core.currentValue, observed: adapter.currentValue },
        { label: 'position', expected: core.position, observed: adapter.position },
        { label: 'shares', expected: core.shares, observed: adapter.shares },
        { label: 'principal', expected: core.principal, observed: adapter.principal },
      ];

      for (const field of fields) {
        const expected = toBigInt(field.expected);
        const observed = toBigInt(field.observed);
        if (expected !== null && observed !== null && expected !== observed) {
          addAlert(alerts, {
            severity: 'critical',
            category: 'unexpected_strategy_value_share_change',
            contract: snapshot.coreAddress,
            strategy: strategy.strategyAddress,
            observedValue: observed,
            expectedValue: expected,
            block: toBigInt(snapshot.block),
            timestamp: toBigInt(snapshot.timestamp),
            explanation: `Strategy ${field.label} differs between Core and adapter state.`,
          });
        }
      }
    }

    const valuationBlock = toBigInt(core.valuationBlock ?? adapter?.valuationBlock);
    const currentHead = toBigInt(idx?.currentHead ?? snapshot.block);
    const staleThreshold = toBigInt(idx?.staleThreshold ?? 100n) ?? 100n;
    if (valuationBlock !== null && currentHead !== null && currentHead - valuationBlock > staleThreshold) {
      addAlert(alerts, {
        severity: 'warning',
        category: 'stale_valuation',
        contract: snapshot.coreAddress,
        strategy: strategy.strategyAddress,
        observedValue: valuationBlock,
        expectedValue: currentHead,
        block: currentHead,
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'Strategy valuation is stale relative to the current head block.',
      });
    }

    const withdrawalShortfall = toBigInt(core.withdrawalShortfall ?? adapter?.withdrawalShortfall);
    if (withdrawalShortfall !== null && withdrawalShortfall > 0n) {
      addAlert(alerts, {
        severity: 'warning',
        category: 'withdrawal_shortfall',
        contract: snapshot.coreAddress,
        strategy: strategy.strategyAddress,
        observedValue: withdrawalShortfall,
        expectedValue: 0n,
        block: toBigInt(snapshot.block),
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'Strategy has a positive withdrawal shortfall.',
      });
    }
  }

  if (e?.protocolExposure || e?.assetExposure || e?.strategyDeployment || e?.totalDeployed) {
    const totalDeployed = toBigInt(e?.totalDeployed ?? t?.totalDeployed);
    if (totalDeployed !== null && toBigInt(t?.totalDeployed) !== null && totalDeployed !== toBigInt(t?.totalDeployed)) {
      addAlert(alerts, {
        severity: 'critical',
        category: 'reconciliation_mismatch',
        contract: snapshot.coreAddress,
        observedValue: totalDeployed,
        expectedValue: toBigInt(t?.totalDeployed),
        block: toBigInt(snapshot.block),
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'Exposure totalDeployed diverges from Treasury totalDeployed.',
      });
    }
  }

  if (p?.paused === true) {
    addAlert(alerts, {
      severity: 'warning',
      category: 'paused_treasury',
      contract: snapshot.coreAddress,
      observedValue: true,
      expectedValue: false,
      block: toBigInt(snapshot.block),
      timestamp: toBigInt(snapshot.timestamp),
      explanation: 'Treasury is paused.',
    });
  }

  const pendingTimelocks = p?.pendingTimelocks ?? [];
  for (const pending of pendingTimelocks) {
    if (pending.riskIncreasing === true) {
      addAlert(alerts, {
        severity: 'warning',
        category: 'pending_risk_increasing_timelock',
        contract: snapshot.coreAddress,
        observedValue: pending.id ?? pending.kind ?? 'pending',
        expectedValue: 'not_pending',
        block: toBigInt(snapshot.block),
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'A pending risk-increasing timelock remains active.',
      });
    }
  }

  if (usdc?.actualCoreBalance !== undefined && usdc?.expectedAccountingBalance !== undefined) {
    const actual = toBigInt(usdc.actualCoreBalance);
    const expected = toBigInt(usdc.expectedAccountingBalance);
    if (actual !== null && expected !== null && actual !== expected) {
      addAlert(alerts, {
        severity: 'critical',
        category: 'unexpected_usdc_balance_change',
        contract: snapshot.coreAddress,
        observedValue: actual,
        expectedValue: expected,
        block: toBigInt(snapshot.block),
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'Actual Core USDC balance differs from expected Treasury accounting.',
      });
    }
  }

  if (idx?.rpcAvailable === false) {
    addAlert(alerts, {
      severity: 'critical',
      category: 'rpc_failure',
      contract: snapshot.coreAddress,
      observedValue: idx?.lastRpcError ?? 'rpc unavailable',
      expectedValue: 'rpc available',
      block: toBigInt(snapshot.block),
      timestamp: toBigInt(snapshot.timestamp),
      explanation: 'RPC endpoint is unavailable or failed during monitoring.',
    });
  }

  if (idx?.lastProcessedBlock !== undefined && idx?.currentHead !== undefined) {
    const last = toBigInt(idx.lastProcessedBlock);
    const head = toBigInt(idx.currentHead);
    const threshold = toBigInt(idx.staleThreshold ?? 25n) ?? 25n;
    if (last !== null && head !== null && head - last > threshold) {
      addAlert(alerts, {
        severity: 'warning',
        category: 'stale_indexer',
        contract: snapshot.coreAddress,
        observedValue: last,
        expectedValue: head,
        block: head,
        timestamp: toBigInt(snapshot.timestamp),
        explanation: 'Indexer is stale relative to the latest observed head.',
      });
    }
  }

  for (const item of snapshot.invalidEvents ?? []) {
    addAlert(alerts, {
      severity: 'warning',
      category: 'missing_invalid_event_data',
      contract: snapshot.coreAddress,
      user: item.txHash,
      observedValue: item.reason ?? 'invalid event payload',
      expectedValue: 'valid event payload',
      block: toBigInt(item.logIndex ?? null),
      timestamp: toBigInt(snapshot.timestamp),
      explanation: `Indexed event ${item.eventName ?? 'unknown'} is missing or invalid: ${item.reason ?? 'no reason provided'}.`,
    });
  }

  const statusMap = {
    healthy: 'healthy',
    warning: 'warning',
    critical: 'critical',
  } as const;

  const reconciliationStatus = alerts.some((alert) => alert.category === 'reconciliation_mismatch' || alert.category === 'unexpected_usdc_balance_change') ? 'critical' : alerts.some((alert) => alert.category === 'stale_indexer' || alert.category === 'stale_valuation') ? 'warning' : 'healthy';
  const liquidityStatus = alerts.some((alert) => alert.category === 'reconciliation_mismatch' && alert.contract === snapshot.coreAddress) ? 'critical' : 'healthy';
  const strategyStatus = alerts.some((alert) => alert.category === 'unexpected_strategy_value_share_change' || alert.category === 'withdrawal_shortfall' || alert.category === 'stale_valuation') ? 'warning' : 'healthy';
  const exposureStatus = alerts.some((alert) => alert.category === 'reconciliation_mismatch') ? 'warning' : 'healthy';
  const policyStatus = alerts.some((alert) => alert.category === 'paused_treasury' || alert.category === 'pending_risk_increasing_timelock') ? 'warning' : 'healthy';
  const indexerStatus = alerts.some((alert) => alert.category === 'stale_indexer' || alert.category === 'rpc_failure') ? 'critical' : 'healthy';
  const userAccountingStatus = alerts.some((alert) => alert.category === 'reconciliation_mismatch' && alert.user === undefined) ? 'critical' : 'healthy';
  const treasuryHealth = alerts.length === 0 ? 'healthy' : severityFromCount(alerts.length) === 'warning' ? 'warning' : 'critical';

  return {
    treasuryHealth: statusMap[treasuryHealth],
    userAccountingStatus: statusMap[userAccountingStatus],
    liquidityStatus: statusMap[liquidityStatus],
    strategyStatus: statusMap[strategyStatus],
    exposureStatus: statusMap[exposureStatus],
    policyStatus: statusMap[policyStatus],
    indexerStatus: statusMap[indexerStatus],
    reconciliationStatus: statusMap[reconciliationStatus],
    activeAlerts: alerts,
  };
}

export function monitorTreasury(snapshot: TreasuryMonitoringSnapshot): { summary: TreasuryMonitoringSummary; alerts: Alert[] } {
  const summary = buildTreasuryMonitoringSummary(snapshot);
  return { summary, alerts: summary.activeAlerts };
}
