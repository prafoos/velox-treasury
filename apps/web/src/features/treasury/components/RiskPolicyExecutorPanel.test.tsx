import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RiskPolicyExecutorPanel } from './RiskPolicyExecutorPanel';
import type { PendingRiskPolicy, PendingWithdrawalPolicy } from '../hooks/useTreasurySummary';

const pending: PendingRiskPolicy = {
  operationId: `0x${'12'.repeat(32)}`,
  eta: 123_456n,
  policy: {
    minimumLiquidReserve: 50_000_000n,
    minimumLiquidReserveBps: 5_000,
    maximumTotalDeployed: 1_000_000_000n,
  },
};
const pendingWithdrawal: PendingWithdrawalPolicy = {
  operationId: `0x${'78'.repeat(32)}`,
  eta: 345_678n,
  policy: {
    maximumSingleWithdrawal: 25_000_000n,
    dailyOutflowCap: 100_000_000n,
  },
};

describe('RiskPolicyExecutorPanel', () => {
  it('displays the discovered operation ID, ETA, and policy payload', () => {
    const markup = renderToStaticMarkup(
      <RiskPolicyExecutorPanel
        pendingOperations={[pending]}
        pendingWithdrawalOperations={[]}
        isLoading={false}
        error={null}
        executionStatus={null}
        coreSupported
        onExecute={async () => undefined}
        onExecuteWithdrawal={async () => undefined}
      />,
    );

    expect(markup).toContain(pending.operationId);
    expect(markup).toContain('123456');
    expect(markup).toContain('5000 BPS');
    expect(markup).toContain('Execute Risk Policy');
  });

  it('does not render when no operation or discovery status is available', () => {
    const markup = renderToStaticMarkup(
      <RiskPolicyExecutorPanel
        pendingOperations={[]}
        pendingWithdrawalOperations={[]}
        isLoading={false}
        error={null}
        executionStatus={null}
        coreSupported={false}
        onExecute={async () => undefined}
        onExecuteWithdrawal={async () => undefined}
      />,
    );

    expect(markup).toBe('');
  });

  it('surfaces discovery errors without presenting an executable operation', () => {
    const markup = renderToStaticMarkup(
      <RiskPolicyExecutorPanel
        pendingOperations={[]}
        pendingWithdrawalOperations={[]}
        isLoading={false}
        error={new Error('Core event discovery failed.')}
        executionStatus={null}
        coreSupported={null}
        onExecute={vi.fn(async () => undefined)}
        onExecuteWithdrawal={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('Core event discovery failed.');
    expect(markup).not.toContain('Execute Risk Policy');
  });

  it('displays and exposes execution state for discovered Withdrawal Policy operations', () => {
    const markup = renderToStaticMarkup(
      <RiskPolicyExecutorPanel
        pendingOperations={[]}
        pendingWithdrawalOperations={[pendingWithdrawal]}
        isLoading={false}
        error={null}
        executionStatus={`Executing Withdrawal Policy operation ${pendingWithdrawal.operationId}.`}
        coreSupported
        onExecute={async () => undefined}
        onExecuteWithdrawal={async () => undefined}
      />,
    );

    expect(markup).toContain(pendingWithdrawal.operationId);
    expect(markup).toContain('345678');
    expect(markup).toContain('25.00 USDC');
    expect(markup).toContain('100.00 USDC');
    expect(markup).toContain('Executing Withdrawal Policy operation');
    expect(markup).toContain('Execute Withdrawal Policy');
    expect(markup).toContain('disabled=""');
  });
});
