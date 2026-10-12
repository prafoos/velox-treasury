import type { TreasuryPolicyModel } from '@velox/domain';

interface BucketPolicyLike {
  readonly liquidOperationalReserveBps?: bigint | number | string | null;
  readonly yieldStrategyBufferBps?: bigint | number | string | null;
  readonly sweepLiquidityBufferBps?: bigint | number | string | null;
  readonly automationAgentPoolBps?: bigint | number | string | null;
}

const BUCKETS = [
  { key: 'liquidOperationalReserveBps', label: 'Liquid Operational Reserve', draftKey: 'operational_reserve' },
  { key: 'yieldStrategyBufferBps', label: 'Yield Strategy Buffer', draftKey: 'yield_strategy' },
  { key: 'sweepLiquidityBufferBps', label: 'Sweep Liquidity Buffer', draftKey: 'swap_liquidity' },
  { key: 'automationAgentPoolBps', label: 'Automation / AI Agent Pool', draftKey: 'automation_agent' },
] as const;

function normalizeBps(value: bigint | number | string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return BigInt(value);
}

function formatBps(value: bigint | null): string {
  if (value === null) return 'Unavailable';
  return `${value.toString()} BPS`;
}

function formatDraftPercentage(value: bigint | null): string {
  if (value === null) return 'Draft';
  return `${(value / 100n).toString()}%`;
}

export interface BucketConfigurationPanelProps {
  readonly draftPolicy: TreasuryPolicyModel | null;
  readonly currentPolicy: BucketPolicyLike | null;
  readonly scheduledPolicy?: BucketPolicyLike | null;
  readonly scheduledOperationId?: string | null;
  readonly scheduledEta?: bigint | null;
  readonly pendingDiscoveryLoading?: boolean;
  readonly pendingDiscoveryError?: Error | null;
  readonly canViewAdmin?: boolean;
  readonly currentCoreSupported?: boolean | null;
  readonly supportCheckFailed?: boolean;
  readonly canExecuteBucketPolicy?: boolean;
  readonly onExecuteBucketPolicy?: () => Promise<unknown>;
  readonly executionStatus?: string | null;
}

