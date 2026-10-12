import { useEffect } from 'react';

import {
  BucketConfigurationPanel,
  DepositActionModal,
  CoreStateDashboard,
  EmergencyControlsModal,
  EmergencyRiskControls,
  TreasuryAllocationOverview,
  TreasuryBalanceCards,
  TreasuryRulesModal,
  TreasuryRulesSection,
  TreasuryStatusBanner,
} from '../features/treasury/components';
import { canViewAdminPanel } from '../features/treasury/access/adminAccess';
import { WithdrawActionModal } from '../features/treasury/components/WithdrawActionModal';
import { useTreasurySummary } from '../features/treasury/hooks/useTreasurySummary';
import { useTreasuryDeposit } from '../features/treasury/hooks/useTreasuryDeposit';
import { useTreasuryWithdraw } from '../features/treasury/hooks/useTreasuryWithdraw';
import { useTreasuryStrategyState } from '../features/treasury/hooks/useTreasuryStrategyState';
import { requestAdminBucketPolicySuggestion } from '../features/ai/services/adminBucketPolicySuggestion';
import { RiskPolicyExecutorPanel } from '../features/treasury/components/RiskPolicyExecutorPanel';
import { ProtocolVaultMappingAdminAction } from '../features/treasury/components/ProtocolVaultMappingAdminAction';
import { ApprovalSchedulingAdminActions } from '../features/treasury/components/ApprovalSchedulingAdminActions';
import { ApprovalExecutionReadiness } from '../features/treasury/components/ApprovalExecutionReadiness';
import { StrategyApprovalAdminActions } from '../features/treasury/components/StrategyApprovalAdminActions';
import { StrategyApprovalExecutionReadiness } from '../features/treasury/components/StrategyApprovalExecutionReadiness';
import { StrategyValuationSyncAdminAction } from '../features/treasury/components/StrategyValuationSyncAdminAction';
import { getStrategyApprovalPanelVisibility } from '../features/treasury/access/strategyApprovalVisibility';

