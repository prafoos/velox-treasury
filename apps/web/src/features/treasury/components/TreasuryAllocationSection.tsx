import type { TreasuryAllocationPolicy } from '../hooks/useTreasuryAllocationPolicy';

interface TreasuryAllocationSectionProps {
  readonly policy: TreasuryAllocationPolicy | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
}

function formatPercentage(value: bigint): string {
  const whole = value / 100n;
  const remainder = value % 100n;
  if (remainder === 0n) return `${whole}%`;
  return `${whole}.${remainder.toString().padStart(2, '0').replace(/0$/, '')}%`;
}

export function TreasuryAllocationSection({
  policy,
  isLoading,
  error,
  onRetry,
}: TreasuryAllocationSectionProps) {
  const allocations = policy
    ? [
        { label: 'Operational Reserve', value: policy.operationalReserveBps },
        { label: 'Yield Strategy', value: policy.yieldStrategyBps },
        { label: 'Liquidity Availability', value: policy.liquidityAvailabilityBps },
        { label: 'Automation & AI', value: policy.automationAndAiBps },
      ]
    : [];

  return (
    <section className="vx-section" aria-labelledby="treasury-allocation-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="treasury-allocation-title">Treasury Allocation</h2>
          <p>View the allocation percentages set by your Treasury administrator.</p>
        </div>
      </div>

      {isLoading ? (
        <p className="vx-text-muted" role="status">Loading allocation information…</p>
      ) : error ? (
        <div className="vx-step-callout warning" role="alert">
          <p>Allocation information could not be loaded. {error.message}</p>
          <button type="button" className="vx-btn vx-btn-outline" onClick={onRetry}>Retry</button>
        </div>
      ) : !policy ? (
        <p className="vx-text-muted" role="status">Allocation information is currently unavailable.</p>
      ) : (
        <>
          <div className="vx-allocation-grid">
            {allocations.map(({ label, value }) => (
              <article className="vx-allocation-card" key={label}>
                <div className="vx-allocation-top">
                  <span className="vx-allocation-name">{label}</span>
                  <span className="vx-allocation-pct">{formatPercentage(value)}</span>
                </div>
              </article>
            ))}
          </div>
          <p className="vx-text-muted">
            These percentages are set by your Treasury administrator and may change when the settings are updated. They do not represent the actual amount of money currently held in each category.
          </p>
        </>
      )}
    </section>
  );
}
