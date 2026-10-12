import type { TreasuryTransactionModel } from '@velox/domain';
import { formatTransactionAmount } from '../services/transactionService';

interface TransactionHistoryProps {
  readonly transactions: readonly TreasuryTransactionModel[];
  readonly isLoading: boolean;
  readonly error?: Error | null;
  readonly onRetry?: () => void;
  readonly walletUnavailableMessage?: string | null;
}

export function TransactionHistory({
  transactions,
  isLoading,
  error = null,
  onRetry,
  walletUnavailableMessage = null,
}: TransactionHistoryProps) {
  if (isLoading) return <section className="vx-section"><p role="status">Loading verified Arc Mainnet transactions…</p></section>;
  return (
    <section className="vx-section" aria-labelledby="transactions-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="transactions-title">Transactions</h2>
          <p>Up to 50 receipt-verified Core deposits and withdrawals from the most recent 100,000 blocks; this is not a complete historical index.</p>
        </div>
        <span className="vx-stage-pill">Arc Mainnet</span>
      </div>
      {error ? (
        <div className="vx-step-callout warning" role="alert">
          <p>Verified recent transaction history is unavailable: {error.message}</p>
          {onRetry && <button type="button" className="vx-btn vx-btn-outline" onClick={onRetry}>Retry</button>}
        </div>
      ) : walletUnavailableMessage ? (
        <div className="vx-empty-state" role="status">{walletUnavailableMessage}</div>
      ) : transactions.length === 0 ? (
        <div className="vx-empty-state">
          <strong>No verified recent transactions.</strong>
          <span>No matching Core Deposit or Withdrawal events were found in the recent block window.</span>
        </div>
      ) : (
        <div className="vx-rules-list">
          {transactions.map((transaction) => (
            <article className="vx-rule-item" key={transaction.hash}>
              <div className="vx-rule-info">
                <div className="vx-rule-name">{transaction.type} · {formatTransactionAmount(transaction.rawAmount)}</div>
                <div className="vx-rule-desc">
                  Hash: {transaction.hash}
                  <br />
                  From: {transaction.sender}
                  <br />
                  To: {transaction.recipient}
                  {transaction.blockNumber !== undefined && <><br />Block: {transaction.blockNumber.toLocaleString('en-US')}</>}
                  {transaction.timestamp !== undefined && <><br />Time: {new Date(Number(transaction.timestamp) * 1000).toLocaleString()}</>}
                </div>
              </div>
              <div className="vx-rule-meta">
                <span className="vx-stage-pill">{transaction.status}</span>
                {transaction.explorerUrl && <a className="vx-btn vx-btn-outline" href={transaction.explorerUrl} target="_blank" rel="noreferrer">View on Arc Explorer</a>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
