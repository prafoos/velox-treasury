import type { TokenBalanceDescriptor } from '../types';

interface USDCBalanceDisplayProps {
  readonly descriptor: TokenBalanceDescriptor;
  readonly onRefresh?: () => void;
  readonly isRefreshing?: boolean;
  readonly showContractNotice?: boolean;
}

export function USDCBalanceDisplay({
  descriptor,
  onRefresh,
  isRefreshing,
  showContractNotice = false,
}: USDCBalanceDisplayProps) {
  const isSynced = descriptor.state === 'synced' && descriptor.formattedAmount !== null;
  const isLoading = descriptor.state === 'loading' || isRefreshing;
  const isError = descriptor.state === 'error';

  let badgeClass = 'vx-balance-badge';
  if (isLoading) badgeClass += ' loading';
  else if (isError) badgeClass += ' error';
  else if (descriptor.state === 'wrong_network' || descriptor.state === 'disconnected') {
    badgeClass += ' warning';
  }

  return (
    <div className="vx-usdc-balance-display">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        {isSynced ? (
          <div className="vx-balance-amount">
            {descriptor.formattedAmount}{' '}
            <span style={{ fontSize: '1.1rem', color: 'var(--vx-text-secondary)' }}>
              {descriptor.symbol}
            </span>
          </div>
        ) : (
          <div className={badgeClass} role={isError ? 'alert' : 'status'}>
            {isLoading && <span className="vx-spinner" aria-hidden="true" />}
            {descriptor.message}
          </div>
        )}

        {onRefresh && isSynced && (
          <button
            type="button"
            className="vx-btn vx-btn-outline"
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', height: 'fit-content' }}
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh USDC balance"
          >
            {isLoading ? 'Syncing…' : '↻ Refresh'}
          </button>
        )}
      </div>

      {showContractNotice && (
        <div style={{ fontSize: '0.75rem', color: 'var(--vx-text-muted)', marginTop: '0.35rem' }}>
          Arc Native USDC (0x3600…0000) • 6 Decimals
        </div>
      )}
    </div>
  );
}
