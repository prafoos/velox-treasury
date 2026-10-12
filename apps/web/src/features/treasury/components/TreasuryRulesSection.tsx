import type { TreasuryRuleModel } from '../types';

interface TreasuryRulesSectionProps {
  readonly rules: readonly TreasuryRuleModel[];
  readonly onOpenRules: () => void;
  readonly hasOnChainPolicy: boolean;
  readonly isTreasuryConfigured: boolean;
  readonly canViewAdmin: boolean;
}

export function TreasuryRulesSection({ rules, onOpenRules, hasOnChainPolicy, isTreasuryConfigured, canViewAdmin }: TreasuryRulesSectionProps) {
  if (!canViewAdmin) return null;

  return (
    <section className="vx-section" aria-labelledby="treasury-rules-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="treasury-rules-title">Treasury Policy & Automation Rules</h2>
          <p>
            Legacy application-only previews below are not enforced by the final Core. Configure Rules edits the role-gated on-chain risk and bucket policy.
          </p>
          <p style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}>
            On-chain Treasury policy: {hasOnChainPolicy ? 'loaded from the configured vault' : isTreasuryConfigured ? 'awaiting vault read' : 'not available — no Mainnet Treasury configured'}.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="vx-btn vx-btn-outline"
            onClick={onOpenRules}
            aria-label="View and configure treasury rules"
          >
            Configure Rules
          </button>
        </div>
      </div>

      <div className="vx-rules-list">
        {rules.map((rule) => (
          <div key={rule.id} className="vx-rule-item">
            <div className="vx-rule-info">
              <div className="vx-rule-name">{rule.name}</div>
              <div className="vx-rule-desc">{rule.description}</div>
            </div>

            <div className="vx-rule-meta">
              <span className="vx-threshold-badge">{rule.thresholdDisplay}</span>
              <span className="vx-stage-pill">
                Mode: {rule.executionMode === 'manual_approval' ? 'Manual Approval' : 'Automated Bounded'}
              </span>
              <span className="vx-stage-pill">{rule.implementationStage}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
