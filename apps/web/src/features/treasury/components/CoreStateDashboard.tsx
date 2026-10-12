import { formatUSDC } from '../../usdc/services/usdcService';
import type { TreasuryStrategyState, UserStrategyPosition, UserStrategyStatus } from '../hooks/useTreasuryStrategyState';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';
import { UserEarningPosition } from './UserEarningPosition';

interface CoreStateDashboardProps {
  readonly coreState: {
    readonly paused: boolean;
    readonly userBalance: bigint | null;
    readonly userFinancialState: {
      readonly principal: bigint;
      readonly currentValue: bigint;
      readonly unrealizedPnl: bigint;
      readonly realizedPnl: bigint;
      readonly totalPnl: bigint;
      readonly immediatelyWithdrawableValue: bigint | null;
    } | null;
    readonly totalUserLiabilities: bigint;
    readonly liquidUSDC: bigint;
    readonly requiredLiquidReserve: bigint;
    readonly availableLiquidity: bigint;
    readonly totalDeployed: bigint;
    readonly totalManagedAssets: bigint;
    readonly approvedProtocolCount: bigint;
    readonly approvedAssetCount: bigint;
    readonly approvedStrategyCount: bigint;
    readonly minimumLiquidReserve: bigint | null;
    readonly minimumLiquidReserveBps: number | null;
    readonly maximumTotalDeployed: bigint | null;
    readonly roles: {
      readonly policyAdmin: boolean;
      readonly timelockExecutor: boolean;
      readonly automation: boolean;
      readonly emergency: boolean;
    };
  } | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly strategyState: TreasuryStrategyState | null;
  readonly strategyLoading: boolean;
  readonly strategyError: Error | null;
  readonly userStrategyPosition?: UserStrategyPosition | null;
  readonly userStrategyStatus?: UserStrategyStatus | null;
  readonly userStrategyUnavailableReason?: string | null;
  readonly userStrategyLoading?: boolean;
  readonly userStrategyError?: Error | null;
  readonly onRetryUserStrategy?: () => void;
  readonly userProjection?: UserFinancialProjectionModel | null;
  readonly adminProjection?: Record<string, unknown> | null;
  readonly isAdminView?: boolean;
  readonly isConnected?: boolean;
  readonly isAuthenticated?: boolean;
  readonly authenticationLoading?: boolean;
  readonly authenticationError?: Error | null;
}

function Amount({ value, unavailableText = 'Unavailable' }: { readonly value: bigint | null; readonly unavailableText?: string }) {
  return <strong>{value === null ? unavailableText : `${formatUSDC(value)} USDC`}</strong>;
}

function SignedAmount({ value, unavailableText = 'Unavailable' }: { readonly value: bigint | null; readonly unavailableText?: string }) {
  if (value === null) return <strong>{unavailableText}</strong>;
  const sign = value < 0n ? '-' : value > 0n ? '+' : '';
  return <strong>{sign}{formatUSDC(value < 0n ? -value : value)} USDC</strong>;
}

function AddressValue({ value, title }: { readonly value: string; readonly title?: string }) {
  const safeText = value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
  return <strong title={title ?? value} className="vx-address-value">{safeText}</strong>;
}

function StateRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return <div className="vx-core-state-row"><span>{label}</span>{children}</div>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function AdminProjectionRow({
  label,
  field,
  signed = false,
}: {
  readonly label: string;
  readonly field: unknown;
  readonly signed?: boolean;
}) {
  const projectionValue = asRecord(field);
  if (!projectionValue || projectionValue.availability !== 'AVAILABLE' || projectionValue.value === null || projectionValue.value === undefined) {
    return <StateRow label={label}><strong>Unavailable</strong></StateRow>;
  }

  if (projectionValue.unit === 'USDC_BASE_UNITS') {
    try {
      const amount = BigInt(projectionValue.value as string | number | bigint);
      return (
        <StateRow label={label}>
          {signed ? <SignedAmount value={amount} /> : <Amount value={amount} />}
        </StateRow>
      );
    } catch {
      return <StateRow label={label}><strong>Unavailable</strong></StateRow>;
    }
  }

  if (typeof projectionValue.value === 'boolean') {
    return <StateRow label={label}><strong>{projectionValue.value ? 'Yes' : 'No'}</strong></StateRow>;
  }
  if (typeof projectionValue.value === 'string' || typeof projectionValue.value === 'number') {
    return <StateRow label={label}><strong>{String(projectionValue.value)}</strong></StateRow>;
  }
  return <StateRow label={label}><strong>Unavailable</strong></StateRow>;
}