export function TreasuryPage() {
  const {
    summary,
    modalState,
    openDepositModal,
    closeDepositModal,
    openWithdrawModal,
    closeWithdrawModal,
    openRulesModal,
    closeRulesModal,
    openEmergencyModal,
    closeEmergencyModal,
    refetchTreasuryBalance,
    refreshBalances,
    isRefreshingBalance,
    policy,
    walletUsdc,
    treasuryAddress,
    onChainPolicy,
    adminProjection,
    adminProjectionLoading,
    userProjection,
    userProjectionLoading,
    userAuthenticationLoading,
    isUserAuthenticated,
    userAuthenticationError,
    isPolicyAdmin,
    isTimelockExecutor,
    pendingBucketPolicy,
    verifiedBucketPolicy,
    bucketPolicyExecutionStatus,
    executePendingBucketPolicy,
    pendingRiskPolicies,
    pendingWithdrawalPolicies,
    pendingScheduledPoliciesLoading,
    scheduledPolicyDiscoveryError,
    riskPolicyExecutionStatus,
    executePendingRiskPolicy,
    executePendingWithdrawalPolicy,
    isPolicyCoreSupported,
    policyCoreSupportLoading,
    policyCoreSupportError,
    canSelfWithdraw,
    policyContractError,
    updateOnChainPolicy,
    refetchOnChainPolicy,
  } = useTreasurySummary();
  const canViewAdmin = canViewAdminPanel(summary.isConnected, summary.isArcMainnet, isPolicyAdmin);
  const strategyApprovalVisibility = getStrategyApprovalPanelVisibility(
    summary.isConnected,
    summary.isArcMainnet,
    isPolicyAdmin && canViewAdmin,
    isTimelockExecutor,
  );
  const strategyState = useTreasuryStrategyState(
    summary.isConnected && !canViewAdmin,
    summary.isArcMainnet,
    isUserAuthenticated,
    summary.address,
  );

  useEffect(() => {
    if (!canViewAdmin) {
      closeRulesModal();
      closeEmergencyModal();
    }
  }, [canViewAdmin, closeRulesModal, closeEmergencyModal]);

  const refreshFinancialState = async () => {
    await Promise.all([refreshBalances(), refetchOnChainPolicy(), strategyState.refetch()]);
  };
  const deposit = useTreasuryDeposit(summary.address, summary.isArcMainnet, refreshFinancialState);
  const withdrawal = useTreasuryWithdraw(summary.address, summary.isArcMainnet, refreshFinancialState);

  return (
    <div className="vx-treasury-page">
      <header className="vx-page-header">
        <div className="vx-page-title-group">
          <h1>USDC Treasury</h1>
          <p>
            {canViewAdmin
              ? 'Programmable capital management, rule-based allocations, and operational liquidity on Arc Mainnet.'
              : 'View your USDC balance and Treasury activity in one place.'}
          </p>
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

      <TreasuryStatusBanner
        status={summary.statusBanner}
        isConnected={summary.isConnected}
        isArcMainnet={summary.isArcMainnet}
        canViewAdmin={canViewAdmin}
      />

      <TreasuryBalanceCards
        balances={summary.balances}
        walletBalance={walletUsdc}
        onOpenDeposit={openDepositModal}
        isDepositEnabled={deposit.canDeposit}
        onOpenWithdraw={openWithdrawModal}
        isWithdrawEnabled={withdrawal.canWithdraw}
        withdrawDisabledReason={!treasuryAddress
          ? 'Treasury address is not configured'
          : !summary.address
            ? 'Connect a wallet to withdraw'
            : !summary.isArcMainnet
              ? 'Switch to Arc Mainnet to withdraw'
              : 'Withdrawal is not available right now'}
        onRefreshBalance={refetchTreasuryBalance}
        isRefreshing={isRefreshingBalance}
        canViewAdmin={canViewAdmin}
      />

      <CoreStateDashboard
        coreState={null}
        userProjection={userProjection}
        isLoading={userProjectionLoading || userAuthenticationLoading}
        error={policyContractError instanceof Error ? policyContractError : null}
        isConnected={summary.isConnected}
        isAuthenticated={isUserAuthenticated}
        authenticationLoading={userAuthenticationLoading}
        authenticationError={userAuthenticationError}
        strategyState={strategyState.strategy}
        strategyLoading={strategyState.isLoading}
        strategyError={strategyState.error}
        userStrategyPosition={strategyState.position}
        userStrategyStatus={strategyState.strategyStatus}
        userStrategyUnavailableReason={strategyState.unavailableReason}
        userStrategyLoading={strategyState.isLoading}
        userStrategyError={strategyState.error}
        onRetryUserStrategy={() => { void strategyState.refetch(); }}
        isAdminView={false}
      />

      <TreasuryAllocationOverview allocations={summary.allocations} canViewAdmin={canViewAdmin} />

      <TreasuryRulesSection
        rules={summary.rules}
        onOpenRules={() => canViewAdmin && openRulesModal()}
        hasOnChainPolicy={Boolean(onChainPolicy)}
        isTreasuryConfigured={Boolean(treasuryAddress)}
        canViewAdmin={canViewAdmin}
      />

      <EmergencyRiskControls
        emergency={summary.emergency}
        onOpenEmergency={() => canViewAdmin && openEmergencyModal()}
        canViewAdmin={canViewAdmin}
      />

      {/* Action and Boundary Modals (Transaction-Free Previews) */}
      <DepositActionModal
        isOpen={modalState.isDepositOpen}
        onClose={closeDepositModal}
        treasuryAddress={treasuryAddress}
        canDeposit={deposit.canDeposit}
        isSubmitting={deposit.isSubmitting}
        status={deposit.status}
        onDeposit={deposit.deposit}
        canViewAdmin={canViewAdmin}
      />
      <WithdrawActionModal
        isOpen={modalState.isWithdrawOpen}
        onClose={closeWithdrawModal}
        canWithdraw={withdrawal.canWithdraw}
        isSubmitting={withdrawal.isSubmitting}
        status={withdrawal.status}
        onWithdraw={withdrawal.withdraw}
        walletAddress={summary.address}
        authorizationMessage={!summary.isConnected ? 'Connect a wallet to withdraw your own Treasury balance.' : !summary.isArcMainnet ? 'Switch to Arc Mainnet to withdraw your own Treasury balance.' : !canSelfWithdraw ? 'Self-withdrawal is unavailable for the connected wallet.' : undefined}
        canViewAdmin={canViewAdmin}
      />
      {canViewAdmin && (
        <section className="vx-section" aria-labelledby="treasury-admin-title" style={{ marginTop: '1.5rem' }}>
          <div className="vx-section-header">
            <div className="vx-section-title-group">
              <h2 id="treasury-admin-title">Admin Treasury Operations</h2>
              <p>Authorized policy, approval, and on-chain treasury controls for the connected Arc Mainnet admin wallet.</p>
            </div>
          </div>

          <CoreStateDashboard
            coreState={onChainPolicy?.coreState ?? null}
            adminProjection={adminProjection}
            isLoading={adminProjectionLoading}
            error={policyContractError instanceof Error ? policyContractError : null}
            strategyState={strategyState.strategy}
            strategyLoading={strategyState.isLoading}
            strategyError={strategyState.error}
            isAdminView={true}
          />

          <ApprovalSchedulingAdminActions />
          <StrategyValuationSyncAdminAction isAdmin={canViewAdmin} />
        </section>
      )}
      {strategyApprovalVisibility.canSchedule && <StrategyApprovalAdminActions />}
      {strategyApprovalVisibility.canViewExecution && <StrategyApprovalExecutionReadiness />}
      <ProtocolVaultMappingAdminAction />

      {(canViewAdmin || isTimelockExecutor) && <ApprovalExecutionReadiness />}

      {(canViewAdmin || isTimelockExecutor) && (
        <BucketConfigurationPanel
          draftPolicy={canViewAdmin ? policy : null}
          currentPolicy={onChainPolicy?.bucketPolicy ?? verifiedBucketPolicy}
          scheduledPolicy={pendingBucketPolicy?.policy ?? null}
          scheduledOperationId={pendingBucketPolicy?.operationId ?? null}
          scheduledEta={pendingBucketPolicy?.eta ?? null}
          pendingDiscoveryLoading={pendingScheduledPoliciesLoading}
          pendingDiscoveryError={scheduledPolicyDiscoveryError}
          canViewAdmin={canViewAdmin}
          currentCoreSupported={policyCoreSupportLoading || policyCoreSupportError ? null : isPolicyCoreSupported}
          supportCheckFailed={Boolean(policyCoreSupportError)}
          canExecuteBucketPolicy={isTimelockExecutor}
          onExecuteBucketPolicy={executePendingBucketPolicy}
          executionStatus={bucketPolicyExecutionStatus}
        />
      )}

      {isTimelockExecutor && (
        <RiskPolicyExecutorPanel
          pendingOperations={pendingRiskPolicies}
          pendingWithdrawalOperations={pendingWithdrawalPolicies}
          isLoading={pendingScheduledPoliciesLoading}
          error={scheduledPolicyDiscoveryError}
          executionStatus={riskPolicyExecutionStatus}
          coreSupported={policyCoreSupportLoading || policyCoreSupportError ? null : isPolicyCoreSupported}
          onExecute={executePendingRiskPolicy}
          onExecuteWithdrawal={executePendingWithdrawalPolicy}
        />
      )}

      {canViewAdmin && (
        <TreasuryRulesModal
          isOpen={modalState.isRulesOpen}
          onClose={closeRulesModal}
          rules={summary.rules}
          policy={policy}
          onApply={updateOnChainPolicy}
          onChainPolicy={onChainPolicy?.policy ?? null}
          canApplyOnChain={Boolean(treasuryAddress && summary.isConnected && summary.isArcMainnet && isPolicyAdmin && isPolicyCoreSupported)}
          canRequestBucketSuggestion={Boolean(summary.isConnected && summary.isArcMainnet && isPolicyAdmin && isUserAuthenticated)}
          onSuggestBucketPolicy={(action) => requestAdminBucketPolicySuggestion(fetch, action)}
          applyAvailabilityMessage={!summary.isConnected ? 'Connect the POLICY_ADMIN wallet to apply policy.' : !summary.isArcMainnet ? 'Switch to Arc Mainnet (Chain ID 5042) to apply policy.' : policyContractError ? 'Unable to verify POLICY_ADMIN authorization.' : !isPolicyAdmin ? 'Connected wallet is not the Treasury POLICY_ADMIN.' : policyCoreSupportLoading ? 'Checking the configured Core policy interface.' : policyCoreSupportError ? 'Unable to verify the configured Core policy interface. On-chain apply is disabled.' : !isPolicyCoreSupported ? 'The configured Core does not expose the required two-day risk and bucket policy timelock interface. On-chain apply is disabled.' : undefined}
        />
      )}
      {canViewAdmin && (
        <EmergencyControlsModal
          isOpen={modalState.isEmergencyOpen}
          onClose={closeEmergencyModal}
          emergency={summary.emergency}
        />
      )}
    </div>
  );
}
