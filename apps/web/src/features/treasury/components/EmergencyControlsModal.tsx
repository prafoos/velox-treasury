import type { EmergencyControlModel } from '../types';

interface EmergencyControlsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly emergency: EmergencyControlModel;
}

export function EmergencyControlsModal({
  isOpen,
  onClose,
  emergency,
}: EmergencyControlsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="vx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-modal-title"
    >
      <div className="vx-modal-dialog" style={{ maxWidth: '600px' }}>
        <div className="vx-modal-header">
          <h3 id="emergency-modal-title" className="vx-modal-title">
            Emergency & Risk Boundary Controls
          </h3>
          <button
            type="button"
            className="vx-modal-close-btn"
            onClick={onClose}
            aria-label="Close emergency controls modal"
          >
            ✕
          </button>
        </div>

        <div className="vx-modal-body">
          <div className="vx-step-callout warning">
            <strong>On-chain boundary:</strong> VeloxTreasuryCore enforces its emergency pause on deposits,
            withdrawals, allocations, and timelocked policy execution. This panel does not submit pause
            transactions; consult Core State for the live paused status. The outflow limits below are local previews only.
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--vx-text-secondary)' }}>Local Preview Status (not live Core state)</span>
              <span className="vx-stage-pill" style={{ color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.4)' }}>
                {emergency.status.toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {emergency.limits.map((limit) => (
                <div
                  key={limit.id}
                  style={{
                    backgroundColor: 'var(--vx-bg-subtle)',
                    padding: '0.875rem',
                    borderRadius: '8px',
                    border: '1px solid var(--vx-border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>
                      {limit.label}
                    </span>
                    <span className="vx-threshold-badge">{limit.configuredValue}</span>
                  </div>
                  <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: 'var(--vx-text-secondary)' }}>
                    {limit.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="vx-modal-footer">
          <button type="button" className="vx-btn vx-btn-outline" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="vx-btn vx-btn-secondary"
            disabled
            title="Emergency actions are not connected in this panel."
          >
            Pause Actions Unavailable in This Panel
          </button>
        </div>
      </div>
    </div>
  );
}
