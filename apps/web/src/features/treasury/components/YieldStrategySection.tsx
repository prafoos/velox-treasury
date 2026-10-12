import { formatUSDC } from '../../usdc/services/usdcService';
import type { TreasuryStrategyState, UserStrategyPosition, UserStrategyStatus } from '../hooks/useTreasuryStrategyState';
import type { TreasuryBucketTargetState } from '../hooks/useTreasuryBucketTargets';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';
import { UserEarningPosition } from './UserEarningPosition';

export interface YieldStrategySectionProps {
  readonly strategyState: TreasuryStrategyState | null;
  readonly coreState: {
    readonly userFinancialState?: {
      readonly principal: bigint;
      readonly currentValue: bigint;
      readonly unrealizedPnl: bigint;
      readonly realizedPnl: bigint;
      readonly totalPnl: bigint;
      readonly immediatelyWithdrawableValue: bigint | null;
    } | null;
    readonly liquidUSDC: bigint;
    readonly requiredLiquidReserve: bigint;
    readonly availableLiquidity: bigint;
    readonly totalDeployed: bigint;
    readonly totalManagedAssets: bigint;
    readonly minimumLiquidReserve?: bigint | null;
    readonly maximumTotalDeployed?: bigint | null;
    readonly yieldStrategyBufferCapacity?: bigint | null;
    readonly bucketPolicy?: {
      readonly yieldStrategyBufferBps?: bigint | null;
      readonly liquidOperationalReserveBps?: bigint | null;
      readonly sweepLiquidityBufferBps?: bigint | null;
      readonly automationAgentPoolBps?: bigint | null;
    };
    readonly blockNumber?: bigint | null;
  } | null;
  readonly userProjection: UserFinancialProjectionModel | null;
  readonly userProjectionLoading?: boolean;
  readonly userProjectionError?: Error | null;
  readonly onRetryUserProjection?: () => void;
  readonly bucketTargets?: TreasuryBucketTargetState | null;
  readonly bucketTargetsLoading?: boolean;
  readonly bucketTargetsError?: Error | null;
  readonly onRetryBucketTargets?: () => void;
  readonly canViewAdmin: boolean;
  readonly strategyUnavailableReason?: string | null;
  readonly userStrategyPosition?: UserStrategyPosition | null;
  readonly userStrategyStatus?: UserStrategyStatus | null;
  readonly strategyLoading?: boolean;
  readonly strategyError?: Error | null;
  readonly isAuthenticated?: boolean;
  readonly authenticationLoading?: boolean;
  readonly authenticationError?: Error | null;
  readonly onRetryStrategy?: () => void;
}

function formatSigned(value: bigint | null, canViewAdmin: boolean, unavailableText?: string): string {
  if (value === null) return unavailableText ?? (canViewAdmin ? 'Unavailable' : '—');
  if (value === 0n) return '0.00 USDC';
  const abs = value < 0n ? -value : value;
  const sign = value < 0n ? '-' : '+';
  return `${sign}${formatUSDC(abs) ?? '0.00'} USDC`;
}

function formatAmount(value: bigint | null, canViewAdmin = true, unavailableText?: string): string {
  return value === null
    ? unavailableText ?? (canViewAdmin ? 'Unavailable' : '—')
    : `${formatUSDC(value) ?? '0.00'} USDC`;
}

