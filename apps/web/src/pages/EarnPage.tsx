import { useTreasurySummary } from '../features/treasury/hooks/useTreasurySummary';
import { useTreasuryStrategyState } from '../features/treasury/hooks/useTreasuryStrategyState';
import { useTreasuryBucketTargets } from '../features/treasury/hooks/useTreasuryBucketTargets';
import { canViewAdminPanel } from '../features/treasury/access/adminAccess';
import { AdminStrategyProjection, YieldStrategySection } from '../features/treasury/components';

export function EarnPage() {
  const {
    summary,
    onChainPolicy,
    adminProjection,
    adminProjectionLoading,
    userProjection,
    userProjectionLoading,
    userProjectionError,
    userAuthenticationLoading,
    userAuthenticationError,
    isUserAuthenticated,
    isPolicyAdmin,
    refreshFinancialState,
  } = useTreasurySummary();

  const canViewAdmin = canViewAdminPanel(summary.isConnected, summary.isArcMainnet, isPolicyAdmin);
  const strategyState = useTreasuryStrategyState(
    summary.isConnected && !canViewAdmin,
    summary.isArcMainnet,
    isUserAuthenticated,
    summary.address,
  );
  const bucketState = useTreasuryBucketTargets(summary.isArcMainnet && canViewAdmin);

  return (
    <div className="vx-treasury-page">
      <header className="vx-page-header">
        <div className="vx-page-title-group">
          <h1>Earn / Yield</h1>
          <p>Explore earning opportunities and follow your Treasury activity.</p>
        </div>
        <div className="vx-page-action-group">
          <span className="vx-network-pill">
            <span
              className={`vx-dot ${
                summary.isConnected
                  ? summary.isArcMainnet
                    ? 'vx-dot-success'
                    : 'vx-dot-warning'
                  : 'vx-dot-muted'
              }`}
            />
            {summary.chainName ?? 'Arc Mainnet'}
          </span>
        </div>
      </header>

      <YieldStrategySection
        strategyState={null}
        coreState={null}
        userProjection={userProjection}
        userProjectionLoading={userProjectionLoading}
        userProjectionError={userProjectionError instanceof Error ? userProjectionError : null}
        bucketTargets={bucketState.targets}
        bucketTargetsLoading={bucketState.isLoading}
        bucketTargetsError={bucketState.error}
        onRetryBucketTargets={() => { void bucketState.refetch(); }}
        onRetryUserProjection={() => { void refreshFinancialState(); }}
        canViewAdmin={canViewAdmin}
        strategyUnavailableReason={strategyState.unavailableReason}
        userStrategyPosition={strategyState.position}
        userStrategyStatus={strategyState.strategyStatus}
        strategyLoading={strategyState.isLoading}
        strategyError={strategyState.error}
        isAuthenticated={isUserAuthenticated}
        authenticationLoading={userAuthenticationLoading}
        authenticationError={userAuthenticationError}
        onRetryStrategy={() => { void strategyState.refetch(); }}
      />
      {canViewAdmin && (
        <section className="vx-section" aria-labelledby="admin-strategy-projection-title">
          <div className="vx-section-header">
            <div className="vx-section-title-group">
              <h2 id="admin-strategy-projection-title">Admin Strategy Projection</h2>
              <p>System-wide strategy values read from the authorized Core projection.</p>
            </div>
          </div>
          {adminProjectionLoading
            ? <p className="vx-text-muted">Loading authorized strategy projection...</p>
            : adminProjection
              ? <AdminStrategyProjection projection={adminProjection} />
              : <p className="vx-text-muted">Authorized strategy projection unavailable.</p>}
        </section>
      )}
    </div>
  );
}
