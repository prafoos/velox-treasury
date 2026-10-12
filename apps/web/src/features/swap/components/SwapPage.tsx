import { useEffect, useMemo, useState } from 'react';
import { readContract } from 'viem/actions';
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from 'wagmi';
import { erc20ApproveAbi } from '../config/erc20Abi';
import { KYBERSWAP_TOKEN_ALLOWLIST, KYBERSWAP_USDC_TOKEN } from '../config/kyberSwap';
import { useKyberSwapAllowance } from '../hooks/useKyberSwapAllowance';
import { useSwapTokenBalance } from '../hooks/useSwapTokenBalance';
import { requestKyberSwapQuote, validateKyberSwapQuote, type KyberSwapQuote } from '../services/kyberSwapService';
import { withVerifiedArcMainnetPublicClient } from '../../treasury/services/arcMainnetPublicClient';
import { approveAndRefreshAllowance, executeSwapLifecycle, swapBalanceAbi, type SwapExecutionState } from '../services/swapTransactionLifecycle';
import { formatTokenAmount, parseSwapAmount, sameSwapToken, validateSwapBalance, validateSwapInput } from '../services/swapValidation';
import type { SwapQuoteStatus, SwapToken } from '../types';

export function SwapPage() {
  const [tokenIn, setTokenIn] = useState<SwapToken>(KYBERSWAP_USDC_TOKEN);
  const [tokenOut, setTokenOut] = useState<SwapToken>(KYBERSWAP_TOKEN_ALLOWLIST[1] ?? KYBERSWAP_USDC_TOKEN);
  const [amount, setAmount] = useState(''); const [slippage, setSlippage] = useState('0.50');
  const [error, setError] = useState<string | null>(null); const [quoteStatus, setQuoteStatus] = useState<SwapQuoteStatus>('IDLE');
  const [quote, setQuote] = useState<KyberSwapQuote | null>(null);
  const [executionState, setExecutionState] = useState<SwapExecutionState>({ status: 'IDLE' });
  const [activeTokenSelector, setActiveTokenSelector] = useState<'in' | 'out' | null>(null);
  const balance = useSwapTokenBalance(tokenIn); const balanceOut = useSwapTokenBalance(tokenOut); const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: 5042 });
  const { writeContractAsync, isPending: isApproving } = useWriteContract(); const { sendTransactionAsync, isPending: isExecuting } = useSendTransaction();
  const parsedAmount = useMemo(() => parseSwapAmount(amount, tokenIn.decimals), [amount, tokenIn.decimals]);
  const sameToken = sameSwapToken(tokenIn, tokenOut);
  const insufficient = parsedAmount.amount !== null && balance.rawAmount !== null && parsedAmount.amount > balance.rawAmount;
  const quoteDisabled = sameToken || parsedAmount.amount === null || insufficient || balance.rawAmount === null || !balance.isConnected || !balance.isArcMainnet || !connectedAddress;
  const allowance = useKyberSwapAllowance(tokenIn, quote?.amountIn ?? null, quote?.spender ?? null);
  useEffect(() => {
    if (executionState.status !== 'CONFIRMED') return;
    void Promise.all([balance.refetch(), balanceOut.refetch()]);
  }, [balance.refetch, balanceOut.refetch, executionState.status]);
  useEffect(() => {
    if (!activeTokenSelector) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveTokenSelector(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activeTokenSelector]);
  function invalidateQuote() { setQuoteStatus('IDLE'); setError(null); setQuote(null); setExecutionState({ status: 'IDLE' }); }
  function changeTokenIn(token: SwapToken) { setTokenIn(token); invalidateQuote(); }
  function changeTokenOut(token: SwapToken) { setTokenOut(token); invalidateQuote(); }
  function setMaxAmount() { if (balance.rawAmount !== null) { setAmount(formatTokenAmount(balance.rawAmount, tokenIn.decimals)); invalidateQuote(); } }
  async function requestQuote() {
    setQuoteStatus('VALIDATING'); setExecutionState({ status: 'IDLE' });
    try {
      if (sameToken) throw new Error('Select different tokens');
      if (parsedAmount.error || parsedAmount.amount === null) throw new Error(parsedAmount.error ?? 'Enter a valid amount.');
      if (!connectedAddress) throw new Error('Connect a wallet to get a quote.');
      const slippageBps = BigInt(Math.round(Number(slippage) * 100));
      validateSwapInput({ tokenIn, tokenOut, amountIn: parsedAmount.amount, slippageBps, chainId: 5042 }); validateSwapBalance(parsedAmount.amount, balance.rawAmount); setQuoteStatus('QUOTING');
      const nextQuote = await requestKyberSwapQuote({ tokenIn, tokenOut, amountIn: parsedAmount.amount, slippageBps, sender: connectedAddress, recipient: connectedAddress, nowSeconds: BigInt(Math.floor(Date.now() / 1000)) }); setQuote(nextQuote); setQuoteStatus('QUOTE_AVAILABLE'); setError(null);
    } catch (cause) { console.error('KyberSwap quote failed:', cause); setQuote(null); setQuoteStatus('QUOTE_UNAVAILABLE'); setError(cause instanceof Error ? cause.message : 'KyberSwap route unavailable.'); }
  }
  async function approve() {
    const assessment = allowance.assessment;
    if (!assessment) return;
    if (!publicClient) { setError('Arc Mainnet public client is unavailable; approval was not confirmed.'); return; }
    setError(null);
    try {
      await approveAndRefreshAllowance({
        submit: () => writeContractAsync({
          address: tokenIn.address,
          abi: erc20ApproveAbi,
          functionName: 'approve',
          args: [assessment.spender, assessment.approvalAmount],
          chainId: 5042,
        }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(
          publicClient,
          () => publicClient.waitForTransactionReceipt({ hash }),
        ),
        refetchAllowance: allowance.refetch,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval failed.');
    }
  }
  async function execute() {
    if (!quote || !connectedAddress) return;
    if (!publicClient) { setError('Arc Mainnet public client is unavailable; swap was not submitted.'); return; }
    setError(null);
    try {
      validateKyberSwapQuote(quote, BigInt(Math.floor(Date.now() / 1000)));
      await executeSwapLifecycle({
        amountIn: quote.amountIn,
        minimumAmountOut: quote.minimumAmountOut,
        readBalances: () => withVerifiedArcMainnetPublicClient(publicClient, async () => {
          const [source, destination] = await Promise.all([
            readContract(publicClient, {
              address: tokenIn.address,
              abi: swapBalanceAbi,
              functionName: 'balanceOf',
              args: [connectedAddress],
            }),
            readContract(publicClient, {
              address: tokenOut.address,
              abi: swapBalanceAbi,
              functionName: 'balanceOf',
              args: [connectedAddress],
            }),
          ]);
          return { source, destination };
        }),
        submit: () => sendTransactionAsync({
          to: quote.transaction.to,
          data: quote.transaction.data,
          value: quote.transaction.value,
          chainId: 5042,
        }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(
          publicClient,
          () => publicClient.waitForTransactionReceipt({ hash }),
        ),
        onStateChange: setExecutionState,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'KyberSwap execution failed.');
    }
  }
  function selectToken(token: SwapToken) {
    if (activeTokenSelector === 'in') changeTokenIn(token);
    if (activeTokenSelector === 'out') changeTokenOut(token);
    setActiveTokenSelector(null);
  }
  const selectedToken = activeTokenSelector === 'in' ? tokenIn : tokenOut;
  return <div className="vx-swap-page">
    <header className="vx-page-header vx-swap-header"><div className="vx-page-title-group"><p className="vx-eyebrow">Swap</p><h1>Swap</h1><p>Swap tokens securely on Arc Mainnet.</p></div><span className="vx-network-pill"><span className="vx-dot vx-dot-success" />Arc Mainnet · 5042</span></header>
    <div className="vx-swap-layout"><section className="vx-card vx-swap-form" aria-labelledby="swap-form-title"><div className="vx-section-heading"><div><p className="vx-eyebrow">Swap</p><h2 id="swap-form-title">Swap tokens</h2></div><span className="vx-status-chip">Powered by KyberSwap</span></div>
      <label className="vx-field">From<span className="vx-token-row"><button type="button" className="vx-token-selector" onClick={() => setActiveTokenSelector('in')} aria-haspopup="dialog" aria-expanded={activeTokenSelector === 'in'}>{tokenIn.symbol}<span aria-hidden="true">⌄</span></button><span className="vx-input-with-max"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); invalidateQuote(); }} placeholder="0.00" aria-label="Amount" /><button type="button" className="vx-max-action" onClick={setMaxAmount} disabled={balance.rawAmount === null} aria-label={`Use maximum ${tokenIn.symbol} balance`}>Max</button></span></span><small>{balance.rawAmount !== null ? `Available: ${formatTokenAmount(balance.rawAmount, tokenIn.decimals)} ${tokenIn.symbol}` : balance.isConnected && balance.isArcMainnet ? 'Balance unavailable' : 'Wallet not connected'}</small></label>
      <button type="button" className="vx-swap-direction" onClick={() => { const previousIn = tokenIn; changeTokenIn(tokenOut); changeTokenOut(previousIn); }} aria-label="Swap direction">⇅</button>
      <label className="vx-field">To<button type="button" className="vx-token-selector" onClick={() => setActiveTokenSelector('out')} aria-haspopup="dialog" aria-expanded={activeTokenSelector === 'out'}>{tokenOut.symbol}<span aria-hidden="true">⌄</span></button><small>{balanceOut.rawAmount !== null ? `Available: ${formatTokenAmount(balanceOut.rawAmount, tokenOut.decimals)} ${tokenOut.symbol}` : balanceOut.isConnected && balanceOut.isArcMainnet ? 'Balance unavailable' : 'Wallet not connected'}</small></label><label className="vx-field">Slippage tolerance<span className="vx-input-suffix"><input inputMode="decimal" value={slippage} onChange={(event) => { setSlippage(event.target.value); invalidateQuote(); }} aria-label="Slippage tolerance" /><span>%</span></span></label>
      {sameToken && <p className="vx-inline-error" role="alert">Select different tokens</p>}{insufficient && <p className="vx-inline-error" role="alert">Insufficient balance. Available: {formatTokenAmount(balance.rawAmount!, tokenIn.decimals)} {tokenIn.symbol}; required: {amount} {tokenIn.symbol}.</p>}{!sameToken && !insufficient && parsedAmount.error && amount.length > 0 && <p className="vx-inline-error" role="alert">{parsedAmount.error}</p>}<button type="button" className="vx-primary-action" onClick={requestQuote} disabled={quoteDisabled}>Get quote</button>{error && <p className="vx-inline-error" role="alert">{error}</p>}
    </section><aside className="vx-card vx-quote-panel" aria-live="polite"><div className="vx-section-heading"><div><p className="vx-eyebrow">Swap details</p><h2>{quote ? 'KyberSwap route' : 'Waiting for route'}</h2></div><span className={`vx-status-chip${quote ? '' : ' vx-status-chip-muted'}`}>{quote ? 'Route ready' : 'Unavailable'}</span></div><div className="vx-quote-empty"><span className="vx-quote-mark">↗</span><strong>{quote ? 'KyberSwap quote' : 'Quote unavailable'}</strong><p>{quote ? 'Live route prepared for your connected wallet.' : 'No route is currently available.'}</p></div><dl className="vx-quote-details"><div><dt>You receive</dt><dd>{quote ? `${formatTokenAmount(quote.amountOut, tokenOut.decimals)} ${tokenOut.symbol}` : '—'}</dd></div><div><dt>Minimum you receive</dt><dd>{quote ? `${formatTokenAmount(quote.minimumAmountOut, tokenOut.decimals)} ${tokenOut.symbol}` : '—'}</dd></div><div><dt>Powered by</dt><dd>{quote ? 'KyberSwap' : '—'}</dd></div><div><dt>Quote expires</dt><dd>{quote ? new Date(Number(quote.expiresAt) * 1000).toLocaleTimeString() : '—'}</dd></div></dl>
      {quote && allowance.assessment?.state === 'APPROVAL_REQUIRED' && <button type="button" className="vx-secondary-action" onClick={approve} disabled={isApproving}>{isApproving ? 'Approving…' : `Approve KyberSwap for ${tokenIn.symbol}`}</button>}{quote && <button type="button" className="vx-primary-action" onClick={execute} disabled={!connectedAddress || allowance.assessment?.state !== 'READY' || isExecuting}>{isExecuting ? 'Waiting for confirmation…' : 'Execute swap'}</button>}
      {executionState.hash && <p className="vx-status-chip">Transaction: {executionState.hash}</p>}
      {executionState.status === 'SUBMITTED' && <p className="vx-status-chip">Swap submitted; awaiting transaction receipt.</p>}
      {executionState.status === 'CONFIRMED' && <p className="vx-status-chip">Swap confirmed; authoritative token balances verified.</p>}
      {executionState.status === 'REVERTED' && <p className="vx-inline-error" role="alert">Swap transaction reverted.</p>}
      {executionState.status === 'READBACK_FAILED' && <p className="vx-inline-error" role="alert">Swap executed, but authoritative balance verification failed.</p>}
      {executionState.status === 'FAILED' && <p className="vx-inline-error" role="alert">Swap transaction failed before confirmation.</p>}
    </aside></div>{activeTokenSelector && <div className="vx-token-picker-backdrop" role="presentation" onMouseDown={() => setActiveTokenSelector(null)}><section className="vx-token-picker" role="dialog" aria-modal="true" aria-labelledby="token-picker-title" onMouseDown={(event) => event.stopPropagation()}><div className="vx-token-picker-heading"><h2 id="token-picker-title">Select token</h2><button type="button" className="vx-token-picker-close" onClick={() => setActiveTokenSelector(null)} aria-label="Close token selector">×</button></div><div className="vx-token-picker-list">{KYBERSWAP_TOKEN_ALLOWLIST.map((token) => <button type="button" key={token.address} className={`vx-token-picker-option${token.address === selectedToken.address ? ' vx-token-picker-option-selected' : ''}`} onClick={() => selectToken(token)}><span><strong>{token.symbol}</strong><small>{token.name ?? token.symbol}</small></span><code>{token.address}</code></button>)}</div></section></div>}
  </div>;
}
