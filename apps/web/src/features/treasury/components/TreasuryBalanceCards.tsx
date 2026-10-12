import type { TokenBalanceDescriptor, TreasuryBalanceModel } from '../types';

interface TreasuryBalanceCardsProps {
  readonly balances: TreasuryBalanceModel;
  readonly walletBalance: TokenBalanceDescriptor;
  readonly onOpenDeposit: () => void;
  readonly isDepositEnabled: boolean;
  readonly onOpenWithdraw: () => void;
  readonly isWithdrawEnabled: boolean;
  readonly onRefreshBalance?: () => void;
  readonly isRefreshing?: boolean;
  readonly canViewAdmin?: boolean;
  readonly withdrawDisabledReason?: string;
}

interface BalanceCardProps {
  readonly title: string;
  readonly descriptor: TokenBalanceDescriptor;
  readonly description: string;
  readonly highlight?: boolean;
}

function BalanceCard({ title, descriptor, description, highlight, canViewAdmin = false }: BalanceCardProps & { readonly canViewAdmin?: boolean }) {
  const isAvailableValue = descriptor.state === 'synced' && descriptor.formattedAmount !== null;
  const isLoading = descriptor.state === 'loading';
  const isError = descriptor.state === 'error';

  let badgeClassName = 'vx-balance-badge';
  if (isLoading) {
    badgeClassName += ' loading';
  } else if (isError) {
    badgeClassName += ' error';
  } else if (descriptor.state === 'wrong_network' || descriptor.state === 'disconnected') {
    badgeClassName += ' warning';
  }
  const userMessage = descriptor.state === 'loading'
    ? 'Loading balance…'
    : descriptor.state === 'error'
      ? 'Balance temporarily unavailable. Try refreshing.'
      : descriptor.state === 'wrong_network'
        ? 'Switch to Arc Mainnet to view your balance.'
        : descriptor.state === 'disconnected'
          ? 'Connect your wallet to view your balance.'
          : 'Not available yet.';

  return (
    <div className={`vx-card ${highlight ? 'highlight' : ''}`}>
      <div>
        <div className="vx-card-header">
          <span className="vx-card-label">{title}</span>
          <span className="vx-token-badge">
            <span
              className={`vx-dot ${
                isAvailableValue ? 'vx-dot-success' : isError ? 'vx-dot-warning' : 'vx-dot-muted'
              }`}
            />
            {descriptor.symbol}
          </span>
        </div>

        <div className="vx-balance-value-container">
          {isAvailableValue ? (
            <div>
              <div className="vx-balance-amount">
                {descriptor.formattedAmount}{' '}
                <span style={{ fontSize: '1rem', color: 'var(--vx-text-secondary)' }}>
                  {descriptor.symbol}
                </span>
              </div>
              {canViewAdmin && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--vx-text-muted)',
                  marginTop: '0.25rem',
                }}
              >
                Arc Native USDC (6 Decimals)
              </div>
              )}
            </div>
          ) : (
            <div
              className={badgeClassName}
              title={canViewAdmin ? descriptor.message : userMessage}
              role={isError ? 'alert' : 'status'}
            >
              {isLoading && <span className="vx-spinner" aria-hidden="true" />}
              {canViewAdmin ? descriptor.message : userMessage}
            </div>
          )}
        </div>
      </div>

      <div className="vx-card-footer">
        <p style={{ margin: 0 }}>{description}</p>
      </div>
    </div>
  );
}

export function TreasuryBalanceCards({
  balances,
  walletBalance,
  onOpenDeposit,
  isDepositEnabled,
  onOpenWithdraw,
  isWithdrawEnabled,
  onRefreshBalance,
  isRefreshing = false,
  canViewAdmin = false,
  withdrawDisabledReason = 'Treasury address or connected Arc Mainnet wallet unavailable',
}: TreasuryBalanceCardsProps) {
  const showTreasuryWideBalances = canViewAdmin;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Treasury Overview</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {onRefreshBalance && (
            <button
              type="button"
              className="vx-btn vx-btn-outline"
              onClick={onRefreshBalance}
              disabled={isRefreshing}
              aria-label="Refresh treasury USDC balance"
              title="Query latest Native USDC balance from Arc Mainnet"
            >
              {isRefreshing ? 'Syncing…' : '↻ Refresh Balance'}
            </button>
          )}
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            onClick={onOpenDeposit}
            disabled={!isDepositEnabled}
            aria-label="Open deposit modal"
            title={isDepositEnabled ? 'Deposit into the configured Arc Mainnet Treasury' : 'Pending verified Arc Mainnet Treasury deployment/configuration'}
          >
            Deposit USDC
          </button>
          <button
            type="button"
            className="vx-btn vx-btn-secondary"
            onClick={onOpenWithdraw}
            disabled={!isWithdrawEnabled}
            aria-label="Open withdrawal modal"
            title={isWithdrawEnabled ? 'Withdraw your Treasury USDC balance' : withdrawDisabledReason}
          >
            Withdraw USDC
          </button>
        </div>
      </div>

      <div className="vx-balance-grid">
        <BalanceCard
          title="Wallet USDC Balance"
          descriptor={walletBalance}
          description={canViewAdmin
            ? 'USDC held by the connected wallet. This is separate from Treasury vault capital.'
            : 'USDC available in your connected wallet.'}
          canViewAdmin={canViewAdmin}
        />
        {showTreasuryWideBalances && (
          <>
            <BalanceCard
              title="Treasury-Held USDC"
              descriptor={balances.total}
              description="Native USDC directly held by Core; excludes deployed strategy value."
              highlight
            />
            <BalanceCard
              title="Available Treasury Liquidity"
              descriptor={balances.available}
              description="Core's reserve-aware liquid amount; unavailable unless read from the authoritative Core projection."
            />
            <BalanceCard
              title="Allocated Strategy Balance"
              descriptor={balances.allocated}
              description="Unavailable: the current projection has no authoritative aggregate allocated-balance value."
            />
          </>
        )}
      </div>
    </div>
  );
}
