import type { TreasuryAllocationModel } from '../types';
import { formatPercentageBps } from '../services/policyService';

interface TreasuryAllocationOverviewProps {
  readonly allocations: TreasuryAllocationModel;
  readonly canViewAdmin?: boolean;
}

export function TreasuryAllocationOverview({ allocations, canViewAdmin = false }: TreasuryAllocationOverviewProps) {
  if (!canViewAdmin) return null;
  const showSystemWideAllocationValues = canViewAdmin;

  return (
    <section className="vx-section" aria-labelledby="allocation-overview-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="allocation-overview-title">Treasury Allocation Framework</h2>
          <p>
            Percentages are accounting-policy targets, not separate funded pools. Depositing USDC does not transfer funds between buckets; strategy deployment is a separate role-gated operation. Dollar targets and current liquid classifications are separate Core values.
          </p>
        </div>
        <div>
          <span className="vx-stage-pill">
            {allocations.statusMessage}
          </span>
        </div>
      </div>

      <div className="vx-allocation-grid">
        {allocations.buckets.map((bucket) => (
          <div key={bucket.id} className="vx-allocation-card">
            <div>
              <div className="vx-allocation-top">
                <span className="vx-allocation-name">{bucket.name}</span>
                {showSystemWideAllocationValues && (
                  <span className="vx-allocation-pct">
                    Accounting target: {bucket.targetPercentageBps === null ? 'Unavailable' : `${formatPercentageBps(bucket.targetPercentageBps)}%`}
                  </span>
                )}
              </div>
              <p className="vx-allocation-desc">{bucket.description}</p>
            </div>

            <div>
              {showSystemWideAllocationValues && (
                <>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--vx-text-muted)' }}>
                      Core bucket target:{' '}
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--vx-text-secondary)' }}>
                      {bucket.targetAmount ?? 'Unavailable'}
                    </span>
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--vx-text-muted)' }}>Current liquid classification: </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--vx-text-secondary)' }}>{bucket.currentAmount ?? 'Unavailable'}</span>
                  </div>
                </>
              )}

              <div className="vx-allocation-bottom">
                <span style={{ textTransform: 'capitalize', color: 'var(--vx-text-secondary)' }}>
                  Status: {bucket.status}
                </span>
                <span className="vx-stage-pill">{bucket.targetStage}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
