import { formatUSDC } from '../../usdc/services/usdcService';
import type { UserStrategyPosition, UserStrategyStatus } from '../hooks/useTreasuryStrategyState';

export interface UserEarningPositionProps {
  readonly position: UserStrategyPosition | null;
  readonly strategyStatus?: UserStrategyStatus | null;
  readonly unavailableReason?: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly isAuthenticated: boolean;
  readonly authenticationLoading: boolean;
  readonly authenticationError?: Error | null;
  readonly onRetry: () => void;
}

export function UserEarningPosition({
  position,
  strategyStatus,
  unavailableReason,
  isLoading,
  error,
  isAuthenticated,
  authenticationLoading,
  authenticationError,
  onRetry,
}: UserEarningPositionProps) {
  let content;
  if (authenticationLoading) {
    content = <p className="vx-text-muted" role="status">Checking wallet sign-in…</p>;
  } else if (authenticationError) {
    content = <p className="vx-step-callout warning" role="alert">Wallet sign-in could not be verified. {authenticationError.message}</p>;
  } else if (!isAuthenticated) {
    content = <p className="vx-text-muted" role="status">Sign in to view your Steakhouse position.</p>;
  } else if (isLoading) {
    content = <p className="vx-text-muted" role="status">Loading your Steakhouse position…</p>;
  } else if (error) {
    content = (
      <div className="vx-step-callout warning" role="alert">
        <p>Unable to read your Steakhouse position. {error.message}</p>
        <button type="button" className="vx-btn vx-btn-outline" onClick={onRetry}>Retry</button>
      </div>
    );
  } else if (unavailableReason) {
    content = <p className="vx-text-muted" role="status">User-specific Steakhouse position data cannot currently be retrieved: {unavailableReason}</p>;
  } else if (position?.status === 'NO_ACTIVE_POSITION' || position?.status === 'POSITION_AVAILABLE') {
    const reasonText = strategyStatus?.reason === 'CORE_PAUSED'
      ? 'New strategy operations are blocked while the Core is paused.'
      : strategyStatus?.reason === 'STRATEGY_NOT_APPROVED'
        ? 'The strategy is not approved.'
        : strategyStatus?.reason === 'STRATEGY_DISABLED'
          ? 'The strategy is approved but disabled.'
          : strategyStatus?.reason === 'VALUATION_STALE'
            ? `New allocations are blocked because the strategy valuation is stale (last valuation: Core block ${strategyStatus.valuationBlock.toString()}; verified at block ${strategyStatus.verifiedAtBlock.toString()}).`
            : strategyStatus?.reason === 'VALUATION_UNAVAILABLE'
              ? 'A current strategy valuation is unavailable, so allocation eligibility cannot be verified.'
              : strategyStatus?.reason === 'VALUATION_IMPAIRED'
                ? 'The Core reports an impaired strategy valuation.'
                : strategyStatus?.reason === 'APPROVED_ENABLED_NO_POSITION'
                  ? 'The strategy is approved and enabled, but no funds are currently recorded as allocated for this wallet.'
                  : null;
    content = (
      <>
        {position.status === 'NO_ACTIVE_POSITION'
          ? (
            <>
              <p className="vx-text-muted" role="status">No active Steakhouse position exists for this wallet.</p>
              {strategyStatus && (
                <div className="vx-metric-row">
                  <span>Your verified Steakhouse position value</span>
                  <strong>{formatUSDC(strategyStatus.positionValue)} USDC</strong>
                </div>
              )}
            </>
          )
          : (
            <div className="vx-yield-metrics-list">
              <div className="vx-metric-row">
                <span>Your Steakhouse position</span>
                <strong>{formatUSDC(position.currentValue)} USDC</strong>
              </div>
            </div>
          )}
        {strategyStatus && (
          <div className="vx-yield-metrics-list">
            <div className="vx-metric-row">
              <span>Strategy approved / enabled</span>
              <strong>{strategyStatus.approved ? 'Yes' : 'No'} / {strategyStatus.enabled ? 'Yes' : 'No'}</strong>
            </div>
            <div className="vx-metric-row">
              <span>Strategy valuation</span>
              <strong>{strategyStatus.valuationStatus}</strong>
            </div>
          </div>
        )}
        {reasonText && <p className="vx-text-muted" role="status">{reasonText}</p>}
        {strategyStatus && <p className="vx-text-muted">Strategy status verified at Core block {strategyStatus.verifiedAtBlock.toString()}. Allocation attempt history is not recorded here.</p>}
      </>
    );
  } else {
    content = <p className="vx-text-muted" role="status">User-specific Steakhouse position data cannot currently be retrieved.</p>;
  }

  return (
    <div className="vx-yield-card">
      <div className="vx-yield-card-header">
        <h3>Earning position</h3>
      </div>
      {content}
    </div>
  );
}
