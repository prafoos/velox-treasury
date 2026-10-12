import { useEffect, useState } from 'react';
import type { TreasuryPolicyModel, TreasuryRuleModel } from '@velox/domain';
import {
  ALLOCATION_BUCKETS,
  policyToFormValues,
  validateTreasuryCorePolicyDraft,
  type TreasuryCorePolicyDraft,
  type TreasuryPolicyFormValues,
} from '../services/policyService';
import { formatUSDC } from '../../usdc/services/usdcService';
import type {
  AdminBucketPolicySuggestion,
  AdminBucketPolicySuggestionAction,
} from '../../ai/services/adminBucketPolicySuggestion';

type CoreProjectionValue = bigint | string | number | null | undefined;

interface OnChainPolicyDisplay {
  readonly minimumLiquidReserve: CoreProjectionValue;
  readonly minimumLiquidReserveBps: CoreProjectionValue;
  readonly maximumTotalDeployed: CoreProjectionValue;
  readonly maximumSingleWithdrawal?: CoreProjectionValue;
  readonly dailyOutflowCap?: CoreProjectionValue;
  readonly timelockDelaySeconds: CoreProjectionValue;
  readonly valuationFreshnessBlocks: CoreProjectionValue;
  readonly bucketPolicy: {
    readonly liquidOperationalReserveBps: CoreProjectionValue;
    readonly yieldStrategyBufferBps: CoreProjectionValue;
    readonly sweepLiquidityBufferBps: CoreProjectionValue;
    readonly automationAgentPoolBps: CoreProjectionValue;
  };
}

interface TreasuryRulesModalProps { readonly isOpen: boolean; readonly onClose: () => void; readonly rules: readonly TreasuryRuleModel[]; readonly policy: TreasuryPolicyModel; readonly onApply: (corePolicy: TreasuryCorePolicyDraft) => Promise<unknown>; readonly onChainPolicy: OnChainPolicyDisplay | null; readonly canApplyOnChain: boolean; readonly applyAvailabilityMessage?: string; readonly canRequestBucketSuggestion?: boolean; readonly onSuggestBucketPolicy?: (action: AdminBucketPolicySuggestionAction) => Promise<AdminBucketPolicySuggestion>; }

