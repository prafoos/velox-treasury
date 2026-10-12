import { useState } from 'react';
import { isAddress } from 'viem';
import { ARC_USDC_CONTRACT_ADDRESS, ARC_USDC_DECIMALS } from '../../../contracts/usdc';
import { parseUSDC } from '../../usdc/services/usdcService';
import { STEAKHOUSE_CORE_ADDRESS } from '../services/protocolVaultMapping';

interface DepositActionModalProps { readonly isOpen: boolean; readonly onClose: () => void; readonly treasuryAddress: string | null; readonly canDeposit: boolean; readonly isSubmitting: boolean; readonly status: string | null; readonly onDeposit: (amount: bigint) => Promise<void>; readonly canViewAdmin?: boolean; }

function shouldShowDepositDetails(canViewAdmin: boolean, message: string): boolean {
  const normalized = message.toLowerCase();
  return canViewAdmin
    || normalized.includes('allowance')
    || message.includes('No approval was requested.')
    || normalized.includes('wallet account changed')
    || normalized.includes('wallet network could not be verified')
    || normalized.includes('account or network could not be verified')
    || normalized.includes('wallet changed away from arc mainnet');
}

export function DepositActionModal({ isOpen, onClose, treasuryAddress, canDeposit, isSubmitting, status, onDeposit, canViewAdmin = false }: DepositActionModalProps) {
  const [amount, setAmount] = useState(''); const [error, setError] = useState<string | null>(null);
  if (!isOpen) return null;
  const destinationVerified = Boolean(
    canDeposit
      && treasuryAddress
      && isAddress(treasuryAddress)
      && treasuryAddress.toLowerCase() === STEAKHOUSE_CORE_ADDRESS.toLowerCase(),
  );
  const submit = async () => { try { setError(null); const parsed = parseUSDC(amount); if (parsed <= 0n) throw new Error('Enter a USDC amount greater than zero.'); await onDeposit(parsed); setAmount(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Deposit failed or was rejected.'); } };
  const visibleError = error
    ? shouldShowDepositDetails(canViewAdmin, error)
      ? error
      : 'Your deposit could not be completed. Please try again.'
    : null;
  const visibleStatus = status
    ? shouldShowDepositDetails(canViewAdmin, status)
      ? status
      : status.startsWith('Deposit confirmed.')
        ? status
        : status.toLowerCase().includes('confirmed')
          ? 'Deposit confirmed.'
        : 'Processing your deposit…'
    : null;
  return <div className="vx-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="deposit-modal-title"><div className="vx-modal-dialog"><div className="vx-modal-header"><h3 id="deposit-modal-title" className="vx-modal-title">Deposit USDC into Treasury</h3><button type="button" className="vx-modal-close-btn" onClick={onClose} aria-label="Close deposit modal">×</button></div><div className="vx-modal-body"><div className="vx-step-callout warning">{canViewAdmin ? destinationVerified ? 'After read-only Arc Mainnet/Core/USDC preflight, deposits use an exact-amount USDC approval followed by VeloxTreasuryCore.deposit(amount). A confirmed deposit triggers a valuation refresh and automatic allocation of only surplus permitted by the active Core reserves and policy caps.' : 'Deposits are strictly disabled because no verified Treasury smart contract is configured on Arc Mainnet. Never send funds or approve allowances to unverified contracts.' : destinationVerified ? 'Your USDC deposit is credited to the Treasury Core position. After confirmation, the existing automation checks valuation, reserves, and on-chain policy caps before allocating any eligible surplus to the approved Steakhouse strategy. Bucket percentages are accounting targets, not separate transfers.' : 'Deposits are not available yet.'}</div><div className="vx-form-group"><label htmlFor="deposit-asset" className="vx-form-label">{canViewAdmin ? 'Verified Asset' : 'Asset'}</label><input id="deposit-asset" className="vx-input" type="text" value={canViewAdmin ? `USDC (${ARC_USDC_CONTRACT_ADDRESS.slice(0, 10)}…${ARC_USDC_CONTRACT_ADDRESS.slice(-8)}) • ${ARC_USDC_DECIMALS} Decimals` : 'USDC'} disabled readOnly /></div><div className="vx-form-group"><label htmlFor="deposit-destination" className="vx-form-label">{canViewAdmin ? 'Target Treasury Core' : 'Treasury Core destination'}</label><input id="deposit-destination" className="vx-input" type="text" value={destinationVerified ? treasuryAddress ?? 'Not available — verified Core required' : 'Not available — verified Core required'} disabled readOnly /></div><div className="vx-form-group"><label htmlFor="deposit-amount" className="vx-form-label">Deposit Amount (USDC)</label><input id="deposit-amount" className="vx-input" type="text" inputMode="decimal" placeholder="0.00" disabled={!destinationVerified || isSubmitting} value={amount} onChange={(event) => setAmount(event.target.value)} /><span className="vx-field-hint">{canViewAdmin ? destinationVerified ? 'Approves only the exact entered USDC amount after identity preflight.' : 'Input disabled — a verified Mainnet Core address and Arc Mainnet wallet are required.' : destinationVerified ? 'Enter the amount you would like to deposit.' : 'Deposits are not available yet.'}</span></div>{(visibleError || visibleStatus) && <div className="vx-step-callout warning">{visibleError ?? visibleStatus}</div>}</div><div className="vx-modal-footer"><button type="button" className="vx-btn vx-btn-outline" onClick={onClose}>Close</button><button type="button" className="vx-btn vx-btn-primary" disabled={!destinationVerified || isSubmitting || !amount.trim()} onClick={submit} title={canViewAdmin ? destinationVerified ? 'Approve exact USDC amount and deposit into the verified Treasury Core' : 'Disabled — No verified Treasury contract configured' : destinationVerified ? 'Deposit USDC into your Treasury' : 'Deposits are not available yet'}>{isSubmitting ? 'Confirming…' : canViewAdmin ? destinationVerified ? 'Approve & Deposit' : 'Deposits Disabled (No Contract)' : destinationVerified ? 'Deposit USDC' : 'Deposits unavailable'}</button></div></div></div>;
}
