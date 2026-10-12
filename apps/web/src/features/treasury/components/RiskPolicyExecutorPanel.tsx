import type { PendingRiskPolicy, PendingWithdrawalPolicy } from '../hooks/useTreasurySummary';
import { formatUSDC } from '../../usdc/services/usdcService';

interface RiskPolicyExecutorPanelProps {
  readonly pendingOperations: readonly PendingRiskPolicy[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly executionStatus: string | null;
  readonly coreSupported: boolean | null;
  readonly onExecute: (operation: PendingRiskPolicy) => Promise<unknown>;
  readonly pendingWithdrawalOperations: readonly PendingWithdrawalPolicy[];
  readonly onExecuteWithdrawal: (operation: PendingWithdrawalPolicy) => Promise<unknown>;
}

export function RiskPolicyExecutorPanel({
  pendingOperations,
  isLoading,
  error,
  executionStatus,
  coreSupported,
  onExecute,
  pendingWithdrawalOperations,
  onExecuteWithdrawal,
}: RiskPolicyExecutorPanelProps) {
  if (!isLoading && !error && pendingOperations.length === 0 && pendingWithdrawalOperations.length === 0 && !executionStatus) return null;

  return (
    <section className="vx-section" aria-labelledby="risk-policy-executor-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="risk-policy-executor-title">Pending Risk and Withdrawal Policy Operations</h2>
          <p>Pending operation details are loaded from Core TimelockScheduled events and pendingOperations.</p>
        </div>
      </div>

      {isLoading && <p role="status">Discovering scheduled Risk Policy operations from Core...</p>}
      {error && <div className="vx-step-callout warning" role="alert">{error.message}</div>}
      {pendingOperations.map((operation) => (
        <article key={operation.operationId} className="vx-step-callout info" style={{ marginBottom: '0.75rem' }}>
          <div><strong>Operation ID:</strong> <code>{operation.operationId}</code></div>
          <div><strong>ETA (Unix timestamp):</strong> {operation.eta.toString()}</div>
          <div><strong>Minimum liquid reserve:</strong> {formatUSDC(operation.policy.minimumLiquidReserve) ?? 'Unavailable'} USDC</div>
          <div><strong>Minimum liquid reserve ratio:</strong> {operation.policy.minimumLiquidReserveBps} BPS</div>
          <div><strong>Maximum total deployed:</strong> {formatUSDC(operation.policy.maximumTotalDeployed) ?? 'Unavailable'} USDC</div>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            style={{ marginTop: '0.75rem' }}
            disabled={coreSupported !== true || executionStatus?.startsWith('Executing Risk Policy operation') === true}
            onClick={() => { void onExecute(operation).catch(() => undefined); }}
          >
            Execute Risk Policy
          </button>
        </article>
      ))}
      {pendingWithdrawalOperations.map((operation) => (
        <article key={operation.operationId} className="vx-step-callout info" style={{ marginBottom: '0.75rem' }}>
          <div><strong>Operation ID:</strong> <code>{operation.operationId}</code></div>
          <div><strong>ETA (Unix timestamp):</strong> {operation.eta.toString()}</div>
          <div><strong>Maximum single withdrawal:</strong> {formatUSDC(operation.policy.maximumSingleWithdrawal) ?? 'Unavailable'} USDC</div>
          <div><strong>24-hour outflow cap:</strong> {formatUSDC(operation.policy.dailyOutflowCap) ?? 'Unavailable'} USDC</div>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            style={{ marginTop: '0.75rem' }}
            disabled={coreSupported !== true || executionStatus?.startsWith('Executing Withdrawal Policy operation') === true}
            onClick={() => { void onExecuteWithdrawal(operation).catch(() => undefined); }}
          >
            Execute Withdrawal Policy
          </button>
        </article>
      ))}
      {executionStatus && <div className="vx-step-callout info" role="status">{executionStatus}</div>}
    </section>
  );
}
