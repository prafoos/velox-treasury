import { useState } from 'react';

import { ARC_USDC_CONTRACT_ADDRESS, ARC_USDC_DECIMALS } from '../../../contracts/usdc';

interface WithdrawActionModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly canWithdraw: boolean;
  readonly isSubmitting: boolean;
  readonly status: string | null;
  readonly onWithdraw: (recipient: string, amount: string) => Promise<unknown>;
  readonly authorizationMessage?: string;
  readonly walletAddress?: string;
  readonly canViewAdmin?: boolean;
}

export function WithdrawActionModal({ isOpen, onClose, canWithdraw, isSubmitting, status, onWithdraw, authorizationMessage, walletAddress, canViewAdmin = false }: WithdrawActionModalProps) {
  const [recipient, setRecipient] = useState(walletAddress ?? '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const targetRecipient = walletAddress ?? recipient;
    try { setError(null); await onWithdraw(targetRecipient, amount); setRecipient(walletAddress ?? ''); setAmount(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Treasury withdrawal failed or was rejected.'); }
  };
  if (!isOpen) return null;
  const visibleError = error ? canViewAdmin ? error : 'Your withdrawal could not be completed. Please try again.' : null;
  const visibleStatus = status
    ? canViewAdmin
      ? status
      : status.toLowerCase().includes('confirmed')
        ? 'Withdrawal confirmed.'
        : 'Processing your withdrawal…'
    : null;

  return (
    <div
      className="vx-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
    >
      <div className="vx-modal-dialog">
        <div className="vx-modal-header">
          <h3 id="withdraw-modal-title" className="vx-modal-title">
            Withdraw USDC from Treasury
          </h3>
          <button
            type="button"
            className="vx-modal-close-btn"
            onClick={onClose}
            aria-label="Close withdraw modal"
          >
            ✕
          </button>
        </div>

        <div className="vx-modal-body">
          {authorizationMessage && <div className="vx-step-callout warning">{authorizationMessage}</div>}
          {visibleError && <div className="vx-step-callout warning">{visibleError}</div>}
          {visibleStatus && <div className="vx-step-callout info">{visibleStatus}</div>}

          <div className="vx-form-group">
            <label htmlFor="withdraw-asset" className="vx-form-label">
              {canViewAdmin ? 'Verified Asset' : 'Asset'}
            </label>
            <input
              id="withdraw-asset"
              className="vx-input"
              type="text"
              value={canViewAdmin
                ? `USDC (${ARC_USDC_CONTRACT_ADDRESS.slice(0, 10)}…${ARC_USDC_CONTRACT_ADDRESS.slice(-8)}) • ${ARC_USDC_DECIMALS} Decimals`
                : 'USDC'}
              disabled
              readOnly
            />
          </div>

          <div className="vx-form-group">
            <label htmlFor="withdraw-recipient" className="vx-form-label">
              {canViewAdmin ? 'Destination Address' : 'Your wallet'}
            </label>
            <input
              id="withdraw-recipient"
              className="vx-input"
              type="text"
              placeholder={canViewAdmin ? '0x... (Recipient on Arc Mainnet)' : 'Your connected wallet'}
              value={walletAddress ?? recipient}
              readOnly
              disabled={Boolean(walletAddress)}
              onChange={(event) => setRecipient(event.target.value)}
            />
            <span className="vx-field-hint">
              {canViewAdmin
                ? 'Self-withdrawal only: the connected wallet must be the recipient. Core enforces that recipient matches the caller.'
                : 'Withdrawals can only be sent to your connected wallet.'}
            </span>
          </div>

          <div className="vx-form-group">
            <label htmlFor="withdraw-amount" className="vx-form-label">
              {canViewAdmin ? 'Withdrawal Amount (USDC)' : 'Amount (USDC)'}
            </label>
            <input
              id="withdraw-amount"
              className="vx-input"
              type="text"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span className="vx-field-hint">
              {canViewAdmin
                ? 'Available USDC is withdrawn directly. If more liquidity is needed, the app uses your authoritative pro-rata Core strategy share position to build a bounded unwind plan. Core rechecks your position, valuation, liquidity, reserves, withdrawal limits, and strategy approval on submission.'
                : 'Available USDC is withdrawn first. If more is needed, Velox checks your balance and availability before continuing.'}
            </span>
          </div>
        </div>

        <div className="vx-modal-footer">
          <button type="button" className="vx-btn vx-btn-outline" onClick={onClose}>
            Close
          </button>
          <button type="button" className="vx-btn vx-btn-primary" onClick={submit} disabled={!canWithdraw || isSubmitting}>
            {isSubmitting ? 'Confirming…' : 'Withdraw USDC'}
          </button>
        </div>
      </div>
    </div>
  );
}
