import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useTreasuryUserProjection } from '../../treasury/hooks/useTreasuryUserProjection';
import { useWalletStatus } from '../../../hooks/useWalletStatus';
import { hasWalletApiSession, useWalletApiAuthProgress, useWalletApiSession, type WalletApiSession } from '../../../hooks/useWalletApiAuth';
import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';

export type AiMode = 'user' | 'admin';
type DataRecord = Record<string, unknown>;
type AiError = { readonly mode: AiMode; readonly message: string } | null;

export function hasCurrentWalletApiSession(session: WalletApiSession | null | undefined, address: string | undefined, now = Date.now()): boolean {
  const expiresAt = Date.parse(session?.expiresAt ?? '');
  return hasWalletApiSession(session, address) && Number.isFinite(expiresAt) && expiresAt > now;
}

export function canSubmitUserAi(isAuthenticated: boolean, projection: UserFinancialProjectionModel | null): boolean {
  return isAuthenticated && projection !== null;
}
export interface UserAiTurn {
  readonly id: number;
  readonly walletAddress: string;
  readonly prompt: string;
  readonly answer?: string;
  readonly error?: string;
}
export interface AdminAiTurn {
  readonly id: number;
  readonly walletAddress: string;
  readonly prompt: string;
  readonly recommendation?: DataRecord;
  readonly error?: string;
}

export function AiErrorNotice({ message }: { readonly message: string }) {
  return <p className="vx-ai-error" role="alert">{message}</p>;
}

function asRecord(value: unknown): DataRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

export function isAuthorizedAdminProjection(value: unknown, walletAddress: string | undefined): boolean {
  const projection = asRecord(value);
  const authorization = asRecord(projection?.authorization);
  const policyAdmin = asRecord(authorization?.policyAdmin);
  return Boolean(walletAddress
    && projection?.scope === 'ADMIN'
    && projection.chainId === 5042
    && typeof projection.authenticatedWalletAddress === 'string'
    && projection.authenticatedWalletAddress.toLowerCase() === walletAddress.toLowerCase()
    && policyAdmin?.source === 'CORE'
    && policyAdmin.availability === 'AVAILABLE'
    && policyAdmin.value === true);
}

export function resolveAiMode(
  walletAddress: string | undefined,
  serverAdminProjection: unknown,
  userModeWalletAddress: string | null,
): AiMode {
  const isAdminAuthorized = isAuthorizedAdminProjection(serverAdminProjection, walletAddress);
  const userModeWasSelectedForWallet = Boolean(walletAddress
    && userModeWalletAddress
    && walletAddress.toLowerCase() === userModeWalletAddress.toLowerCase());
  return isAdminAuthorized && !userModeWasSelectedForWallet ? 'admin' : 'user';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Unavailable';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'Unavailable';
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized || ['NULL', 'UNKNOWN', 'UNAVAILABLE', 'DATA_UNAVAILABLE'].includes(normalized.toUpperCase())) return 'Unavailable';
    return normalized;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return 'Unavailable';
}

export function responseError(status: number, message: unknown): string {
  const detail = typeof message === 'string' ? message : '';
  if (/AI provider is not configured/i.test(detail)) return 'AI provider configuration unavailable. Please try again later.';
  if (/AI provider configuration is unavailable/i.test(detail)) return 'AI provider configuration is unavailable. Please contact support.';
  if (/AI provider rate limit reached/i.test(detail)) return 'AI provider rate limit reached. Please try again later.';
  if (/Configured AI model or endpoint is unavailable/i.test(detail)) return 'The configured AI model or endpoint is unavailable.';
  if (/AI provider returned an invalid response/i.test(detail)) return 'The AI provider returned an invalid response.';
  if (/AI provider request timed out/i.test(detail)) return 'AI provider request timed out. Please try again.';
  if (/AI provider request failed due to a network error/i.test(detail)) return 'AI provider network request failed. Please try again.';
  if (/AI provider could not complete the request/i.test(detail)) return 'AI provider could not complete the request.';
  if (status === 401) return 'AI response unavailable. Authentication required; authenticate your wallet and try again.';
  if (status === 403) return 'AI response unavailable. This wallet is not authorized for the requested AI boundary.';
  if (status === 503 && /wallet authentication/i.test(detail)) return 'AI response unavailable. Wallet authentication is temporarily unavailable; the server cannot verify this session.';
  if (status === 408 || status === 504) return 'AI response unavailable. The request timed out; try again.';
  if (status === 502 || status === 503 || status === 429) return 'AI response unavailable. The AI provider is unavailable or busy; try again later.';
  if (status === 409 || status === 422) return 'The request could not pass policy or data validation. Review the authoritative data and try again.';
  if (status >= 500) {
    return /timeout|timed out/i.test(detail)
      ? 'AI response unavailable. The request timed out; try again.'
      : /provider|upstream|model service/i.test(detail)
        ? 'AI response unavailable. The AI provider is unavailable; try again later.'
        : 'AI response unavailable. The server could not complete the request.';
  }
  return 'AI response unavailable. The request was rejected; check the prompt and try again.';
}