export function AdminStrategyProjection({ projection }: { readonly projection: Record<string, unknown> }) {
  const strategy = asRecord(projection.strategy);
  const strategies = asRecord(projection.strategies);
  const strategiesData = asRecord(strategies?.data);
  const strategyRegistry = asRecord(strategiesData?.registry);
  const exposure = asRecord(projection.exposure);
  const exposureData = asRecord(exposure?.data);

  return (
    <div className="vx-core-state-group">
      <h3>System-wide Configured Strategy (partial)</h3>
      <AdminProjectionRow label="Strategy address" field={strategy?.adapterAddress} />
      <AdminProjectionRow label="Protocol ID" field={strategy?.protocolId} />
      <AdminProjectionRow label="Asset" field={strategy?.assetAddress} />
      <AdminProjectionRow label="Protocol vault" field={strategy?.protocolVaultAddress} />
      <AdminProjectionRow label="Approved" field={strategy?.approved} />
      <AdminProjectionRow label="Enabled" field={strategy?.enabled} />
      <AdminProjectionRow label="Principal" field={strategy?.principal} />
      <AdminProjectionRow label="Current value" field={strategy?.currentValue} />
      <AdminProjectionRow label="Shares" field={strategy?.shares} />
      <AdminProjectionRow label="Realized yield" field={strategy?.realizedYield} />
      <AdminProjectionRow label="Realized loss" field={strategy?.realizedLoss} />
      <AdminProjectionRow label="Unrealized yield" field={strategy?.unrealizedYield} />
      <AdminProjectionRow label="Unrealized loss" field={strategy?.unrealizedLoss} />
      <AdminProjectionRow label="Total P/L" field={strategy?.totalPnl} signed />
      <AdminProjectionRow label="Fees accrued" field={strategy?.feesAccrued} />
      <AdminProjectionRow label="Withdrawal shortfall" field={strategy?.withdrawalShortfall} />
      <AdminProjectionRow label="Absolute cap" field={strategy?.absoluteCap} />
      <AdminProjectionRow label="Relative cap BPS" field={strategy?.relativeCapBps} />
      <AdminProjectionRow label="Valuation status" field={strategy?.valuationStatusLabel} />
      <AdminProjectionRow label="Valuation block" field={strategy?.valuationBlock} />
      <AdminProjectionRow label="Valuation source" field={strategy?.valuationSource} />
      <StateRow label="Complete strategy registry">
        <strong>{strategyRegistry?.availability === 'AVAILABLE' ? 'Available' : 'Unavailable'}</strong>
      </StateRow>
      <AdminProjectionRow label="Strategy exposure" field={exposureData?.strategyExposure} />
      <AdminProjectionRow label="Protocol exposure" field={exposureData?.protocolExposure} />
      <AdminProjectionRow label="Asset exposure" field={exposureData?.assetExposure} />
      {typeof strategies?.reason === 'string' && <p className="vx-text-muted">{strategies.reason}</p>}
      {typeof exposure?.reason === 'string' && <p className="vx-text-muted">{exposure.reason}</p>}
    </div>
  );
}