export function TreasuryRulesModal({ isOpen, onClose, policy, onApply, onChainPolicy, canApplyOnChain, applyAvailabilityMessage, canRequestBucketSuggestion = false, onSuggestBucketPolicy }: TreasuryRulesModalProps) {
  const [values, setValues] = useState<TreasuryPolicyFormValues>(() => createDraftFormValues(policy, onChainPolicy));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [suggestion, setSuggestion] = useState<AdminBucketPolicySuggestion | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [draftSuggestionStatus, setDraftSuggestionStatus] = useState<string | null>(null);
  useEffect(() => { if (isOpen) { setValues(createDraftFormValues(policy, onChainPolicy)); setErrors({}); setApplyStatus(null); setSuggestion(null); setSuggestionError(null); setDraftSuggestionStatus(null); } }, [
    isOpen,
    policy,
    onChainPolicy?.minimumLiquidReserve,
    onChainPolicy?.minimumLiquidReserveBps,
    onChainPolicy?.maximumTotalDeployed,
    onChainPolicy?.maximumSingleWithdrawal,
    onChainPolicy?.dailyOutflowCap,
    onChainPolicy?.timelockDelaySeconds,
    onChainPolicy?.valuationFreshnessBlocks,
    onChainPolicy?.bucketPolicy.liquidOperationalReserveBps,
    onChainPolicy?.bucketPolicy.yieldStrategyBufferBps,
    onChainPolicy?.bucketPolicy.sweepLiquidityBufferBps,
    onChainPolicy?.bucketPolicy.automationAgentPoolBps,
  ]);
  if (!isOpen) return null;
  const withdrawalPolicyAvailable = parseCoreInteger(onChainPolicy?.maximumSingleWithdrawal ?? null) !== null
    && parseCoreInteger(onChainPolicy?.dailyOutflowCap ?? null) !== null;
  const corePreview = validateTreasuryCorePolicyDraft(values, toCorePolicyReadback(onChainPolicy));
  const apply = async () => {
    const coreResult = validateTreasuryCorePolicyDraft(values, toCorePolicyReadback(onChainPolicy));
    setErrors(coreResult.errors);
    if (!coreResult.draft) return;
    setIsApplying(true);
    setApplyStatus(null);
    try {
      const mutation = await onApply(coreResult.draft) as { readonly status?: string; readonly pendingOperations?: readonly { readonly operationId: string; readonly kind: string; readonly eta: bigint }[] } | null;
      const pending = mutation?.pendingOperations?.map((operation) => `${operation.kind} ${operation.operationId} (ETA ${operation.eta})`).join(', ');
      setApplyStatus(mutation?.status === 'SCHEDULED'
        ? `Risk-increasing Core policy is scheduled and verified on Core: ${pending}. It has not executed; the authorized TIMELOCK_EXECUTOR must execute it after the 2-day delay.`
        : mutation?.status === 'NO_ONCHAIN_CHANGES'
          ? 'No on-chain Core policy values changed.'
          : 'Immediate Core policy changes were confirmed by successful receipts and authoritative Core readback.');
    } catch (error) {
      setApplyStatus(error instanceof Error ? error.message : 'On-chain policy transaction failed or was rejected.');
    } finally {
      setIsApplying(false);
    }
  };
  const suggestBucketPolicy = async (action: AdminBucketPolicySuggestionAction) => {
    if (!onSuggestBucketPolicy || !canRequestBucketSuggestion || isSuggesting) return;
    setIsSuggesting(true);
    setSuggestionError(null);
    setDraftSuggestionStatus(null);
    try {
      setSuggestion(await onSuggestBucketPolicy(action));
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : 'Admin AI could not generate a bucket policy suggestion.');
    } finally {
      setIsSuggesting(false);
    }
  };
  const useSuggestionInDraft = () => {
    if (!suggestion) return;
    setValues((previous) => applyBucketPolicySuggestionToDraft(previous, suggestion));
    setErrors({});
    setDraftSuggestionStatus('Bucket values were copied into this editable policy draft only. Review and edit them before explicitly applying.');
  };
  const canApply = canApplyOnChain
    && suggestion?.coreConstraints.status !== 'UNAVAILABLE'
    && Boolean(corePreview.draft)
    && !isApplying;
  return (
    <div className="vx-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rules-modal-title">
      <div className="vx-modal-dialog vx-policy-modal">
        <div className="vx-modal-header">
          <h3 id="rules-modal-title" className="vx-modal-title">Configure treasury policy</h3>
          <button type="button" className="vx-modal-close-btn" onClick={onClose} aria-label="Close policy configuration">x</button>
        </div>
        <div>
          <div className="vx-modal-body">
            <div className="vx-step-callout info">Review Core policy values and explicitly apply changes with the authorized POLICY_ADMIN wallet.</div>
            {applyAvailabilityMessage && <div className="vx-step-callout warning">{applyAvailabilityMessage}</div>}
            {applyStatus && <div className="vx-step-callout info">{applyStatus}</div>}

            <section aria-label="Admin AI bucket policy suggestion">
              <div className="vx-form-label">Admin AI bucket policy suggestion</div>
              <div className="vx-field-hint">AI recommendation — Admin review required. The suggestion is advisory and is never applied automatically.</div>
              <button type="button" className="vx-btn vx-btn-secondary" onClick={() => void suggestBucketPolicy('GET_CURRENT_RECOMMENDATION')} disabled={!canRequestBucketSuggestion || !onSuggestBucketPolicy || isSuggesting}>
                {isSuggesting ? 'Loading authorized Admin recommendation…' : 'Get Current AI Recommendation'}
              </button>
              {suggestion && (
                <button type="button" className="vx-btn vx-btn-secondary" onClick={() => void suggestBucketPolicy('REGENERATE_AI_RECOMMENDATION')} disabled={!canRequestBucketSuggestion || !onSuggestBucketPolicy || isSuggesting}>
                  {isSuggesting ? 'Generating new AI recommendation…' : 'Regenerate AI Recommendation'}
                </button>
              )}
              {suggestionError && <div className="vx-field-error" role="alert">{suggestionError}</div>}
              {suggestion && (
                <div className="vx-ai-recommendation-content" data-testid="bucket-policy-suggestion">
                  {suggestion.lifecycle?.evidenceStatus === 'STALE' && (
                    <div className="vx-step-callout warning" role="status">
                      This recommendation is based on an older evidence snapshot. It has not been changed; explicitly regenerate to request a new Gemini recommendation.
                    </div>
                  )}
                  {suggestion.lifecycle?.evidenceStatus === 'UNAVAILABLE' && (
                    <div className="vx-step-callout warning" role="status">
                      The saved recommendation’s evidence freshness could not be verified. Its allocation is unchanged; explicitly regenerate to request a new recommendation.
                    </div>
                  )}
                  <div className="vx-ai-advisory-banner">
                    <span className="vx-ai-badge warning">
                      {suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA'
                        ? 'No allocation generated'
                        : suggestion.advisoryLabel}
                    </span>
                    {suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA'
                      ? <strong>INSUFFICIENT VERIFIED DATA</strong>
                      : <strong>AI RECOMMENDATION — ADMIN REVIEW REQUIRED</strong>}
                  </div>
                  {suggestion.lineage && (
                    <div className="vx-field-hint" data-testid="bucket-policy-lineage">
                      <div>Generated {suggestion.lineage.generatedAt} · model {suggestion.lineage.model ?? 'unavailable'}</div>
                      <div>Evidence snapshot {suggestion.lineage.evidenceSnapshotId}</div>
                      {suggestion.lifecycle && <div>Recommendation lifecycle: {suggestion.lifecycle.disposition}</div>}
                    </div>
                  )}
                  <div className={`vx-step-callout ${suggestion.marketDataStatus === 'UNAVAILABLE' ? 'warning' : 'info'}`}>
                    <strong>Market data status: {suggestion.recommendationStatus === 'UNAVAILABLE' || suggestion.marketDataStatus === 'UNAVAILABLE'
                      ? 'Unavailable'
                      : suggestion.marketDataStatus === 'PARTIAL' ? 'Partial' : 'Verified'}</strong>
                    {suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA' && (
                      <div><strong>Recommendation status: INSUFFICIENT VERIFIED DATA</strong></div>
                    )}
                    {suggestion.coreConstraints.status === 'UNAVAILABLE' && (
                      <div><strong>Recommendation status: NOT EXECUTABLE</strong></div>
                    )}
                    {suggestion.recommendationStatus === 'REQUIRES_ADMIN_ADJUSTMENT' && (
                      <div><strong>Recommendation status: Requires Admin adjustment</strong></div>
                    )}
                    <div>{suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA'
                      ? 'The verified evidence is insufficient to determine a reliable four-bucket policy allocation. No percentages were generated.'
                      : suggestion.recommendationStatus === 'UNAVAILABLE'
                        ? 'Verified market data are unavailable, so current market conditions cannot support an allocation.'
                      : suggestion.coreConstraints.status === 'UNAVAILABLE'
                        ? 'Based on the current verified market conditions and available liquidity, AI recommends the following allocation. Executability has not been verified.'
                        : suggestion.recommendationStatus === 'REQUIRES_ADMIN_ADJUSTMENT'
                            ? 'The suggested allocation exceeds the current Core bucket policy or other verified Core constraints. It remains editable for Admin review but is not executable as a recommendation.'
                          : 'Based on the current verified market conditions and available liquidity, AI recommends the following allocation.'}</div>
                  </div>
                  {suggestion.recommendationStatus === 'INSUFFICIENT_VERIFIED_DATA' ? (
                    <div className="vx-step-callout warning">
                      <strong>Missing verified data</strong>
                      <ul>
                        {suggestion.missingVerifiedData.map((field) => <li key={field}>{field}</li>)}
                      </ul>
                    </div>
                  ) : suggestion.recommendationStatus !== 'UNAVAILABLE' ? (
                    <>
                      <div className="vx-policy-grid">
                        {suggestion.allocations.map((allocation) => (
                          <div className="vx-form-group" key={allocation.id}>
                            <div className="vx-form-label">{allocation.name}</div>
                            <div>{allocation.percentage}</div>
                            <div className="vx-field-hint">{allocation.reasoning}</div>
                          </div>
                        ))}
                      </div>
                      <div className="vx-field-hint">Total: {suggestion.totalPercentage} / {suggestion.totalBps} BPS</div>
                      {suggestion.allocations.length === 4 && (
                        <button
                          type="button"
                          className="vx-btn vx-btn-secondary"
                          onClick={useSuggestionInDraft}
                        >
                          Use recommendation in policy draft
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="vx-step-callout warning">Recommendation unavailable. No allocation was returned.</div>
                  )}
                  <details className="vx-field-hint">
                    <summary>View market analysis</summary>
                    {suggestion.marketData && (
                      <>
                        <div className="vx-field-hint">
                          <strong>Vault identity</strong>
                          <div>{suggestion.marketData.network} · chain {suggestion.marketData.chainId} · {suggestion.marketData.assetAddress}</div>
                          <div>Vault {suggestion.marketData.vaultAddress} · protocol {suggestion.marketData.protocolName} ({suggestion.marketData.protocolId})</div>
                          <div>Snapshot block {suggestion.marketData.freshness.blockNumber ?? 'Unavailable'} · block timestamp {suggestion.marketData.freshness.blockTimestamp ?? 'Unavailable'} · retrieved {suggestion.marketData.freshness.retrievedAt}</div>
                        </div>
                        <div className="vx-field-hint">
                          <strong>Verified vault observations (official Morpho GraphQL API)</strong>
                          <div>Total assets: {marketObservation(suggestion.marketData.vault.totalAssets)}</div>
                          <div>Available withdrawal liquidity: {marketObservation(suggestion.marketData.vault.availableLiquidity)}</div>
                          <div>Idle USDC at vault (on-chain token balance): {marketObservation(suggestion.marketData.vault.idleLiquidity)}</div>
                          <div>Share supply: {marketObservation(suggestion.marketData.vault.totalSupply)}</div>
                          <div>APY ratio (multiply by 100 for percent): {marketObservation(suggestion.marketData.vault.apy)}</div>
                          <div>Net APY ratio: {marketObservation(suggestion.marketData.vault.netApy)}</div>
                          <div>Vault warnings: {marketObservation(suggestion.marketData.vault.warnings)}</div>
                          <div>Deposit availability: {marketObservation(suggestion.marketData.vault.depositAvailability)} · receive-assets gate: {marketObservation(suggestion.marketData.vault.depositGateStatus)}</div>
                          <div>Vault timelocks (active functions): {marketObservation(suggestion.marketData.vault.timelock)}</div>
                        </div>
                        <div className="vx-field-hint">
                          <strong>Underlying Morpho market risk observations</strong>
                          <div>Market ID: {marketObservation(suggestion.marketData.underlyingMarket.marketId)}</div>
                          <div>Underlying market state: block {marketObservation(suggestion.marketData.underlyingMarket.stateBlockNumber)} · timestamp {marketObservation(suggestion.marketData.underlyingMarket.stateTimestamp)}</div>
                          <div>Market allocation: {marketObservation(suggestion.marketData.underlyingMarket.allocation)}</div>
                          <div>Underlying liquidity: {marketObservation(suggestion.marketData.underlyingMarket.liquidity)}</div>
                          <div>Utilization: {marketObservation(suggestion.marketData.underlyingMarket.utilizationBps)}</div>
                          <div>Collateral exposure: {marketObservation(suggestion.marketData.underlyingMarket.collateralExposure)}</div>
                          <div>Collateral asset: {marketObservation(suggestion.marketData.underlyingMarket.collateralAssetAddress)} · decimals: {marketObservation(suggestion.marketData.underlyingMarket.collateralAssetDecimals)}</div>
                          <div>LLTV: {marketObservation(suggestion.marketData.underlyingMarket.lltv)}</div>
                          <div>Oracle identity (not health status): {marketObservation(suggestion.marketData.underlyingMarket.oracleStatus)}</div>
                          <div>Bad debt: {marketObservation(suggestion.marketData.underlyingMarket.badDebtStatus)}</div>
                          <div>Liquidation risk: {marketObservation(suggestion.marketData.underlyingMarket.liquidationRisk)}</div>
                          <div>Market warnings: {marketObservation(suggestion.marketData.underlyingMarket.warnings)}</div>
                        </div>
                      </>
                    )}
                    <div className="vx-field-hint">
                      <strong>Core constraint status: {suggestion.coreConstraints.status}</strong>
                      {suggestion.coreConstraints.status === 'AVAILABLE'
                        ? <div>Maximum enforceable Yield Strategy Buffer: {suggestion.coreConstraints.maximumYieldStrategyBufferBps} BPS · minimum Liquid Operational Reserve: {suggestion.coreConstraints.minimumLiquidOperationalReserveBps} BPS.</div>
                        : <div>{suggestion.coreConstraints.reason ?? 'Authoritative Core exposure constraints are unavailable.'}</div>}
                    </div>
                    <div className="vx-field-hint">
                      <strong>Velox Treasury and Core facts (authoritative projection)</strong>
                      <VeloxProjectionFacts suggestion={suggestion} />
                    </div>
                    {suggestion.marketData?.reason && <div className="vx-field-hint">{suggestion.marketData.reason}</div>}
                    <div className="vx-field-hint"><strong>Key risk assumptions</strong><ul>{suggestion.keyRiskAssumptions.map((assumption, index) => <li key={`${index}-${assumption}`}>{assumption}</li>)}</ul></div>
                    <div className="vx-field-hint"><strong>Unavailable data</strong><ul>{suggestion.unavailableData.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
                  </details>
                  {suggestion.lineage?.rawGeminiResponse && (
                    <details className="vx-field-hint">
                      <summary>View original Gemini response</summary>
                      <pre>{suggestion.lineage.rawGeminiResponse}</pre>
                    </details>
                  )}
                  {suggestion.recommendationStatus === 'REQUIRES_ADMIN_ADJUSTMENT' && (
                    <div className="vx-step-callout warning">
                      <strong>Status: Requires Admin adjustment</strong>
                      <div>The recommendation exceeds the current Core bucket policy or other verified Core constraints. Review and edit the draft before any explicit Admin policy submission.</div>
                      {suggestion.bucketPolicyValidation.exceededBuckets.length > 0 && (
                        <div>
                          Exceeds current Core bucket policy for: {suggestion.bucketPolicyValidation.exceededBuckets
                            .map((id) => suggestion.allocations.find((allocation) => allocation.id === id)?.name ?? id)
                            .join(', ')}.
                        </div>
                      )}
                    </div>
                  )}
                  {draftSuggestionStatus && <div className="vx-step-callout info" role="status">{draftSuggestionStatus}</div>}
                </div>
              )}
            </section>

            <section>
              <div className="vx-form-label">On-chain Core risk policy</div>
              <div className="vx-field-hint">These values are submitted to the existing Core risk-policy and bucket-policy functions. A missing value is not treated as zero.</div>
              <div className="vx-policy-grid">
                <Field label="Minimum Liquid Reserve" hint="USDC amount enforced by Core as the minimum liquid reserve." unit="USDC" value={values.minimumLiquidReserve} error={errors.minimumLiquidReserve} onChange={(value) => setValues((previous) => ({ ...previous, minimumLiquidReserve: value }))} />
                <Field label="Minimum Liquid Reserve BPS" hint="Core risk policy basis points, from 0 to 10,000." unit="BPS" value={values.minimumLiquidReserveBps} error={errors.minimumLiquidReserveBps} onChange={(value) => setValues((previous) => ({ ...previous, minimumLiquidReserveBps: value }))} />
                <Field label="Maximum Total Deployed" hint="USDC exposure limit enforced by Core." unit="USDC" value={values.maximumTotalDeployed} error={errors.maximumTotalDeployed} onChange={(value) => setValues((previous) => ({ ...previous, maximumTotalDeployed: value }))} />
                <Field label="Maximum Single Withdrawal" hint="Core-enforced cap per withdrawal. Increasing it or changing a nonzero cap to 0 (unlimited) is timelocked for two days." unit="USDC" value={values.maximumSingleWithdrawal} error={errors.maximumSingleWithdrawal} onChange={(value) => setValues((previous) => ({ ...previous, maximumSingleWithdrawal: value }))} disabled={!withdrawalPolicyAvailable} />
                <Field label="24-Hour Outflow Spending Cap" hint="Core-enforced cap across withdrawals in its fixed 24-hour window. Increasing it or changing a nonzero cap to 0 (unlimited) is timelocked for two days." unit="USDC" value={values.dailyOutflowCap} error={errors.dailyOutflowCap} onChange={(value) => setValues((previous) => ({ ...previous, dailyOutflowCap: value }))} disabled={!withdrawalPolicyAvailable} />
              </div>
              {!withdrawalPolicyAvailable && <div className="vx-step-callout warning" role="status">Withdrawal policy controls are unavailable: the configured Core did not provide authoritative values from both withdrawal-limit getters. They cannot be edited or applied.</div>}
              <div className="vx-form-label">Core bucket policy (must total exactly 10,000 BPS)</div>
              <div className="vx-policy-grid">{ALLOCATION_BUCKETS.map((bucket) => <Field key={bucket.id} label={bucket.name} unit="%" value={values.allocations[bucket.id] ?? ''} error={errors[`allocations.${bucket.id}`]} onChange={(value) => setValues((previous) => ({ ...previous, allocations: { ...previous.allocations, [bucket.id]: value } }))} />)}</div>
              {errors.allocations && <div className="vx-field-error">{errors.allocations}</div>}
              <div className="vx-policy-grid">
                <Field label="Timelock Delay" hint="Fixed by this deployed Core contract; shown from authoritative readback and cannot be changed by policy Apply." unit="seconds (fixed)" value={values.timelockDelaySeconds} error={errors.timelockDelaySeconds} disabled />
                <Field label="Valuation Freshness Blocks" hint="Set during Core construction; this deployed Core does not expose a mutable freshness policy." unit="blocks (fixed)" value={values.valuationFreshnessBlocks} error={errors.valuationFreshnessBlocks} disabled />
              </div>
              {corePreview.errors && Object.entries(corePreview.errors).filter(([key]) => !errors[key] && key !== 'allocations').map(([key, message]) => <div key={key} className="vx-field-error">{message}</div>)}
            </section>

            <div className="vx-form-label">Authoritative Core policy readback</div>
            {onChainPolicy ? (
              <div className="vx-field-hint">
                <div>Risk policy — minimum liquid reserve: {formatCoreAmount(onChainPolicy.minimumLiquidReserve)} USDC; minimum liquid reserve BPS: {formatCoreBps(onChainPolicy.minimumLiquidReserveBps)}; maximum total deployed: {formatCoreAmount(onChainPolicy.maximumTotalDeployed)} USDC.</div>
                <div>Withdrawal policy — maximum single withdrawal: {formatCoreAmount(onChainPolicy.maximumSingleWithdrawal)} USDC; 24-hour outflow spending cap: {formatCoreAmount(onChainPolicy.dailyOutflowCap)} USDC.</div>
                <div>Bucket policy — liquid operational reserve: {formatCoreBps(onChainPolicy.bucketPolicy.liquidOperationalReserveBps)}; Yield Strategy Buffer: {formatCoreBps(onChainPolicy.bucketPolicy.yieldStrategyBufferBps)}; sweep liquidity buffer: {formatCoreBps(onChainPolicy.bucketPolicy.sweepLiquidityBufferBps)}; automation agent pool: {formatCoreBps(onChainPolicy.bucketPolicy.automationAgentPoolBps)}.</div>
                <div>Timelock delay: {formatCoreInteger(onChainPolicy.timelockDelaySeconds)} seconds. Valuation freshness: {formatCoreInteger(onChainPolicy.valuationFreshnessBlocks)} blocks.</div>
              </div>
            ) : <div className="vx-field-hint">Authoritative Core policy has not been read or is unavailable.</div>}
          </div>
          <div className="vx-modal-footer">
            <button type="button" className="vx-btn vx-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="vx-btn vx-btn-primary" onClick={apply} disabled={!canApply}>{isApplying ? 'Applying…' : 'Apply on-chain policy'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function applyBucketPolicySuggestionToDraft(
  values: TreasuryPolicyFormValues,
  suggestion: AdminBucketPolicySuggestion,
): TreasuryPolicyFormValues {
  const expectedIds = [
    'liquidOperationalReserve',
    'yieldStrategyBuffer',
    'sweepLiquidityBuffer',
    'automationAgentPool',
  ];
  if (suggestion.recommendationStatus === 'UNAVAILABLE'
    || suggestion.allocations.length !== 4
    || new Set(suggestion.allocations.map(({ id }) => id)).size !== expectedIds.length
    || expectedIds.some((id) => !suggestion.allocations.some((allocation) => allocation.id === id))
    || suggestion.allocations.some((allocation) =>
      !Number.isSafeInteger(allocation.bps) || allocation.bps < 0 || allocation.bps > 10_000)
    || suggestion.allocations.reduce((total, allocation) => total + allocation.bps, 0) !== 10_000) return values;
  const formIds = {
    liquidOperationalReserve: 'operational_reserve',
    yieldStrategyBuffer: 'yield_strategy',
    sweepLiquidityBuffer: 'swap_liquidity',
    automationAgentPool: 'automation_agent',
  } as const;
  const allocations = { ...values.allocations };
  for (const allocation of suggestion.allocations) {
    allocations[formIds[allocation.id]] = formatCorePercentageBps(BigInt(allocation.bps));
  }
  return { ...values, allocations };
}

function marketObservation(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Unavailable';
  const observation = value as { readonly availability?: unknown; readonly value?: unknown; readonly unit?: unknown };
  if (observation.availability !== 'AVAILABLE' || observation.value === null || observation.value === undefined) return 'Unavailable';
  return `${String(observation.value)} ${typeof observation.unit === 'string' ? observation.unit : ''}`.trim();
}

function VeloxProjectionFacts({ suggestion }: { readonly suggestion: AdminBucketPolicySuggestion }) {
  const treasury = suggestion.veloxFacts.treasury;
  const riskPolicy = suggestion.veloxFacts.riskPolicy ?? {};
  const bucketPolicy = asRecord(suggestion.veloxFacts.currentBucketPolicy) ?? {};
  const strategy = asRecord(suggestion.veloxFacts.strategy) ?? {};
  const execution = suggestion.veloxFacts.coreExecutionConstraints ?? {};
  return (
    <>
      <div>Total user liabilities: {marketObservation(treasury.totalUserLiabilities)}</div>
      <div>Liquid USDC: {marketObservation(treasury.liquidUSDC)} · required reserve: {marketObservation(treasury.requiredLiquidReserve)}</div>
      <div>Core available liquidity: {marketObservation(treasury.availableLiquidity)} · total deployed: {marketObservation(treasury.totalDeployed)} · total managed assets: {marketObservation(treasury.totalManagedAssets)}</div>
      <div>Paused: {marketObservation(treasury.paused)} · system-wide immediately withdrawable amount: Unavailable (no aggregate Core getter)</div>
      <div>Current bucket BPS — operational {marketObservation(bucketPolicy.liquidOperationalReserveBps)} · yield {marketObservation(bucketPolicy.yieldStrategyBufferBps)} · sweep {marketObservation(bucketPolicy.sweepLiquidityBufferBps)} · automation {marketObservation(bucketPolicy.automationAgentPoolBps)}</div>
      <div>Risk policy — minimum reserve {marketObservation(riskPolicy.minimumLiquidReserve)} · minimum reserve BPS {marketObservation(riskPolicy.minimumLiquidReserveBps)} · maximum deployed {marketObservation(riskPolicy.maximumTotalDeployed)}</div>
      <div>Strategy — current value {marketObservation(strategy.currentValue)} · approved {marketObservation(strategy.approved)} · enabled {marketObservation(strategy.enabled)} · valuation status {marketObservation(strategy.valuationStatus)} · valuation block {marketObservation(strategy.valuationBlock)}</div>
      <div>Timelock delay: {marketObservation(execution.timelockDelaySeconds)} · valuation freshness blocks: {marketObservation(execution.valuationFreshnessBlocks)}</div>
    </>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function createDraftFormValues(policy: TreasuryPolicyModel, onChainPolicy: OnChainPolicyDisplay | null): TreasuryPolicyFormValues {
  const values = policyToFormValues(policy, toCorePolicyReadback(onChainPolicy));
  const emptyAllocations = Object.fromEntries(ALLOCATION_BUCKETS.map(({ id }) => [id, '']));
  if (!onChainPolicy) {
    return {
      ...values,
      minimumLiquidReserve: '',
      minimumLiquidReserveBps: '',
      maximumTotalDeployed: '',
      maximumSingleWithdrawal: 'Unavailable',
      dailyOutflowCap: 'Unavailable',
      allocations: emptyAllocations,
    };
  }

  const authoritativeBucket = onChainPolicy?.bucketPolicy;
  const bucketValues = authoritativeBucket
    ? Object.values(authoritativeBucket).map(parseCoreInteger)
    : [];
  const hasAuthoritativeBuckets = bucketValues.length === ALLOCATION_BUCKETS.length
    && bucketValues.every((value): value is bigint => value !== null)
    && bucketValues.reduce((sum, value) => sum + value, 0n) === 10_000n;
  if (hasAuthoritativeBuckets) {
    return {
      ...values,
      maximumSingleWithdrawal: formatCoreUSDCInput(onChainPolicy.maximumSingleWithdrawal),
      dailyOutflowCap: formatCoreUSDCInput(onChainPolicy.dailyOutflowCap),
      allocations: Object.fromEntries(ALLOCATION_BUCKETS.map((bucket, index) => [
        bucket.id,
        formatCorePercentageBps(bucketValues[index] as bigint),
      ])),
    };
  }
  return {
    ...values,
    maximumSingleWithdrawal: formatCoreUSDCInput(onChainPolicy.maximumSingleWithdrawal),
    dailyOutflowCap: formatCoreUSDCInput(onChainPolicy.dailyOutflowCap),
    allocations: emptyAllocations,
  };
}

function Field({ label, hint, unit, value, error, onChange, disabled = false }: { readonly label: string; readonly hint?: string; readonly unit: string; readonly value: string; readonly error?: string; readonly onChange?: (value: string) => void; readonly disabled?: boolean }) { const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-'); return <div className="vx-form-group"><label className="vx-form-label" htmlFor={id}>{label}</label><div className="vx-input-with-unit"><input id={id} className="vx-input" inputMode="decimal" value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} disabled={disabled} readOnly={disabled} /><span>{unit}</span></div>{hint && <div className="vx-field-hint">{hint}</div>}{error && <div className="vx-field-error">{error}</div>}</div>; }

function formatCoreAmount(value: CoreProjectionValue): string {
  const amount = parseCoreInteger(value);
  return amount === null ? 'Unavailable' : formatUSDC(amount) ?? 'Unavailable';
}

function formatCoreUSDCInput(value: CoreProjectionValue): string {
  const amount = parseCoreInteger(value);
  return amount === null ? 'Unavailable' : (formatUSDC(amount, { includeCommas: false, minDecimals: 0 }) ?? 'Unavailable').replace(/\.$/, '');
}

function formatCoreBps(value: CoreProjectionValue): string {
  const bps = parseCoreInteger(value);
  if (bps === null) return 'Unavailable';
  const whole = bps / 100n;
  const fraction = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}%`;
}

function parseCoreInteger(value: CoreProjectionValue): bigint | null {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isSafeInteger(value))) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function formatCoreInteger(value: CoreProjectionValue): string {
  return parseCoreInteger(value)?.toString() ?? 'Unavailable';
}

function formatCorePercentageBps(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function toCorePolicyReadback(policy: OnChainPolicyDisplay | null): {
  readonly minimumLiquidReserve?: CoreProjectionValue;
  readonly minimumLiquidReserveBps?: CoreProjectionValue;
  readonly maximumTotalDeployed?: CoreProjectionValue;
  readonly maximumSingleWithdrawal?: CoreProjectionValue;
  readonly dailyOutflowCap?: CoreProjectionValue;
  readonly timelockDelaySeconds?: CoreProjectionValue;
  readonly valuationFreshnessBlocks?: CoreProjectionValue;
} | null {
  if (!policy) return null;
  return {
    minimumLiquidReserve: policy.minimumLiquidReserve,
    minimumLiquidReserveBps: policy.minimumLiquidReserveBps,
    maximumTotalDeployed: policy.maximumTotalDeployed,
    maximumSingleWithdrawal: policy.maximumSingleWithdrawal,
    dailyOutflowCap: policy.dailyOutflowCap,
    timelockDelaySeconds: policy.timelockDelaySeconds,
    valuationFreshnessBlocks: policy.valuationFreshnessBlocks,
  };
}
