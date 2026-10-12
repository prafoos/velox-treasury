import type { TreasuryStatusBannerInfo } from '../types';

interface TreasuryStatusBannerProps {
  readonly status: TreasuryStatusBannerInfo;
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly canViewAdmin?: boolean;
}

export function TreasuryStatusBanner({
  status,
  isConnected,
  isArcMainnet,
  canViewAdmin = false,
}: TreasuryStatusBannerProps) {
  const userStatus = !canViewAdmin
    ? !isConnected
      ? { title: 'Connect your wallet', message: 'Connect your wallet to view your Treasury.' }
      : !isArcMainnet
        ? { title: 'Switch network', message: 'Switch to Arc Mainnet in your wallet to continue.' }
        : status.type === 'warning'
          ? { title: 'Treasury unavailable', message: 'Your Treasury information is temporarily unavailable.' }
          : status.type === 'notice'
            ? { title: 'Treasury updated', message: 'Your Treasury balance is up to date.' }
            : { title: 'Your Treasury', message: 'Your Treasury information will appear here when available.' }
    : null;

  return (
    <div
      className={`vx-status-banner ${status.type}`}
      role={status.type === 'warning' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div>
        <h4>{userStatus?.title ?? status.title}</h4>
        <p>{userStatus?.message ?? status.message}</p>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="vx-stage-pill">
            Network Requirement: Arc Mainnet (5042)
          </span>
          {!isConnected && (
            <span className="vx-stage-pill" style={{ color: '#f59e0b' }}>
              Action: Connect Wallet
            </span>
          )}
          {isConnected && !isArcMainnet && (
            <span className="vx-stage-pill" style={{ color: '#f43f5e' }}>
              Action: Switch to Arc Mainnet
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
