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
  const statusMessage = strategyStatus?.reason === 'CORE_PAUSED'
    ? 'Temporarily paused: Treasury operations are paused, so new allocations cannot proceed.'
    : strategyStatus?.reason === 'STRATEGY_NOT_APPROVED'
      ? 'Temporarily paused: This strategy is not currently available for new allocations.'
      : strategyStatus?.reason === 'STRATEGY_DISABLED'
        ? 'Temporarily paused: This strategy is currently disabled for new allocations.'
        : strategyStatus?.reason === 'VALUATION_STALE'
          ? 'Temporarily paused: The strategy value needs to be refreshed before new allocations can be considered.'
          : strategyStatus?.reason === 'VALUATION_UNAVAILABLE'
            ? 'Temporarily paused: A current strategy value is unavailable, so allocation eligibility cannot be checked.'
            : strategyStatus?.reason === 'VALUATION_IMPAIRED'
              ? 'Temporarily paused: The strategy value needs review before new allocations can be considered.'
              : strategyStatus?.reason === 'APPROVED_ENABLED_NO_POSITION'
                ? 'A current strategy value is available. This does not confirm that an allocation is ready to proceed.'
                : strategyStatus?.reason === 'UNKNOWN'
                  ? 'Action required: Strategy eligibility could not be verified.'
                  : strategyStatus?.reason === 'POSITION_AVAILABLE'
                    ? 'Your earning position is verified.'
                    : null;
  const isStrategyPaused = strategyStatus !== null && strategyStatus !== undefined && [
    'CORE_PAUSED',
    'STRATEGY_NOT_APPROVED',
    'STRATEGY_DISABLED',
    'VALUATION_UNAVAILABLE',
    'VALUATION_STALE',
    'VALUATION_IMPAIRED',
  ].includes(strategyStatus.reason);
  let content;
  if (authenticationLoading) {
    content = <p className="vx-text-muted" role="status">Checking wallet sign-in…</p>;
  } else if (authenticationError) {
    content = <p className="vx-step-callout warning" role="alert">Wallet sign-in could not be verified. Please reconnect your wallet and try again.</p>;
  } else if (!isAuthenticated) {
    content = <p className="vx-text-muted" role="status">Sign in to view your Steakhouse position.</p>;
  } else if (isLoading) {
    content = <p className="vx-text-muted" role="status">Updating your earning position…</p>;
  } else if (error) {
    content = (
      <div className="vx-step-callout warning" role="alert">
        <p>Your earning position could not be updated. Please try again.</p>
        <button type="button" className="vx-btn vx-btn-outline" onClick={onRetry}>Retry</button>
      </div>
    );
  } else if (unavailableReason) {
    content = (
      <p className="vx-step-callout warning" role="status">
        Action required: Your earning position and allocation eligibility could not be verified.
      </p>
    );
  } else if (position?.status === 'NO_ACTIVE_POSITION' || position?.status === 'POSITION_AVAILABLE') {
    content = (
      <>
        {position.status === 'NO_ACTIVE_POSITION'
          ? (
            <>
              <p className="vx-text-muted" role="status">No active earning position.</p>
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
        {statusMessage && (
          <p className={isStrategyPaused || strategyStatus?.reason === 'UNKNOWN'
            ? 'vx-step-callout warning'
            : 'vx-text-muted'} role="status">
            {statusMessage}
          </p>
        )}
        {!strategyStatus && (
          <p className="vx-step-callout warning" role="status">
            Action required: Strategy eligibility could not be verified.
          </p>
        )}
        <p className="vx-text-muted">
          Recent allocation activity is not available in this view; this does not confirm that no attempts occurred.
        </p>
      </>
    );
  } else {
    content = <p className="vx-step-callout warning" role="status">Action required: Your earning position cannot currently be verified.</p>;
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