export function requestFailureMessage(error: unknown): string {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'AI response unavailable. The request timed out; try again.';
  }
  if (error instanceof TypeError) return 'AI response unavailable. Unable to reach the service; check your connection and try again.';
  return error instanceof Error ? error.message : 'AI response unavailable. The request failed.';
}

export function userProjectionErrorMessage(error: Error): string {
  const reason = error.message.trim();
  if (/wallet authentication is temporarily unavailable/i.test(reason)) {
    return 'Your User AI data could not be loaded. Wallet authentication is temporarily unavailable; the server cannot verify this session.';
  }
  if (/authentication required|session (is )?(missing|expired)|authenticate the connected wallet/i.test(reason)) {
    return 'Your User AI data could not be loaded. Authentication required; connect and authenticate your wallet.';
  }
  if (/arc mainnet|wrong network/i.test(reason)) {
    return 'Your User AI data could not be loaded. Switch to Arc Mainnet (Chain ID 5042).';
  }
  if (/temporarily unavailable|request failed/i.test(reason)) {
    return `Your User AI data could not be loaded. ${reason}`;
  }
  return reason
    ? `Your AI Assistant data could not be loaded. ${reason}`
    : 'Your AI Assistant data could not be loaded. The User projection is unavailable.';
}

export function isUserAiResponse(value: unknown, walletAddress: string | undefined): value is DataRecord & { answer: string } {
  const payload = asRecord(value);
  return Boolean(payload
    && payload.scope === 'USER'
    && typeof payload.authenticatedWalletAddress === 'string'
    && payload.authenticatedWalletAddress.toLowerCase() === walletAddress?.toLowerCase()
    && typeof payload.answer === 'string'
    && payload.answer.trim());
}

export function isAdminAiResponse(value: unknown, walletAddress: string | undefined): value is DataRecord & { recommendation: DataRecord } {
  const payload = asRecord(value);
  const recommendation = asRecord(payload?.recommendation);
  return Boolean(payload
    && payload.scope === 'ADMIN'
    && typeof payload.authenticatedWalletAddress === 'string'
    && payload.authenticatedWalletAddress.toLowerCase() === walletAddress?.toLowerCase()
    && recommendation
    && recommendation.actor === 'AI'
    && recommendation.executionStatus === 'NOT_EXECUTABLE'
    && typeof recommendation.recommendationId === 'string'
    && typeof recommendation.actionType === 'string'
    && typeof recommendation.target === 'string'
    && typeof recommendation.createdAt === 'string'
    && Array.isArray(recommendation.rationale)
    && recommendation.rationale.every((item) => typeof item === 'string')
    && Array.isArray(recommendation.evidenceReferences)
    && recommendation.evidenceReferences.every((item) => typeof item === 'string'));
}

export async function requestAiAnalysis(
  mode: AiMode,
  prompt: string,
  walletAddress: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<DataRecord> {
  const response = await fetcher(mode === 'user' ? '/api/ai/user' : '/api/ai/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ prompt }),
  });
  const payload = await response.json().catch(() => null) as unknown;
  const record = asRecord(payload);
  if (!response.ok) throw new Error(responseError(response.status, record?.error));
  if (mode === 'user' && !isUserAiResponse(payload, walletAddress)) {
    throw new Error('Invalid User AI response. No answer was displayed.');
  }
  if (mode === 'admin' && !isAdminAiResponse(payload, walletAddress)) {
    throw new Error('Invalid Admin AI recommendation. No recommendation was displayed.');
  }
  return record!;
}

const userPromptSuggestions = [
  'Explain my Treasury balance',
  'Explain my current P/L',
  'How much can I withdraw?',
  'Explain my Earn position',
  'What is my strategy status?',
];

