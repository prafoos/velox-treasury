import type { EmergencyControlModel } from '../types';

interface EmergencyRiskControlsProps {
  readonly emergency: EmergencyControlModel;
  readonly onOpenEmergency: () => void;
  readonly canViewAdmin: boolean;
}

export function EmergencyRiskControls({
  emergency,
  onOpenEmergency,
  canViewAdmin,
}: EmergencyRiskControlsProps) {
  if (!canViewAdmin) return null;

  return (
    <section className="vx-section" aria-labelledby="emergency-risk-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="emergency-risk-title">Risk Controls & Circuit Breakers</h2>
          <p>
            Local outflow previews are not enforced by the final Core. On-chain risk policy and pause state are read back separately.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="vx-stage-pill" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)' }}>
            Local Preview: {emergency.status.toUpperCase()}
          </span>
          <button
            type="button"
            className="vx-btn vx-btn-outline"
            onClick={onOpenEmergency}
            aria-label="Open emergency controls panel"
          >
            Emergency Controls
          </button>
        </div>
      </div>

      <div className="vx-risk-grid">
        {emergency.limits.map((limit) => (
          <div key={limit.id} className="vx-risk-card">
            <div className="vx-risk-card-label">{limit.label}</div>
            <div className="vx-risk-card-value">{limit.configuredValue}</div>
            <div className="vx-risk-card-desc">{limit.description}</div>
            <div style={{ marginTop: '0.5rem' }}>
              <span className="vx-stage-pill">
                {limit.status === 'active_boundary' ? 'Boundary Enforced' : 'Pre-Activation Preview'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="vx-step-callout info">
        <strong>Security Notice: </strong>
        {emergency.statusNotice}
      </div>
    </section>
  );
}