function AdminProjectionDashboard({ projection }: { readonly projection: Record<string, unknown> }) {
  const treasury = asRecord(projection.treasury);
  const approvals = asRecord(projection.approvals);
  const riskPolicy = asRecord(projection.riskPolicy);
  const bucketPolicy = asRecord(projection.bucketPolicy);

  return (
    <div className="vx-core-state-grid">
      <div className="vx-core-state-group">
        <h3>Authorized Treasury State</h3>
        <AdminProjectionRow label="Total user liabilities" field={treasury?.totalUserLiabilities} />
        <AdminProjectionRow label="Liquid USDC" field={treasury?.liquidUSDC} />
        <AdminProjectionRow label="Required reserve" field={treasury?.requiredLiquidReserve} />
        <AdminProjectionRow label="Available liquidity" field={treasury?.availableLiquidity} />
        <AdminProjectionRow label="Total deployed" field={treasury?.totalDeployed} />
        <AdminProjectionRow label="Total managed assets" field={treasury?.totalManagedAssets} />
        <AdminProjectionRow label="Paused" field={treasury?.paused} />
        <AdminProjectionRow label="Core block" field={treasury?.blockNumber} />
      </div>
      <div className="vx-core-state-group">
        <h3>Authorized Approvals and Risk Policy</h3>
        <AdminProjectionRow label="Approved protocols" field={approvals?.approvedProtocolCount} />
        <AdminProjectionRow label="Approved assets" field={approvals?.approvedAssetCount} />
        <AdminProjectionRow label="Approved strategies" field={approvals?.approvedStrategyCount} />
        <AdminProjectionRow label="Minimum liquid reserve" field={riskPolicy?.minimumLiquidReserve} />
        <AdminProjectionRow label="Minimum reserve BPS" field={riskPolicy?.minimumLiquidReserveBps} />
        <AdminProjectionRow label="Maximum total deployed" field={riskPolicy?.maximumTotalDeployed} />
        <AdminProjectionRow label="Operational reserve BPS" field={bucketPolicy?.liquidOperationalReserveBps} />
        <AdminProjectionRow label="Yield strategy buffer BPS" field={bucketPolicy?.yieldStrategyBufferBps} />
        <AdminProjectionRow label="Sweep liquidity buffer BPS" field={bucketPolicy?.sweepLiquidityBufferBps} />
        <AdminProjectionRow label="Automation agent pool BPS" field={bucketPolicy?.automationAgentPoolBps} />
      </div>
      <AdminStrategyProjection projection={projection} />
    </div>
  );
}

