import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';

import '../features/treasury/treasury.css';
import '../features/swap/swap.css';
import '../features/landing/landing.css';

import { WalletConnection } from '../components/wallet/WalletConnection';
import { AiAssistantPage } from '../features/ai';
import { LandingPage } from '../features/landing/LandingPage';
import { SwapPage } from '../features/swap/components';
import { EarnPage } from '../pages/EarnPage';
import { TreasuryPage } from '../pages/TreasuryPage';
import { TransactionsPage } from '../pages/TransactionsPage';

const primaryRoutes = [
  { path: '/treasury', label: 'Treasury' },
  { path: '/swap', label: 'Swap' },
  { path: '/earn', label: 'Earn' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/ai-assistant', label: 'AI Assistant' },
] as const;

function ApplicationShell() {
  return (
    <div className="vx-app-shell">
      <header className="vx-header">
        <div className="vx-header-inner">
          <Link className="vx-brand-group vx-brand-link" to="/" aria-label="Velox Treasury home">
            <div className="vx-logo-icon" aria-hidden="true">V</div>
            <div>
              <span className="vx-brand-title">Velox Treasury</span>
              <p className="vx-brand-subtitle">USDC management</p>
            </div>
          </Link>
          <nav className="vx-nav-tabs" aria-label="Main navigation">
            {primaryRoutes.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) => `vx-nav-tab${isActive ? ' active' : ''}`}
              >
                {route.label}
              </NavLink>
            ))}
          </nav>
          <div className="vx-header-actions"><WalletConnection /></div>
        </div>
      </header>

      <main className="vx-main-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/treasury" element={<TreasuryPage />} />
          <Route path="/swap" element={<SwapPage />} />
          <Route path="/earn" element={<EarnPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/ai-assistant" element={<AiAssistantPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="vx-footer">
        <div className="vx-footer-inner">
          <div><span>Velox Treasury</span> · Manage your USDC in one place</div>
          <div><span>Arc Mainnet</span></div>
        </div>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ApplicationShell />
    </BrowserRouter>
  );
}