export function BucketConfigurationPanel({
  draftPolicy,
  currentPolicy,
  scheduledPolicy,
  scheduledOperationId = null,
  scheduledEta = null,
  pendingDiscoveryLoading = false,
  pendingDiscoveryError = null,
  canViewAdmin = true,
  currentCoreSupported = false,
  supportCheckFailed = false,
  canExecuteBucketPolicy = false,
  onExecuteBucketPolicy,
  executionStatus = null,
}: BucketConfigurationPanelProps) {
  if (!canViewAdmin && !canExecuteBucketPolicy) return null;

  const draftAllocationTotal = draftPolicy
    ? Object.values(draftPolicy.allocations).reduce((sum, value) => sum + value, 0n)
    : 0n;
  const draftAllocations = draftAllocationTotal === 10_000n ? draftPolicy?.allocations ?? null : null;
  const policyReadyText = supportCheckFailed
    ? 'Unable to verify the configured Core policy and timelock interface. On-chain policy actions remain disabled.'
    : currentCoreSupported === null
    ? 'Checking the configured Core policy and timelock interface.'
    : currentCoreSupported
    ? 'Policy scheduling and execution are enabled for this supported Core contract.'
    : 'The current deployed Arc Mainnet Core does not expose the bucket-policy schedule/execute/reduce functions, so this configuration remains a final-Core-ready UI only.';

  return (
    <section className="vx-section" aria-labelledby="bucket-config-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="bucket-config-title">Bucket Configuration</h2>
          <p>Draft policy, live on-chain policy, and pending timelock state for the four Treasury allocation buckets.</p>
        </div>
        <span className="vx-stage-pill">{supportCheckFailed ? 'Core verification unavailable' : currentCoreSupported === null ? 'Checking Core' : currentCoreSupported ? 'Ready' : 'Current Core unsupported'}</span>
      </div>

      <div className="vx-step-callout info">{policyReadyText}</div>

      {currentCoreSupported === false && (
        <div className="vx-step-callout warning">
          Current deployed Core: scheduleBucketPolicy, executeBucketPolicy, and reduceBucketPolicy are not available in this deployment. The actions remain disabled and no transaction is sent.
        </div>
      )}

      <div className="vx-allocation-grid" style={{ marginTop: '1rem' }}>
        {BUCKETS.map(({ key, label, draftKey }) => {
          const currentValue = normalizeBps(currentPolicy?.[key] ?? null);
          const scheduledValue = normalizeBps(scheduledPolicy?.[key] ?? null);
          const draftValue = draftAllocations ? draftAllocations[draftKey] ?? null : null;
          const hasDraft = draftValue !== null;
          const statusLabel = currentValue !== null
            ? currentValue > 0n
              ? 'Active'
              : '0% active'
            : scheduledValue !== null
              ? 'Pending execution'
                  : supportCheckFailed
                    ? 'Core support unavailable'
                  : currentCoreSupported === null
                    ? 'Checking Core support'
                  : hasDraft
                ? 'Draft'
                : 'Unavailable on current Core';

          return (
            <article key={label} className="vx-allocation-card">
              <div className="vx-allocation-top">
                <div className="vx-allocation-name">{label}</div>
                <div className="vx-allocation-pct">{formatDraftPercentage(draftValue)}</div>
              </div>

              <div className="vx-allocation-desc">
                <strong>Current on-chain policy:</strong> {currentValue === null ? 'Unavailable on current Core' : formatBps(currentValue)}
              </div>
              <div className="vx-allocation-desc">
                <strong>Draft policy:</strong> {hasDraft ? `${(draftValue / 100n).toString()}%` : 'Unavailable / no complete draft'}
              </div>
              <div className="vx-allocation-desc">
                <strong>Scheduled / pending:</strong> {scheduledValue === null ? 'No scheduled policy' : formatBps(scheduledValue)}
                {scheduledValue !== null && scheduledEta !== null ? ` · ETA ${scheduledEta.toString()}` : ''}
              </div>

              <div className="vx-allocation-bottom">
                <span className="vx-stage-pill">{statusLabel}</span>
                <span className="vx-text-muted">
                  {supportCheckFailed ? 'Core support could not be verified' : currentCoreSupported === null ? 'Checking configured Core' : currentCoreSupported ? 'Action enabled for supported Core' : 'Action disabled on current live Core'}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {scheduledPolicy && (
        <div className="vx-step-callout info" role="status">
          {scheduledOperationId && <div><strong>Pending operation ID:</strong> <code>{scheduledOperationId}</code></div>}
          Pending BucketPolicy operation ETA: {scheduledEta === null ? 'Unavailable' : scheduledEta.toString()}
          {canExecuteBucketPolicy && onExecuteBucketPolicy && (
            <button
              type="button"
              className="vx-btn vx-btn-primary"
              style={{ marginLeft: '1rem' }}
              disabled={currentCoreSupported !== true || executionStatus === 'Executing pending BucketPolicy operation.'}
              onClick={() => { void onExecuteBucketPolicy().catch(() => undefined); }}
            >
              Execute scheduled bucket policy
            </button>
          )}
        </div>
      )}
      {!canViewAdmin && !scheduledPolicy && pendingDiscoveryLoading && (
        <div className="vx-step-callout info" role="status">Discovering pending Bucket Policy operations from Core...</div>
      )}
      {pendingDiscoveryError && (
        <div className="vx-step-callout warning" role="alert">
          Pending Bucket Policy status is unavailable because Core event/getter verification failed: {pendingDiscoveryError.message}
        </div>
      )}
      {!canViewAdmin && !scheduledPolicy && !pendingDiscoveryLoading && !pendingDiscoveryError && (
        <div className="vx-step-callout info" role="status">
          No pending Bucket Policy operation was found in Core TimelockScheduled events and pendingOperations.
        </div>
      )}
      {executionStatus && <div className="vx-step-callout info" role="status">{executionStatus}</div>}

      <div className="vx-yield-note" style={{ marginTop: '1rem' }}>
        Risk-increasing bucket changes are scheduled through the contract timelock flow. Risk-reducing changes follow the immediate reduction path allowed by the deployed Core contract. This panel does not trigger allocation or apply policy by itself.
      </div>
    </section>
  );
}