export function CoreStateDashboard({
  coreState,
  isLoading,
  error,
  strategyState,
  strategyLoading,
  strategyError,
  userStrategyPosition = null,
  userStrategyStatus = null,
  userStrategyUnavailableReason,
  userStrategyLoading = false,
  userStrategyError = null,
  onRetryUserStrategy = () => undefined,
  userProjection = null,
  adminProjection = null,
  isAdminView = false,
  isConnected = false,
  isAuthenticated = Boolean(userProjection),
  authenticationLoading = false,
  authenticationError = null,
}: CoreStateDashboardProps) {
  const showAdminSections = isAdminView;

  return (
    <section className="vx-section" aria-labelledby="core-state-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="core-state-title">{showAdminSections ? 'Admin Treasury Operations' : 'Your Treasury'}</h2>
          <p>
            {showAdminSections
              ? 'Authorized operational read-only state for policy, approval, and strategy controls.'
              : 'Your balance and available withdrawal information.'}
          </p>
        </div>
        {showAdminSections && (
          <span className="vx-stage-pill">{authenticationLoading ? 'Checking wallet' : isLoading ? 'Reading Core' : error ? 'Core read error' : 'On-chain state'}</span>
        )}
      </div>
      {error && (
        <div className="vx-step-callout warning">
          {showAdminSections ? `Unable to read the live Core state: ${error.message}` : 'Your Treasury information is temporarily unavailable. Please try again later.'}
        </div>
      )}
      {!showAdminSections && authenticationError && <div className="vx-step-callout warning">Treasury data is temporarily unavailable. Please try again later.</div>}
      {!showAdminSections && isConnected && authenticationLoading && <div className="vx-step-callout info">Checking access to your Treasury information.</div>}
      {showAdminSections && !error && !coreState && !adminProjection && !isLoading && <div className="vx-step-callout info">Authorized Admin Treasury data is unavailable.</div>}
      {!showAdminSections && !error && !authenticationError && (!userProjection || !isAuthenticated) && !isLoading && !authenticationLoading && (
        <div className="vx-step-callout info">
          {!isConnected
            ? 'Connect a wallet on Arc Mainnet to view your Treasury information.'
            : !isAuthenticated
              ? 'Your Treasury information will appear after wallet sign-in is completed.'
              : 'Your Treasury information is not available yet.'}
        </div>
      )}
      {!showAdminSections && userProjection && isAuthenticated && (
        <div className="vx-core-state-grid">
          <div className="vx-core-state-group">
            <h3>Your balance</h3>
            <StateRow label="Your Treasury balance"><Amount value={userProjection.userBalance} unavailableText="—" /></StateRow>
            <StateRow label="Principal"><Amount value={userProjection.treasuryFinancialState?.principal ?? null} unavailableText="—" /></StateRow>
            <StateRow label="Current value"><Amount value={userProjection.treasuryFinancialState?.currentValue ?? null} unavailableText="—" /></StateRow>
            <StateRow label="Unrealized P/L"><SignedAmount value={userProjection.treasuryFinancialState?.unrealizedPnl ?? null} unavailableText="—" /></StateRow>
            <StateRow label="Realized P/L"><SignedAmount value={userProjection.treasuryFinancialState?.realizedPnl ?? null} unavailableText="—" /></StateRow>
            <StateRow label="Total P/L"><SignedAmount value={userProjection.treasuryFinancialState?.totalPnl ?? null} unavailableText="—" /></StateRow>
            <StateRow label="Immediately withdrawable from liquid USDC">
              <Amount value={userProjection.immediateWithdrawalLiquidity.value} unavailableText="—" />
            </StateRow>
            <p className="vx-text-muted">
              {userProjection.immediateWithdrawalLiquidity.status === 'PAUSED'
                ? 'Withdrawals are temporarily unavailable.'
                : userProjection.immediateWithdrawalLiquidity.status === 'UNAVAILABLE'
                  ? 'Withdrawal availability is not available yet.'
                  : 'Available withdrawals depend on your current Treasury balance.'}
            </p>
          </div>
          <UserEarningPosition
            position={userStrategyPosition}
            strategyStatus={userStrategyStatus}
            unavailableReason={userStrategyUnavailableReason}
            isLoading={userStrategyLoading}
            error={userStrategyError}
            isAuthenticated={isAuthenticated}
            authenticationLoading={authenticationLoading}
            authenticationError={authenticationError}
            onRetry={onRetryUserStrategy}
          />
        </div>
      )}
      {showAdminSections && coreState && (
        <div className="vx-core-state-grid">
          <div className="vx-core-state-group">
            <h3>User Financial State</h3>
            <StateRow label="Principal"><Amount value={coreState.userFinancialState?.principal ?? null} /></StateRow>
            <StateRow label="Current value"><Amount value={coreState.userFinancialState?.currentValue ?? null} /></StateRow>
            <StateRow label="Unrealized P/L"><SignedAmount value={coreState.userFinancialState?.unrealizedPnl ?? null} /></StateRow>
            <StateRow label="Realized P/L"><SignedAmount value={coreState.userFinancialState?.realizedPnl ?? null} /></StateRow>
            <StateRow label="Total P/L"><SignedAmount value={coreState.userFinancialState?.totalPnl ?? null} /></StateRow>
            <StateRow label="Immediately withdrawable from liquid USDC"><Amount value={coreState.userFinancialState?.immediatelyWithdrawableValue ?? null} /></StateRow>
            <StateRow label="Total user liabilities"><Amount value={coreState.totalUserLiabilities} /></StateRow>
          </div>

          <div className="vx-core-state-group">
            <h3>Treasury Liquidity</h3>
            {showAdminSections ? (
              <>
                <StateRow label="Liquid USDC"><Amount value={coreState.liquidUSDC} /></StateRow>
                <StateRow label="Required liquid reserve"><Amount value={coreState.requiredLiquidReserve} /></StateRow>
                <StateRow label="Available liquidity"><Amount value={coreState.availableLiquidity} /></StateRow>
              </>
            ) : null}
            <StateRow label="Paused"><strong>{coreState.paused ? 'Yes' : 'No'}</strong></StateRow>
          </div>

          {showAdminSections && (
            <div className="vx-core-state-group">
              <h3>Strategy Exposure</h3>
              <StateRow label="Total deployed"><Amount value={coreState.totalDeployed} /></StateRow>
              <StateRow label="Total managed assets"><Amount value={coreState.totalManagedAssets} /></StateRow>
              <StateRow label="Maximum total deployed"><Amount value={coreState.maximumTotalDeployed} /></StateRow>
              <StateRow label="Approved protocols"><strong>{coreState.approvedProtocolCount.toString()}</strong></StateRow>
              <StateRow label="Approved assets"><strong>{coreState.approvedAssetCount.toString()}</strong></StateRow>
              <StateRow label="Approved strategies"><strong>{coreState.approvedStrategyCount.toString()}</strong></StateRow>
            </div>
          )}

          <div className="vx-core-state-group">
            <h3>Strategy State</h3>
            {strategyLoading && <div className="vx-step-callout info">Reading strategy state...</div>}
            {strategyError && <div className="vx-step-callout warning">Unable to read strategy state: {strategyError.message}</div>}
            {!strategyLoading && !strategyError && !strategyState && <div className="vx-step-callout info">Strategy state unavailable.</div>}
            {strategyState && (
              <>
                {showAdminSections && (
                  <>
                    <StateRow label="Strategy"><AddressValue value={strategyState.strategyLabel} title={strategyState.strategyAddress} /></StateRow>
                    <StateRow label="Protocol"><AddressValue value={strategyState.protocolLabel} title={strategyState.protocol} /></StateRow>
                    <StateRow label="Asset"><AddressValue value={strategyState.asset} title={strategyState.asset} /></StateRow>
                    <StateRow label="Approved"><strong>{strategyState.approved ? 'Yes' : 'No'}</strong></StateRow>
                    <StateRow label="Enabled"><strong>{strategyState.enabled ? 'Yes' : 'No'}</strong></StateRow>
                    <StateRow label="Absolute cap"><Amount value={strategyState.absoluteCap} /></StateRow>
                    <StateRow label="Relative cap"><strong>{strategyState.relativeCapBps} BPS</strong></StateRow>
                    <StateRow label="Current value"><Amount value={strategyState.currentValue} /></StateRow>
                    <StateRow label="Shares"><strong>{strategyState.shares.toString()}</strong></StateRow>
                    <StateRow label="Principal"><Amount value={strategyState.principal} /></StateRow>
                    <StateRow label="Unrealized yield"><Amount value={strategyState.unrealizedYield} /></StateRow>
                    <StateRow label="Unrealized loss"><Amount value={strategyState.unrealizedLoss} /></StateRow>
                    <StateRow label="Realized yield"><Amount value={strategyState.realizedYield} /></StateRow>
                    <StateRow label="Realized loss"><Amount value={strategyState.realizedLoss} /></StateRow>
                    <StateRow label="Fees accrued"><Amount value={strategyState.feesAccrued} /></StateRow>
                    <StateRow label="Withdrawal shortfall"><Amount value={strategyState.withdrawalShortfall} /></StateRow>
                    <StateRow label="Valuation status"><strong>{strategyState.valuationStatusLabel}</strong></StateRow>
                    <StateRow label="Valuation block"><strong>{strategyState.valuationBlock.toString()}</strong></StateRow>
                    <StateRow label="Valuation source"><AddressValue value={strategyState.valuationSource} title={strategyState.valuationSource} /></StateRow>
                  </>
                )}
              </>
            )}
          </div>

          {showAdminSections && (
            <div className="vx-core-state-group">
              <h3>Risk Policy & Roles</h3>
              <StateRow label="Minimum reserve"><Amount value={coreState.minimumLiquidReserve} /></StateRow>
              <StateRow label="Minimum reserve BPS"><strong>{coreState.minimumLiquidReserveBps}</strong></StateRow>
              <StateRow label="Policy admin"><strong>{coreState.roles.policyAdmin ? 'Connected wallet' : 'No'}</strong></StateRow>
              <StateRow label="Timelock executor"><strong>{coreState.roles.timelockExecutor ? 'Connected wallet' : 'No'}</strong></StateRow>
              <StateRow label="Automation"><strong>{coreState.roles.automation ? 'Connected wallet' : 'No'}</strong></StateRow>
              <StateRow label="Emergency"><strong>{coreState.roles.emergency ? 'Connected wallet' : 'No'}</strong></StateRow>
            </div>
          )}
        </div>
      )}
      {showAdminSections && adminProjection && <AdminProjectionDashboard projection={adminProjection} />}
    </section>
  );
}