function formatCompactAddress(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getStrategyStatus(strategyState: TreasuryStrategyState | null): string {
  if (!strategyState) return 'Strategy unavailable';

  const statusParts: string[] = [];
  if (strategyState.approved) statusParts.push('Approved');
  else statusParts.push('Not Approved');

  if (strategyState.enabled) statusParts.push('Enabled');
  else statusParts.push('Disabled');

  if (strategyState.principal === 0n && strategyState.currentValue === 0n && strategyState.shares === 0n) {
    statusParts.push('Not Funded');
  } else {
    statusParts.push('Funded');
  }

  return statusParts.join(' / ');
}

function getValuationStatus(strategyState: TreasuryStrategyState | null): string {
  if (!strategyState) return 'Valuation Unavailable';

  switch (strategyState.valuationStatusLabel) {
    case 'current':
      return 'Valuation Current';
    case 'stale':
      return 'Valuation Stale';
    case 'unavailable':
      return 'Valuation Unavailable';
    case 'impaired':
      return 'Valuation Impaired';
    default:
      return 'Valuation Unknown';
  }
}

function getTotalPnl(strategyState: TreasuryStrategyState | null): bigint | null {
  if (!strategyState) return null;

  const realizedDelta = strategyState.realizedYield - strategyState.realizedLoss;
  const unrealizedDelta = strategyState.unrealizedYield - strategyState.unrealizedLoss;
  return realizedDelta + unrealizedDelta;
}

function formatBpsPercentage(value: bigint | null | undefined): string {
  if (value == null) return 'Unavailable';
  const whole = value / 100n;
  const fraction = value % 100n;
  if (fraction === 0n) return `${whole}%`;
  const decimal = fraction.toString().padStart(2, '0').replace(/0$/, '');
  return `${whole}.${decimal}%`;
}

export function YieldStrategySection({
  strategyState: providedStrategyState,
  coreState,
  userProjection,
  userProjectionLoading = false,
  userProjectionError = null,
  onRetryUserProjection,
  bucketTargets: bucketTargetState = null,
  bucketTargetsLoading = false,
  bucketTargetsError = null,
  onRetryBucketTargets,
  canViewAdmin,
  strategyUnavailableReason,
  userStrategyPosition = null,
  userStrategyStatus = null,
  strategyLoading = false,
  strategyError = null,
  isAuthenticated = false,
  authenticationLoading = false,
  authenticationError = null,
  onRetryStrategy = () => undefined,
}: YieldStrategySectionProps) {
  const strategyState = canViewAdmin ? providedStrategyState : null;
  const yieldStrategyBufferBps = coreState?.bucketPolicy?.yieldStrategyBufferBps ?? null;
  const yieldStrategyBufferCapacity = coreState?.yieldStrategyBufferCapacity ?? null;
  const currentlyDeployed = strategyState?.totalDeployed ?? coreState?.totalDeployed ?? null;
  const remainingBuffer = yieldStrategyBufferCapacity === null || currentlyDeployed === null
    ? null
    : yieldStrategyBufferCapacity > currentlyDeployed ? yieldStrategyBufferCapacity - currentlyDeployed : 0n;
  const strategyExposure = strategyState?.currentValue ?? null;
  const allowedCapacity = strategyState?.absoluteCap ?? null;
  const exposureRemaining = allowedCapacity === null || strategyExposure === null
    ? null
    : allowedCapacity > strategyExposure ? allowedCapacity - strategyExposure : 0n;
  const userFinancialState = userProjection?.treasuryFinancialState ?? null;
  const userFinancialStateLoading = authenticationLoading || (isAuthenticated && userProjectionLoading);
  const userFinancialStateUnavailableText = userFinancialStateLoading
    ? 'Loading…'
    : isAuthenticated && userProjectionError
      ? 'Unavailable'
      : undefined;
  const immediateWithdrawalLiquidity = userProjection?.immediateWithdrawalLiquidity;
  const totalPnl = getTotalPnl(strategyState);
  const strategyStatus = getStrategyStatus(strategyState);
  const valuationStatus = getValuationStatus(strategyState);
  const showAdminStrategyDetails = Boolean(canViewAdmin && strategyState);
  const showSystemWideYieldMetrics = canViewAdmin;
  const buckets = [
    { label: 'Liquid Operational Reserve', bps: bucketTargetState?.liquidOperationalReserveBps, value: bucketTargetState?.liquidOperationalReserve },
    { label: 'Yield Strategy Buffer', bps: bucketTargetState?.yieldStrategyBufferBps, value: bucketTargetState?.yieldStrategyBuffer },
    { label: 'Sweep Liquidity Buffer', bps: bucketTargetState?.sweepLiquidityBufferBps, value: bucketTargetState?.sweepLiquidityBuffer },
    { label: 'Automation / AI Agent Pool', bps: bucketTargetState?.automationAgentPoolBps, value: bucketTargetState?.automationAgentPool },
  ] as const;

  return (
    <section className="vx-yield-section vx-section" aria-labelledby="yield-strategy-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="yield-strategy-title">Yield / Earn</h2>
          <p>Your Treasury balance and earning activity.</p>
        </div>
        {canViewAdmin && <span className="vx-stage-pill">{valuationStatus}</span>}
      </div>

      {!canViewAdmin && userFinancialStateLoading && (
        <p className="vx-text-muted" role="status">Loading your Treasury financial data…</p>
      )}
      {!canViewAdmin && !userFinancialStateLoading && !isAuthenticated && !authenticationError && !userProjection && (
        <p className="vx-text-muted" role="status">User-specific Treasury financial data is unavailable until wallet sign-in is verified.</p>
      )}
      {!canViewAdmin && isAuthenticated && userProjectionError && (
        <div className="vx-step-callout warning" role="alert">
          <p>Your Treasury financial data is temporarily unavailable. {userProjectionError.message}</p>
          {onRetryUserProjection && (
            <button type="button" className="vx-btn vx-btn-outline" onClick={onRetryUserProjection}>
              Retry
            </button>
          )}
        </div>
      )}

      <div className="vx-yield-summary-grid">
        <div className="vx-yield-metric highlight">
          <span className="vx-card-label">Current Value</span>
          <strong>{formatAmount(userFinancialState?.currentValue ?? null, canViewAdmin, userFinancialStateUnavailableText)}</strong>
        </div>
        <div className="vx-yield-metric">
          <span className="vx-card-label">Principal</span>
          <strong>{formatAmount(userFinancialState?.principal ?? null, canViewAdmin, userFinancialStateUnavailableText)}</strong>
        </div>
        <div className="vx-yield-metric">
          <span className="vx-card-label">Unrealized P/L</span>
          <strong>{formatSigned(userFinancialState?.unrealizedPnl ?? null, canViewAdmin, userFinancialStateUnavailableText)}</strong>
        </div>
        <div className="vx-yield-metric">
          <span className="vx-card-label">Realized P/L</span>
          <strong>{formatSigned(userFinancialState?.realizedPnl ?? null, canViewAdmin, userFinancialStateUnavailableText)}</strong>
        </div>
        <div className="vx-yield-metric">
          <span className="vx-card-label">Total P/L</span>
          <strong>{formatSigned(userFinancialState?.totalPnl ?? null, canViewAdmin, userFinancialStateUnavailableText)}</strong>
        </div>
        <div className="vx-yield-metric">
          <span className="vx-card-label">Immediately Withdrawable</span>
          <strong>{formatAmount(immediateWithdrawalLiquidity?.value ?? null, canViewAdmin)}</strong>
          <small>{immediateWithdrawalLiquidity?.status === 'PAUSED'
            ? canViewAdmin ? 'Unavailable while paused' : 'Withdrawals are temporarily unavailable.'
            : immediateWithdrawalLiquidity?.status === 'CONSTRAINED'
              ? canViewAdmin ? 'Idle USDC after reserve; strategy NAV excluded' : 'Some funds may not be available for immediate withdrawal.'
              : immediateWithdrawalLiquidity?.status === 'UNAVAILABLE' || !immediateWithdrawalLiquidity || immediateWithdrawalLiquidity.value === null
                ? canViewAdmin ? 'Unavailable' : 'Not available yet'
                : immediateWithdrawalLiquidity.value === 0n
                  ? canViewAdmin ? 'No funds currently available' : 'No funds are currently available to withdraw.'
                : 'Available to withdraw'}</small>
          {!canViewAdmin && immediateWithdrawalLiquidity?.status === 'PAUSED' && (
            <small>Withdrawals are temporarily unavailable.</small>
          )}
        </div>
      </div>

      {canViewAdmin && <section className="vx-yield-card vx-yield-card-wide vx-yield-buckets" aria-labelledby="treasury-bucket-targets-title">
        <div className="vx-yield-card-header">
          <h3 id="treasury-bucket-targets-title">Treasury Bucket Targets</h3>
          <span className="vx-status-badge neutral">Policy targets</span>
        </div>
        {bucketTargetsLoading ? (
          <p className="vx-text-muted" role="status">Loading live Core bucket targets…</p>
        ) : bucketTargetsError ? (
          <p className="vx-step-callout warning" role="alert">
            Live Core bucket targets are unavailable: {bucketTargetsError.message}
            {onRetryBucketTargets && (
              <button type="button" className="vx-btn vx-btn-outline" onClick={onRetryBucketTargets}>Retry</button>
            )}
          </p>
        ) : !bucketTargetState ? (
          <p className="vx-text-muted" role="status">Live Core bucket targets are unavailable until Arc Mainnet is connected.</p>
        ) : (
          <>
            <div className="vx-allocation-grid">
              {buckets.map(({ label, bps, value }) => (
                <article className="vx-allocation-card" key={label}>
                  <div className="vx-allocation-top">
                    <div className="vx-allocation-name">{label}</div>
                    <div className="vx-allocation-pct">{formatBpsPercentage(bps)}</div>
                  </div>
                  <div className="vx-allocation-desc">
                    <strong>Core-calculated target:</strong> {formatAmount(value ?? null, false, 'Unavailable')}
                  </div>
                </article>
              ))}
            </div>
            <div className="vx-yield-status-grid vx-yield-bucket-status">
              <div className="vx-yield-status-item">
                <span className="vx-card-label">Core-wide managed assets (all users)</span>
                <strong>{formatAmount(bucketTargetState.totalManagedAssets, false, 'Unavailable')}</strong>
              </div>
              <div className="vx-yield-status-item">
                <span className="vx-card-label">Core-wide deployed to strategies</span>
                <strong>{formatAmount(bucketTargetState.totalDeployed, false, 'Unavailable')}</strong>
              </div>
            </div>
            {bucketTargetState.totalDeployed === 0n && (
              <p className="vx-text-muted" role="status">No funds are currently deployed to a strategy.</p>
            )}
            <p className="vx-text-muted">Core-wide snapshot block: {bucketTargetState.blockNumber.toString()}</p>
            <p className="vx-yield-note">
              These global Core policy targets/accounting classifications are calculated from all users’ managed assets. They are not your personal balance; percentages do not represent separate transfers or deployed positions.
            </p>
          </>
        )}
      </section>}

      <div className="vx-yield-layout">
        <div className="vx-yield-column">
          {!canViewAdmin ? (
            <UserEarningPosition
              position={userStrategyPosition}
              strategyStatus={userStrategyStatus}
              unavailableReason={strategyUnavailableReason}
              isLoading={strategyLoading}
              error={strategyError}
              isAuthenticated={isAuthenticated}
              authenticationLoading={authenticationLoading}
              authenticationError={authenticationError}
              onRetry={onRetryStrategy}
            />
          ) : (
          <div className="vx-yield-card">
            <div className="vx-yield-card-header">
              <h3>Strategy Accounting</h3>
              <span className="vx-status-badge neutral">Unavailable</span>
            </div>

            <div className="vx-yield-status-grid">
              <div className="vx-yield-status-item">
                <span className="vx-card-label">Valuation</span>
                <strong>Unavailable</strong>
              </div>
              <div className="vx-yield-status-item">
                <span className="vx-card-label">Position</span>
                <strong>Unavailable</strong>
              </div>
              <div className="vx-yield-status-item">
                <span className="vx-card-label">Shares</span>
                <strong>Unavailable</strong>
              </div>
              <div className="vx-yield-status-item">
                <span className="vx-card-label">Valuation Block</span>
                <strong>Unavailable</strong>
              </div>
              <div className="vx-yield-status-item">
                <span className="vx-card-label">User strategy position</span>
                <strong>Unavailable</strong>
              </div>
            </div>
            <p className="vx-text-muted">{strategyUnavailableReason ?? 'Per-user strategy accounting is not available.'} Shared strategy totals are not shown as user values.</p>
          </div>
          )}

          {showSystemWideYieldMetrics && (
            <>
              <div className="vx-yield-card">
                <div className="vx-yield-card-header">
                  <h3>Yield Strategy Buffer</h3>
                </div>
                <div className="vx-yield-metrics-list">
                  <div className="vx-metric-row"><span>Buffer capacity</span><strong>{yieldStrategyBufferCapacity === null ? 'Unavailable' : formatAmount(yieldStrategyBufferCapacity, canViewAdmin)}</strong></div>
                  <div className="vx-metric-row"><span>Currently used / deployed</span><strong>{formatAmount(currentlyDeployed, canViewAdmin)}</strong></div>
                  <div className="vx-metric-row"><span>Remaining capacity</span><strong>{remainingBuffer === null ? 'Unavailable' : formatAmount(remainingBuffer, canViewAdmin)}</strong></div>
                  <div className="vx-metric-row"><span>Policy buffer BPS</span><strong>{yieldStrategyBufferBps === null ? 'Unavailable' : `${yieldStrategyBufferBps.toString()} BPS`}</strong></div>
                </div>
              </div>

              <div className="vx-yield-card vx-yield-card-wide">
                <div className="vx-yield-card-header">
                  <h3>Liquidity / Withdrawal</h3>
                </div>
                <div className="vx-yield-metrics-list">
                  <div className="vx-metric-row"><span>Liquid USDC</span><strong>{formatAmount(coreState?.liquidUSDC ?? null, canViewAdmin)}</strong></div>
                  <div className="vx-metric-row"><span>Required liquid reserve</span><strong>{formatAmount(coreState?.requiredLiquidReserve ?? null, canViewAdmin)}</strong></div>
                  <div className="vx-metric-row"><span>Available liquidity</span><strong>{formatAmount(coreState?.availableLiquidity ?? null, canViewAdmin)}</strong></div>
                  <div className="vx-metric-row"><span>Withdrawal shortfall</span><strong>{strategyState ? formatAmount(strategyState.withdrawalShortfall, canViewAdmin) : 'Unavailable'}</strong></div>
                  <div className="vx-metric-row"><span>Unwind required</span><strong>{strategyState ? strategyState.withdrawalShortfall > 0n ? 'Yes' : 'No' : 'Unavailable'}</strong></div>
                </div>
              </div>
            </>
          )}
        </div>

        {showAdminStrategyDetails && (
          <div className="vx-yield-column">
            <div className="vx-yield-card admin">
              <div className="vx-yield-card-header">
                <h3>Strategy Details</h3>
              </div>
              <div className="vx-yield-metrics-list">
                <div className="vx-metric-row"><span>Strategy</span><strong>{strategyState ? strategyState.strategyLabel : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Protocol</span><strong>{strategyState ? strategyState.protocolLabel : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Asset</span><strong>{strategyState ? strategyState.asset : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Protocol ID</span><strong>{strategyState ? formatCompactAddress(strategyState.protocol) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Strategy address</span><strong>{strategyState ? formatCompactAddress(strategyState.strategyAddress) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Adapter address</span><strong>{strategyState ? formatCompactAddress(strategyState.strategyAddress) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Vault / asset</span><strong>{strategyState ? formatCompactAddress(strategyState.asset) : 'Unavailable'}</strong></div>
              </div>
            </div>

            <div className="vx-yield-card admin">
              <div className="vx-yield-card-header">
                <h3>Strategy Financial Data</h3>
              </div>
              <div className="vx-yield-metrics-list">
                <div className="vx-metric-row"><span>Principal</span><strong>{strategyState ? formatAmount(strategyState.principal) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Current value</span><strong>{strategyState ? formatAmount(strategyState.currentValue) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Shares</span><strong>{strategyState ? strategyState.shares.toString() : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Realized yield</span><strong>{strategyState ? formatAmount(strategyState.realizedYield) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Realized loss</span><strong>{strategyState ? formatAmount(strategyState.realizedLoss) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Unrealized yield</span><strong>{strategyState ? formatAmount(strategyState.unrealizedYield) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Unrealized loss</span><strong>{strategyState ? formatAmount(strategyState.unrealizedLoss) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Fees accrued</span><strong>{strategyState ? formatAmount(strategyState.feesAccrued) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Valuation Source</span><strong>{strategyState ? formatCompactAddress(strategyState.valuationSource) : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Valuation Block</span><strong>{strategyState ? strategyState.valuationBlock.toString() : 'Unavailable'}</strong></div>
                <div className="vx-metric-row"><span>Valuation Status</span><strong>{strategyState ? valuationStatus : 'Unavailable'}</strong></div>
              </div>
            </div>

            {canViewAdmin && strategyState && (
              <div className="vx-yield-card admin">
                <div className="vx-yield-card-header">
                  <h3>Admin Yield View</h3>
                  <span className="vx-status-badge neutral">Protected</span>
                </div>

                <div className="vx-yield-metrics-list">
                  <div className="vx-metric-row"><span>Total deployed</span><strong>{formatAmount(coreState?.totalDeployed ?? null)}</strong></div>
                  <div className="vx-metric-row"><span>Strategy principal</span><strong>{formatAmount(strategyState.principal)}</strong></div>
                  <div className="vx-metric-row"><span>Strategy current value</span><strong>{formatAmount(strategyState.currentValue)}</strong></div>
                  <div className="vx-metric-row"><span>Strategy approved</span><strong>{strategyState.approved ? 'Yes' : 'No'}</strong></div>
                  <div className="vx-metric-row"><span>Strategy enabled</span><strong>{strategyState.enabled ? 'Yes' : 'No'}</strong></div>
                  <div className="vx-metric-row"><span>Absolute cap</span><strong>{formatAmount(strategyState.absoluteCap)}</strong></div>
                  <div className="vx-metric-row"><span>Relative cap</span><strong>{strategyState.relativeCapBps.toString()} BPS</strong></div>
                  <div className="vx-metric-row"><span>Current Strategy Exposure</span><strong>{formatAmount(strategyExposure)}</strong></div>
                  <div className="vx-metric-row"><span>Allowed Strategy Capacity</span><strong>{allowedCapacity === null ? 'Unavailable' : formatAmount(allowedCapacity)}</strong></div>
                  <div className="vx-metric-row"><span>Remaining capacity</span><strong>{exposureRemaining === null ? 'Unavailable' : formatAmount(exposureRemaining)}</strong></div>
                  <div className="vx-metric-row"><span>Yield Strategy Buffer Capacity</span><strong>{yieldStrategyBufferCapacity === null ? 'Unavailable' : formatAmount(yieldStrategyBufferCapacity)}</strong></div>
                  <div className="vx-metric-row"><span>Total managed assets (liquid + deployed)</span><strong>{formatAmount(coreState?.totalManagedAssets ?? null)}</strong></div>
                  <div className="vx-metric-row"><span>Liquidity reserve</span><strong>{formatAmount(coreState?.requiredLiquidReserve ?? null)}</strong></div>
                  <div className="vx-metric-row"><span>Valuation Source</span><strong>{formatCompactAddress(strategyState.valuationSource)}</strong></div>
                  <div className="vx-metric-row"><span>Valuation Block</span><strong>{strategyState.valuationBlock.toString()}</strong></div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {canViewAdmin && (
        <div className="vx-yield-note">
          Historical charting requires authoritative time-series API/indexer support; the current Treasury API does not expose a verified historical yield series.
        </div>
      )}
    </section>
  );
}