function PromptSuggestions({ values, onChoose }: { readonly values: readonly string[]; readonly onChoose: (value: string) => void }) {
  return (
    <div className="vx-ai-suggestions" aria-label="Prompt suggestions">
      {values.map((value) => (
        <button key={value} type="button" className="vx-btn vx-btn-secondary" onClick={() => onChoose(value)}>{value}</button>
      ))}
    </div>
  );
}

export interface UserAiPanelProps {
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly isAuthenticated: boolean;
  readonly authenticationLoading: boolean;
  readonly authenticationError: Error | null;
  readonly authenticationStatus: 'idle' | 'pending' | 'rejected' | 'failed';
  readonly userProjection: UserFinancialProjectionModel | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly prompt: string;
  readonly turns: readonly UserAiTurn[];
  readonly requestError: string | null;
  readonly submitting: boolean;
  readonly onPromptChange: (value: string) => void;
  readonly onSubmit: () => Promise<void>;
}

export function UserAiPanel(props: UserAiPanelProps) {
  const { isConnected, isArcMainnet, isAuthenticated, authenticationLoading, authenticationError, authenticationStatus, userProjection, isLoading, error, prompt, turns, requestError, submitting, onPromptChange, onSubmit } = props;

  return (
    <section className="vx-ai-panel" aria-label="AI Assistant chat">
      <header className="vx-ai-window-heading">
        <div>
          <h2>AI Assistant</h2>
          <p>Ask about your Treasury, Earn, balance, P/L, withdrawals, or strategy.</p>
        </div>
      </header>

      <div className="vx-ai-conversation" aria-label="User AI conversation" aria-live="polite">
        {!isConnected && <p className="vx-ai-status" role="status">Connect wallet to use AI Assistant.</p>}
        {isConnected && !isArcMainnet && <p className="vx-ai-error" role="alert">Switch to Arc Mainnet (Chain ID 5042) to use AI Assistant.</p>}
        {isConnected && isArcMainnet && authenticationLoading && <p className="vx-ai-status" role="status">Checking API authentication…</p>}
        {isConnected && isArcMainnet && authenticationError && (
          <AiErrorNotice message="Wallet sign-in is temporarily unavailable. Please try again later." />
        )}
        {isConnected && isArcMainnet && !authenticationLoading && !authenticationError && !isAuthenticated && (
          <div className="vx-ai-auth-state">
            <p className="vx-ai-status" role="status">Authentication required. AI Assistant will be available after wallet sign-in.</p>
            <p>{authenticationStatus === 'pending'
              ? 'Approve the one-time sign-in message in your wallet to continue.'
              : authenticationStatus === 'rejected'
                ? 'Authentication was not completed. Please approve the wallet message to continue.'
                : authenticationStatus === 'failed'
                  ? 'Wallet sign-in could not be completed. Please reconnect your wallet to try again.'
                  : 'Your wallet will request a one-time sign-in message.'}</p>
          </div>
        )}
        {isAuthenticated && isLoading && <p className="vx-ai-status" role="status">Loading your authenticated User projection…</p>}
        {isAuthenticated && error && <AiErrorNotice message={userProjectionErrorMessage(error)} />}
        {isAuthenticated && !isLoading && !error && !userProjection && <p className="vx-ai-status" role="status">Your AI Assistant data is currently unavailable. No values have been substituted.</p>}
        {isAuthenticated && turns.length === 0 && (
          <article className="vx-ai-turn vx-ai-assistant-message" data-testid="assistant-welcome-message">
            <span>AI Assistant</span>
            <p>Hi! I’m your Velox AI Assistant. Ask me about your Treasury or Earn account.</p>
          </article>
        )}
        {turns.map((turn) => (
          <article key={turn.id} className="vx-ai-turn" data-testid="user-ai-turn">
            <div className="vx-ai-user-message"><span>You</span><p>{turn.prompt}</p></div>
            <div className="vx-ai-assistant-message">
              <span>AI Assistant</span>
              {turn.answer ? <p>{turn.answer}</p> : turn.error
                ? <div className="vx-ai-turn-error" role="alert"><strong>AI response unavailable.</strong><p>{turn.error.replace(/^AI response unavailable\.\s*/, '')}</p></div>
                : <p className="vx-ai-status" role="status">{submitting ? 'AI is analyzing your request…' : 'Waiting for a response…'}</p>}
            </div>
          </article>
        ))}
        {requestError && <AiErrorNotice message={requestError} />}
      </div>

      <div className="vx-ai-form-block vx-ai-composer">
        <label htmlFor="user-ai-prompt" className="vx-ai-label">Ask AI</label>
        <textarea
          id="user-ai-prompt"
          className="vx-ai-textarea"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Ask about your own balance, P/L, withdrawal state, or unavailable data"
          rows={5}
        />
        <PromptSuggestions values={userPromptSuggestions} onChoose={onPromptChange} />
        <div className="vx-ai-actions">
          <button type="button" className="vx-btn vx-btn-primary" disabled={!canSubmitUserAi(isAuthenticated, userProjection) || submitting || !prompt.trim()} onClick={() => void onSubmit()}>
            {submitting ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  );
}

function projectionField(value: unknown): { readonly display: string; readonly source: string; readonly availability: string } {
  const wrapped = asRecord(value);
  if (wrapped && typeof wrapped.availability === 'string') {
    const availability = wrapped.availability;
    return {
      display: availability === 'AVAILABLE' ? formatValue(wrapped.value) : 'Unavailable',
      source: typeof wrapped.source === 'string' ? wrapped.source : 'Unknown source',
      availability,
    };
  }
  return { display: 'Unavailable', source: 'Unknown source', availability: 'UNAVAILABLE' };
}

function AdminProjectionSummary({ projection }: { readonly projection: DataRecord }) {
  const treasury = asRecord(projection.treasury);
  const approvals = asRecord(projection.approvals);
  const riskPolicy = asRecord(projection.riskPolicy);
  const bucketPolicy = asRecord(projection.bucketPolicy);
  const strategy = asRecord(projection.strategy);
  const strategies = asRecord(projection.strategies);
  const strategySections = asRecord(strategies?.data);
  const exposure = asRecord(projection.exposure);
  const exposureData = asRecord(exposure?.data);
  const operationalStatus = asRecord(projection.operationalStatus);
  const operationalData = asRecord(operationalStatus?.data);
  const treasuryFields = [
    { label: 'Total user liabilities (base units)', value: treasury?.totalUserLiabilities },
    { label: 'Liquid USDC (base units)', value: treasury?.liquidUSDC },
    { label: 'Required reserve (base units)', value: treasury?.requiredLiquidReserve },
    { label: 'Available liquidity (base units)', value: treasury?.availableLiquidity },
    { label: 'Total deployed (base units)', value: treasury?.totalDeployed },
    { label: 'Total managed assets (base units)', value: treasury?.totalManagedAssets },
    { label: 'Treasury paused', value: treasury?.paused },
    { label: 'Minimum liquid reserve (base units)', value: riskPolicy?.minimumLiquidReserve },
    { label: 'Minimum liquid reserve (BPS)', value: riskPolicy?.minimumLiquidReserveBps },
    { label: 'Maximum deployed (base units)', value: riskPolicy?.maximumTotalDeployed },
  ];
  const approvalFields = [
    { label: 'Approved protocol count', value: approvals?.approvedProtocolCount },
    { label: 'Approved asset count', value: approvals?.approvedAssetCount },
    { label: 'Approved strategy count', value: approvals?.approvedStrategyCount },
  ];
  const bucketFields = [
    { label: 'Operational reserve (BPS)', value: bucketPolicy?.liquidOperationalReserveBps },
    { label: 'Yield strategy buffer (BPS)', value: bucketPolicy?.yieldStrategyBufferBps },
    { label: 'Sweep liquidity buffer (BPS)', value: bucketPolicy?.sweepLiquidityBufferBps },
    { label: 'Automation agent pool (BPS)', value: bucketPolicy?.automationAgentPoolBps },
  ];
  const strategyFields = [
    { label: 'Configured adapter', value: strategy?.adapterAddress },
    { label: 'Strategy principal (base units)', value: strategy?.principal },
    { label: 'Strategy current value (base units)', value: strategy?.currentValue },
    { label: 'Strategy shares', value: strategy?.shares },
    { label: 'Strategy total P/L (base units)', value: strategy?.totalPnl },
    { label: 'Valuation status', value: strategy?.valuationStatusLabel },
    { label: 'Valuation block', value: strategy?.valuationBlock },
    { label: 'Configured strategy approved', value: strategy?.approved },
    { label: 'Configured strategy enabled', value: strategy?.enabled },
  ];
  const exposureFields = [
    { label: 'Configured strategy value (base units)', value: exposureData?.configuredStrategyCurrentValue },
    { label: 'Configured strategy cap (base units)', value: exposureData?.configuredStrategyAbsoluteCap },
    { label: 'Remaining absolute capacity (base units)', value: exposureData?.configuredStrategyRemainingAbsoluteCapacity },
    { label: 'Protocol exposure', value: exposureData?.protocolExposure },
    { label: 'Asset exposure', value: exposureData?.assetExposure },
    { label: 'Relative exposure (BPS)', value: exposureData?.relativeExposure },
    { label: 'Historical exposure', value: exposureData?.historicalExposure },
  ];
  const availabilitySections = [
    { label: 'Complete strategy registry', value: strategySections?.registry },
    { label: 'Approved protocol registry', value: projection.protocols },
    { label: 'Approved asset registry', value: projection.assets },
    { label: 'Pending timelock operations', value: projection.timelocks },
    { label: 'Historical yield and Treasury flows', value: projection.history },
    { label: 'Historical exposure series', value: projection.exposureHistory },
  ];
  const block = projectionField(treasury?.blockNumber);

  const renderFields = (fields: readonly { readonly label: string; readonly value: unknown }[]) => fields.map((field) => {
    const value = projectionField(field.value);
    return (
      <div key={field.label} className="vx-ai-summary-item">
        <span className="vx-ai-summary-label">{field.label}</span>
        <strong>{value.display}</strong>
        <small>{value.source} · {value.availability}</small>
      </div>
    );
  });

  return (
    <details className="vx-ai-projection-details">
      <summary>Authorized Admin projection · {block.availability === 'AVAILABLE' ? `Core block ${block.display}` : 'block unavailable'}</summary>
      <div className="vx-ai-projection-content">
      <section className="vx-ai-data-section">
        <h3>Authorized Treasury and risk data</h3>
        <div className="vx-ai-summary-grid" aria-label="Authorized Admin projection">{renderFields(treasuryFields)}</div>
      </section>
      <section className="vx-ai-data-section">
        <h3>Approvals and bucket policy</h3>
        <div className="vx-ai-summary-grid">{renderFields([...approvalFields, ...bucketFields])}</div>
      </section>
      <section className="vx-ai-data-section">
        <h3>Configured strategy and exposure</h3>
        <p className="vx-ai-status">Exposure section: {formatValue(exposure?.source)} · {formatValue(exposure?.availability)}. {typeof exposure?.reason === 'string' ? exposure.reason : ''}</p>
        <div className="vx-ai-summary-grid">{renderFields([...strategyFields, ...exposureFields])}</div>
      </section>
      <section className="vx-ai-data-section">
        <h3>Data availability</h3>
        <div className="vx-ai-summary-grid">
          {availabilitySections.map((section) => {
            const metadata = asRecord(section.value);
            const availability = typeof metadata?.availability === 'string' ? metadata.availability : 'UNAVAILABLE';
            const source = typeof metadata?.source === 'string' ? metadata.source : 'Unknown source';
            return (
              <div key={section.label} className="vx-ai-summary-item">
                <span className="vx-ai-summary-label">{section.label}</span>
                <strong>{availability === 'AVAILABLE' ? 'Available' : availability === 'PARTIAL' ? 'Partial' : 'Unavailable'}</strong>
                <small>{source} · {availability}</small>
                {typeof metadata?.reason === 'string' && <small>{metadata.reason}</small>}
              </div>
            );
          })}
        </div>
      </section>
      <p className="vx-ai-status" role="status">
        Authorized projection freshness: {block.availability === 'AVAILABLE' ? `Core block ${block.display}` : 'block unavailable'}.
        {' '}Operational status: {formatValue(operationalStatus?.source)} · {formatValue(operationalStatus?.availability)}.
        {' '}Paused: {projectionField(operationalData?.paused).display}.
      </p>
      </div>
    </details>
  );
}

export interface AdminAiPanelProps {
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly isPolicyAdmin: boolean;
  readonly projection: DataRecord | null;
  readonly projectionLoading: boolean;
  readonly projectionError: string | null;
  readonly prompt: string;
  readonly turns: readonly AdminAiTurn[];
  readonly requestError: string | null;
  readonly submitting: boolean;
  readonly onPromptChange: (value: string) => void;
  readonly onSubmit: () => Promise<void>;
}

export function AdminAiPanel(props: AdminAiPanelProps) {
  const { isConnected, isArcMainnet, isPolicyAdmin, projection, projectionLoading, projectionError, prompt, turns, requestError, submitting, onPromptChange, onSubmit } = props;

  if (!isConnected) return <div className="vx-ai-state-card"><h3>Admin AI</h3><p>Connect and authenticate an authorized wallet to continue.</p></div>;
  if (!isArcMainnet) return <div className="vx-ai-state-card"><h3>Admin AI</h3><p>Switch to Arc Mainnet before requesting the Admin projection.</p></div>;
  if (!isPolicyAdmin) return <div className="vx-ai-state-card"><h3>Admin AI</h3><p>Admin authorization is required. The server remains authoritative.</p></div>;

  return (
    <section className="vx-ai-panel vx-ai-admin-panel" aria-label="Admin AI advisory">
      <header className="vx-ai-window-heading"><h2>Admin AI</h2><span>Authorized advisory conversation</span></header>
      {projection && <AdminProjectionSummary projection={projection} />}
      {projectionLoading && <p className="vx-ai-status" role="status">Loading the server-authorized Admin projection…</p>}
      {projectionError && <p className="vx-ai-error" role="alert">{projectionError}</p>}
      {!projectionLoading && !projectionError && !projection && <p className="vx-ai-status" role="status">Authorized Admin data is unavailable.</p>}

      <div className="vx-ai-conversation" aria-label="Admin AI conversation" aria-live="polite">
        {turns.length === 0 && <p className="vx-ai-empty-conversation">Your Admin questions and recommendations will appear here.</p>}
        {turns.map((turn) => {
          const recommendation = turn.recommendation;
          const rationale = Array.isArray(recommendation?.rationale) ? recommendation.rationale.filter((item): item is string => typeof item === 'string') : [];
          const evidence = Array.isArray(recommendation?.evidenceReferences) ? recommendation.evidenceReferences.filter((item): item is string => typeof item === 'string') : [];
          const createdAt = typeof recommendation?.createdAt === 'string' ? recommendation.createdAt : null;
          const formattedCreatedAt = createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toLocaleString() : 'Unavailable';
          return (
            <article key={turn.id} className="vx-ai-turn" data-testid="admin-ai-turn">
              <div className="vx-ai-user-message"><span>You</span><p>{turn.prompt}</p></div>
              {recommendation ? (
                <div className="vx-ai-recommendation-content">
                  <div className="vx-ai-advisory-banner">
                    <span className="vx-ai-badge warning">AI recommendation only</span>
                    <strong>Not approved · Not executable · No transaction completed</strong>
                  </div>
                  <section className="vx-step-callout info" aria-label="Recommendation, Admin decision, and execution states">
                    <div><strong>AI recommendation:</strong> Advisory only; it cannot sign, broadcast, move funds, or change policy.</div>
                    <div><strong>Admin decision:</strong> NOT_RECORDED. Review the recommendation separately and copy it only into an editable Treasury policy draft.</div>
                    <div><strong>Blockchain execution:</strong> NOT_STARTED. Any later operation requires an explicit Admin action and Core authorization.</div>
                  </section>
                  <dl className="vx-ai-field-list">
                    <div className="vx-ai-field"><dt>Recommendation ID</dt><dd>{formatValue(recommendation.recommendationId)}</dd></div>
                    <div className="vx-ai-field"><dt>Action</dt><dd>{formatValue(recommendation.actionType)}</dd></div>
                    <div className="vx-ai-field"><dt>Target</dt><dd>{formatValue(recommendation.target)}</dd></div>
                    <div className="vx-ai-field"><dt>Requested amount</dt><dd>{formatValue(recommendation.requestedAmount)}</dd></div>
                    <div className="vx-ai-field"><dt>Risk classification</dt><dd>{formatValue(recommendation.riskClassification)}</dd></div>
                    <div className="vx-ai-field"><dt>Policy validation</dt><dd>{formatValue(recommendation.policyValidationStatus)}</dd></div>
                    <div className="vx-ai-field"><dt>Human review required</dt><dd>{formatValue(recommendation.requiredApproval)}</dd></div>
                    <div className="vx-ai-field"><dt>Generated at</dt><dd>{formattedCreatedAt}</dd></div>
                    <div className="vx-ai-field"><dt>Execution status</dt><dd>{formatValue(recommendation.executionStatus)}</dd></div>
                  </dl>
                  <section className="vx-ai-section">
                    <h4>Reasoning</h4>
                    {rationale.length ? <ul>{rationale.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>Reasoning unavailable.</p>}
                    {typeof recommendation.expectedEffect === 'string' && <p>{recommendation.expectedEffect}</p>}
                    {typeof recommendation.reason === 'string' && <p>{recommendation.reason}</p>}
                  </section>
                  <section className="vx-ai-section">
                    <h4>Evidence references</h4>
                    {evidence.length ? <ul>{evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>Evidence references unavailable.</p>}
                  </section>
                </div>
              ) : turn.error
                ? <div className="vx-ai-turn-error" role="alert"><strong>AI response unavailable.</strong><p>{turn.error.replace(/^AI response unavailable\.\s*/, '')}</p></div>
                : <p className="vx-ai-status" role="status">{submitting ? 'AI is analyzing your request…' : 'Waiting for an advisory response…'}</p>}
            </article>
          );
        })}
      </div>
      {requestError && <AiErrorNotice message={requestError} />}

      <div className="vx-ai-form-block vx-ai-composer">
        <label htmlFor="admin-ai-prompt" className="vx-ai-label">Ask Admin AI</label>
        <textarea
          id="admin-ai-prompt"
          className="vx-ai-textarea"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Ask for analysis of the authorized Treasury and risk-policy projection"
          rows={5}
        />
        <PromptSuggestions
          values={[
            'Analyze current Treasury state',
            'Explain current liquidity and reserves',
            'Explain configured strategy exposure',
            'Explain current policy state',
            'Summarize current operational state',
            'Identify unavailable data',
          ]}
          onChoose={onPromptChange}
        />
        <div className="vx-ai-actions">
          <button type="button" className="vx-btn vx-btn-primary" disabled={submitting || !prompt.trim()} onClick={() => void onSubmit()}>
            {submitting ? 'Analyzing…' : 'Ask Admin AI'}
          </button>
        </div>
      </div>
    </section>
  );
}

export function AiAssistantPage() {
  const wallet = useWalletStatus();
  const userProjection = useTreasuryUserProjection(wallet.isConnected, wallet.isArcMainnet, wallet.address);
  const apiSession = useWalletApiSession(wallet.address, wallet.isConnected && wallet.isArcMainnet);
  const authProgress = useWalletApiAuthProgress(wallet.address, wallet.isConnected && wallet.isArcMainnet);
  const [sessionClock, setSessionClock] = useState(() => Date.now());
  const sessionExpiresAt = apiSession.data?.expiresAt;
  useEffect(() => {
    const expirationTime = Date.parse(sessionExpiresAt ?? '');
    if (!Number.isFinite(expirationTime)) return;
    const timeoutId = setTimeout(() => setSessionClock(Date.now()), Math.max(0, expirationTime - Date.now() + 1));
    return () => clearTimeout(timeoutId);
  }, [sessionExpiresAt]);
  const isApiAuthenticated = hasCurrentWalletApiSession(apiSession.data, wallet.address, sessionClock);
  const [userModeWalletAddress, setUserModeWalletAddress] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState('');
  const [adminPrompt, setAdminPrompt] = useState('');
  const [userTurns, setUserTurns] = useState<UserAiTurn[]>([]);
  const [adminTurns, setAdminTurns] = useState<AdminAiTurn[]>([]);
  const [requestError, setRequestError] = useState<AiError>(null);
  const [submittingUser, setSubmittingUser] = useState(false);
  const [submittingAdmin, setSubmittingAdmin] = useState(false);
  const turnSequence = useRef(0);

  const adminProjectionQuery = useQuery({
    queryKey: ['ai-admin-projection', wallet.address],
    enabled: wallet.isConnected && wallet.isArcMainnet && isApiAuthenticated,
    staleTime: 10_000,
    queryFn: async (): Promise<DataRecord> => {
      let response: Response;
      try {
        response = await fetch('/api/admin-projection', { headers: { accept: 'application/json' }, cache: 'no-store' });
      } catch (error) {
        throw new Error(requestFailureMessage(error));
      }
      const payload = await response.json().catch(() => null) as unknown;
      const projection = asRecord(payload);
      if (!response.ok) throw new Error(responseError(response.status, projection?.error));
      if (!projection || !isAuthorizedAdminProjection(projection, wallet.address)) {
        throw new Error('Invalid Admin projection response. No privileged data was displayed.');
      }
      return projection;
    },
  });
  const currentAdminProjection = isApiAuthenticated && wallet.isConnected && wallet.isArcMainnet
    ? adminProjectionQuery.data
    : null;
  const canUseAdmin = isAuthorizedAdminProjection(currentAdminProjection, wallet.address);
  const mode = resolveAiMode(wallet.address, currentAdminProjection, userModeWalletAddress);

  const submitPrompt = async (target: AiMode): Promise<void> => {
    const prompt = (target === 'user' ? userPrompt : adminPrompt).trim();
    if (!prompt) {
      setRequestError({ mode: target, message: 'Enter a prompt before requesting analysis.' });
      return;
    }
    if (!isApiAuthenticated) {
      setRequestError({ mode: target, message: 'Authentication required. Authenticate API to use AI Assistant.' });
      return;
    }
    if (target === 'user' && !userProjection.projection) {
      setRequestError({ mode: target, message: 'Your User AI data is currently unavailable.' });
      return;
    }
    if (!wallet.address) {
      setRequestError({ mode: target, message: 'Connect and authenticate a wallet before requesting AI analysis.' });
      return;
    }
    if (target === 'admin' && !canUseAdmin) {
      setRequestError({ mode: target, message: 'Admin authorization is required.' });
      return;
    }

    const turnId = ++turnSequence.current;
    const requestWalletAddress = wallet.address;
    setRequestError(null);
    if (target === 'user') {
      setUserTurns((current) => [...current, { id: turnId, walletAddress: requestWalletAddress, prompt }]);
      setSubmittingUser(true);
    } else {
      setAdminTurns((current) => [...current, { id: turnId, walletAddress: requestWalletAddress, prompt }]);
      setSubmittingAdmin(true);
    }

    try {
      const result = await requestAiAnalysis(target, prompt, requestWalletAddress);
      if (target === 'user') {
        setUserTurns((current) => current.map((turn) => turn.id === turnId
          ? { ...turn, answer: result.answer as string }
          : turn));
      } else {
        const recommendation = asRecord(result.recommendation);
        setAdminTurns((current) => current.map((turn) => turn.id === turnId
          ? { ...turn, recommendation: recommendation ?? undefined }
          : turn));
      }
    } catch (caught) {
      const errorMessage = requestFailureMessage(caught);
      if (target === 'user') {
        setUserTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, error: errorMessage } : turn));
      } else {
        setAdminTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, error: errorMessage } : turn));
      }
    } finally {
      if (target === 'user') setSubmittingUser(false);
      else setSubmittingAdmin(false);
    }
  };

  return (
    <div className="vx-ai-page">
      {canUseAdmin && <div className="vx-ai-toolbar">
        <div className="vx-ai-mode-toggle" role="tablist" aria-label="AI modes">
          <button type="button" className={`vx-ai-mode-button ${mode === 'user' ? 'active' : ''}`} role="tab" aria-selected={mode === 'user'} onClick={() => setUserModeWalletAddress(wallet.address?.toLowerCase() ?? null)}>
            AI Assistant
          </button>
          {canUseAdmin && <button type="button" className={`vx-ai-mode-button ${mode === 'admin' ? 'active' : ''}`} role="tab" aria-selected={mode === 'admin'} onClick={() => setUserModeWalletAddress(null)}>
            Admin AI
          </button>}
        </div>
      </div>}

      {mode !== 'admin' || !canUseAdmin ? (
        <UserAiPanel
          isConnected={wallet.isConnected}
          isArcMainnet={wallet.isArcMainnet}
            isAuthenticated={isApiAuthenticated}
            authenticationLoading={apiSession.isLoading}
            authenticationError={apiSession.error instanceof Error ? apiSession.error : null}
            authenticationStatus={authProgress.data?.status ?? 'idle'}
          userProjection={userProjection.projection}
            isLoading={isApiAuthenticated && userProjection.isLoading}
          error={userProjection.error}
          prompt={userPrompt}
          turns={userTurns.filter((turn) => turn.walletAddress.toLowerCase() === wallet.address?.toLowerCase())}
          requestError={requestError?.mode === 'user' ? requestError.message : null}
          submitting={submittingUser}
          onPromptChange={setUserPrompt}
          onSubmit={() => submitPrompt('user')}
        />
      ) : (
        <AdminAiPanel
          isConnected={wallet.isConnected}
          isArcMainnet={wallet.isArcMainnet}
          isPolicyAdmin={canUseAdmin}
          projection={adminProjectionQuery.data ?? null}
          projectionLoading={adminProjectionQuery.isLoading}
          projectionError={adminProjectionQuery.error instanceof Error ? adminProjectionQuery.error.message : null}
          prompt={adminPrompt}
          turns={adminTurns.filter((turn) => turn.walletAddress.toLowerCase() === wallet.address?.toLowerCase())}
          requestError={requestError?.mode === 'admin' ? requestError.message : null}
          submitting={submittingAdmin}
          onPromptChange={setAdminPrompt}
          onSubmit={() => submitPrompt('admin')}
        />
      )}
    </div>
  );
}

export default AiAssistantPage;
