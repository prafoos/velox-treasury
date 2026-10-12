import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserFinancialProjectionModel } from '../../../types/userFinancialProjection';
import { AdminAiPanel, AiAssistantPage, hasCurrentWalletApiSession, isAdminAiResponse, isAuthorizedAdminProjection, isUserAiResponse, requestAiAnalysis, resolveAiMode, responseError, UserAiPanel } from './AiAssistantPage';

const walletStatusMock = vi.fn();
const userProjectionMock = vi.fn();
const adminProjectionQueryMock = vi.fn();
const walletApiSessionMock = vi.fn();
const walletApiAuthProgressMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => adminProjectionQueryMock(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../../../hooks/useWalletStatus', () => ({
  useWalletStatus: () => walletStatusMock(),
}));

vi.mock('../../../hooks/useWalletApiAuth', () => ({
  useWalletApiSession: (...args: unknown[]) => walletApiSessionMock(...args),
  useWalletApiAuthProgress: (...args: unknown[]) => walletApiAuthProgressMock(...args),
  hasWalletApiSession: (session: { authenticatedWalletAddress?: string } | null | undefined, address: string | undefined) => Boolean(
    session?.authenticatedWalletAddress
      && address
      && session.authenticatedWalletAddress.toLowerCase() === address.toLowerCase(),
  ),
  walletApiSessionQueryKey: (address: string | undefined) => ['wallet-api-session', address],
  authenticateWalletApi: vi.fn(),
}));

vi.mock('../../treasury/hooks/useTreasuryUserProjection', () => ({
  useTreasuryUserProjection: () => userProjectionMock(),
}));

const walletAddress = '0x1234567890123456789012345678901234567890';
const userProjection: UserFinancialProjectionModel = {
  scope: 'USER',
  authenticatedWalletAddress: walletAddress,
  chainId: 5042,
  walletUSDC: 100_000n,
  userBalance: 10_000n,
  treasuryFinancialState: {
    principal: 90_000n,
    currentValue: 95_000n,
    unrealizedPnl: 5_000n,
    realizedPnl: 0n,
    totalPnl: 5_000n,
  },
  publicOperationalStatus: { paused: false, blockNumber: 42012n },
  immediateWithdrawalLiquidity: {
    source: 'CORE',
    availability: 'AVAILABLE',
    status: 'CONSTRAINED',
    unit: 'USDC_BASE_UNITS',
    value: 4_000n,
  },
  fieldMetadata: {
    walletUSDC: { source: 'TOKEN_CONTRACT', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    userBalance: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    treasuryFinancialState: { source: 'CORE', availability: 'AVAILABLE', unit: 'NONE', zeroMeaning: 'NOT_APPLICABLE' },
    principal: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    currentValue: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    unrealizedPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    realizedPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    totalPnl: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    immediateWithdrawalLiquidity: { source: 'CORE', availability: 'AVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'AUTHORITATIVE_ZERO' },
    paused: { source: 'CORE', availability: 'AVAILABLE', unit: 'BOOLEAN', zeroMeaning: 'NOT_APPLICABLE' },
    blockNumber: { source: 'CORE', availability: 'AVAILABLE', unit: 'BLOCK', zeroMeaning: 'AUTHORITATIVE_ZERO' },
  },
};

const emptySubmit = async (): Promise<void> => undefined;

function renderUserPanel(overrides: Partial<Parameters<typeof UserAiPanel>[0]> = {}): string {
  return renderToStaticMarkup(<UserAiPanel
    isConnected
    isArcMainnet
    isAuthenticated
    authenticationLoading={false}
    authenticationError={null}
    authenticationStatus="idle"
    userProjection={userProjection}
    isLoading={false}
    error={null}
    prompt=""
    turns={[]}
    requestError={null}
    submitting={false}
    onPromptChange={() => undefined}
    onSubmit={emptySubmit}
    {...overrides}
  />);
}

function renderAdminPanel(overrides: Partial<Parameters<typeof AdminAiPanel>[0]> = {}): string {
  return renderToStaticMarkup(<AdminAiPanel
    isConnected
    isArcMainnet
    isPolicyAdmin
    projection={null}
    projectionLoading={false}
    projectionError={null}
    prompt=""
    turns={[]}
    requestError={null}
    submitting={false}
    onPromptChange={() => undefined}
    onSubmit={emptySubmit}
    {...overrides}
  />);
}

describe('AI assistant UI boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletStatusMock.mockReturnValue({ address: walletAddress, isConnected: true, isArcMainnet: true });
    userProjectionMock.mockReturnValue({ projection: userProjection, isLoading: false, error: null, refetch: vi.fn() });
    walletApiSessionMock.mockReturnValue({ data: { authenticatedWalletAddress: walletAddress, expiresAt: new Date(Date.now() + 60_000).toISOString() }, isLoading: false, error: null });
    walletApiAuthProgressMock.mockReturnValue({ data: { status: 'idle' }, isLoading: false });
    adminProjectionQueryMock.mockReturnValue({ data: null, isLoading: false, error: null });
  });

  it('does not render the User projection dashboard or raw metadata in AI Assistant', () => {
    const projectionWithUnexpectedFields = {
      ...userProjection,
      treasuryWideBalance: 'MUST_NOT_RENDER',
      riskPolicy: 'MUST_NOT_RENDER',
      otherUsers: ['MUST_NOT_RENDER'],
    } as UserFinancialProjectionModel;
    const markup = renderUserPanel({ userProjection: projectionWithUnexpectedFields });

    expect(markup).toContain('AI Assistant');
    expect(markup).toContain('Hi! I’m your Velox AI Assistant. Ask me about your Treasury or Earn account.');
    expect(markup).not.toContain('MUST_NOT_RENDER');
    expect(markup).not.toContain('Wallet USDC');
    expect(markup).not.toContain('Your Treasury balance');
    expect(markup).not.toContain('Your principal');
    expect(markup).not.toContain('Your unrealized P/L');
    expect(markup).not.toContain('Core-reported withdrawal value');
    expect(markup).not.toContain('permitted User projection');
    expect(markup).not.toContain('Core block');
    expect(markup).not.toContain('TOKEN_CONTRACT');
    expect(markup).not.toContain('CORE ·');
    expect(markup).not.toContain('riskPolicy');
    expect(markup.match(/class="vx-ai-panel"/g)).toHaveLength(1);
  });

  it('requires an authorized policy admin before exposing the Admin AI panel', () => {
    const markup = renderAdminPanel({ isPolicyAdmin: false, projection: { scope: 'ADMIN', treasury: { secret: 'MUST_NOT_RENDER' } } });

    expect(markup).toContain('Admin authorization is required');
    expect(markup).not.toContain('MUST_NOT_RENDER');
  });

  it('gates User AI for disconnected wallets and wrong networks', () => {
    const disconnected = renderUserPanel({ isConnected: false });
    const wrongNetwork = renderUserPanel({ isArcMainnet: false });

    expect(disconnected).toContain('Connect wallet to use AI Assistant');
    expect(wrongNetwork).toContain('Switch to Arc Mainnet');
    expect(disconnected.match(/class="vx-ai-panel"/g)).toHaveLength(1);
    expect(wrongNetwork.match(/class="vx-ai-panel"/g)).toHaveLength(1);
  });

  it('shows only User AI to a normal wallet', () => {
    const markup = renderToStaticMarkup(<AiAssistantPage />);

    expect(markup).toContain('AI Assistant');
    expect(markup).not.toContain('Admin AI');
    expect(markup).toContain('aria-label="AI Assistant chat"');
  });

  it('selects Admin AI automatically only for the authenticated wallet in the server Admin projection', () => {
    const adminProjection = {
      scope: 'ADMIN',
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
    };
    adminProjectionQueryMock.mockReturnValue({ data: adminProjection, isLoading: false, error: null });

    const markup = renderToStaticMarkup(<AiAssistantPage />);

    expect(isAuthorizedAdminProjection(adminProjection, walletAddress)).toBe(true);
    expect(markup).toMatch(/aria-selected="true">Admin AI<\/button>/);
    expect(markup).toContain('aria-label="Admin AI advisory"');
    expect(markup).not.toContain('aria-label="AI Assistant chat"');
  });

  it('keeps User AI selected when Admin authorization is unavailable or the session is unauthenticated', () => {
    adminProjectionQueryMock.mockReturnValue({ data: null, isLoading: true, error: null });
    let markup = renderToStaticMarkup(<AiAssistantPage />);
    expect(markup).toContain('aria-label="AI Assistant chat"');
    expect(markup).not.toContain('Admin AI advisory');

    adminProjectionQueryMock.mockReturnValue({
      data: {
        scope: 'ADMIN',
        authenticatedWalletAddress: walletAddress,
        chainId: 5042,
        authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
      },
      isLoading: false,
      error: null,
    });
    walletApiSessionMock.mockReturnValue({ data: null, isLoading: false, error: null });
    markup = renderToStaticMarkup(<AiAssistantPage />);
    expect(markup).toContain('aria-label="AI Assistant chat"');
    expect(markup).not.toContain('Admin AI advisory');
  });

  it('does not let an expired session and cached Admin projection expose Admin AI', () => {
    const now = Date.now();
    const expiredSession = {
      authenticatedWalletAddress: walletAddress,
      expiresAt: new Date(now - 1).toISOString(),
    };
    const cachedAdminProjection = {
      scope: 'ADMIN',
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
    };
    walletApiSessionMock.mockReturnValue({ data: expiredSession, isLoading: false, error: null });
    adminProjectionQueryMock.mockReturnValue({ data: cachedAdminProjection, isLoading: false, error: null });

    const markup = renderToStaticMarkup(<AiAssistantPage />);

    expect(hasCurrentWalletApiSession(expiredSession, walletAddress, now)).toBe(false);
    expect(markup).toContain('aria-label="AI Assistant chat"');
    expect(markup).not.toContain('Admin AI');
  });

  it('recalculates the default mode for wallet changes and disconnects without stale Admin state', () => {
    const adminProjection = {
      scope: 'ADMIN',
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
    };
    const nextUserWallet = '0x9876543210987654321098765432109876543210';

    expect(resolveAiMode(walletAddress, adminProjection, null)).toBe('admin');
    expect(resolveAiMode(nextUserWallet, adminProjection, null)).toBe('user');
    expect(resolveAiMode(undefined, adminProjection, walletAddress)).toBe('user');
    expect(resolveAiMode(walletAddress, null, null)).toBe('user');
    expect(Array.from({ length: 10 }, () => resolveAiMode(walletAddress, adminProjection, null)))
      .toEqual(Array(10).fill('admin'));
  });

  it('shows the automatic wallet-signature state without a manual auth control', () => {
    walletApiSessionMock.mockReturnValue({ data: null, isLoading: false, error: null });
    userProjectionMock.mockReturnValue({ projection: null, isLoading: false, error: null, refetch: vi.fn() });
    walletApiAuthProgressMock.mockReturnValue({ data: { status: 'pending' }, isLoading: false });

    const markup = renderToStaticMarkup(<AiAssistantPage />);

    expect(markup.match(/class="vx-ai-panel"/g)).toHaveLength(1);
    expect(markup).toContain('Authentication required. AI Assistant will be available after wallet sign-in.');
    expect(markup).toContain('Approve the one-time sign-in message in your wallet to continue.');
    expect(markup).not.toContain('Authenticate API');
    expect(markup).not.toContain('Waiting for wallet');
    expect(markup).not.toContain('Wallet USDC');
    expect(markup).toContain('id="user-ai-prompt"');
    expect(markup).toContain('disabled="">Send</button>');
  });

  it('explains a rejected automatic wallet signature without offering a manual auth button', () => {
    walletApiSessionMock.mockReturnValue({ data: null, isLoading: false, error: null });
    userProjectionMock.mockReturnValue({ projection: null, isLoading: false, error: null, refetch: vi.fn() });
    walletApiAuthProgressMock.mockReturnValue({ data: { status: 'rejected' }, isLoading: false });

    const markup = renderToStaticMarkup(<AiAssistantPage />);

    expect(markup).toContain('Authentication was not completed. Please approve the wallet message to continue.');
    expect(markup).not.toContain('Authenticate API');
  });

  it('enables the Admin AI tab only after the authenticated admin projection verifies policy role', () => {
    adminProjectionQueryMock.mockReturnValue({
      data: {
        scope: 'ADMIN',
        authenticatedWalletAddress: walletAddress,
        chainId: 5042,
        authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
      },
      isLoading: false,
      error: null,
    });

    const markup = renderToStaticMarkup(<AiAssistantPage />);

    const adminTab = markup.match(/<button[^>]*>Admin AI<\/button>/)?.[0];
    expect(adminTab).toBeDefined();
    expect(adminTab).not.toContain('disabled');
    expect(adminTab).toContain('aria-selected="true"');
  });

  it('renders projection and AI request loading states', () => {
    const projectionLoading = renderUserPanel({ isLoading: true, userProjection: null });
    const aiLoading = renderUserPanel({ submitting: true, turns: [{ id: 1, walletAddress, prompt: 'Explain my current P/L' }] });
    const adminLoading = renderAdminPanel({ projectionLoading: true });

    expect(projectionLoading).toContain('Loading your authenticated User projection');
    expect(aiLoading).toContain('AI is analyzing your request');
    expect(aiLoading).toContain('disabled=""');
    expect(adminLoading).toContain('Loading the server-authorized Admin projection');
  });

  it('renders question and answer inside the conversation window above the bottom textarea', () => {
    const markup = renderUserPanel({
      turns: [{ id: 1, walletAddress, prompt: 'Explain my balance.', answer: 'Your authenticated balance is available.' }],
    });

    const questionIndex = markup.indexOf('Explain my balance.');
    const answerIndex = markup.indexOf('Your authenticated balance is available.');
    const composerIndex = markup.indexOf('id="user-ai-prompt"');
    expect(markup).toContain('class="vx-ai-panel"');
    expect(markup.match(/class="vx-ai-panel"/g)).toHaveLength(1);
    expect(markup).not.toContain('vx-ai-response');
    expect(markup).toContain('<textarea');
    expect(markup).toContain('rows="5"');
    expect(questionIndex).toBeGreaterThan(-1);
    expect(questionIndex).toBeLessThan(answerIndex);
    expect(answerIndex).toBeLessThan(composerIndex);
    expect(markup).toContain('You');
    expect(markup).toContain('User AI');
  });

  it('keeps multiple User AI turns in the same conversation window', () => {
    const markup = renderUserPanel({ turns: [
      { id: 1, walletAddress, prompt: 'Explain my current P/L.', answer: 'Your P/L is available in your projection.' },
      { id: 2, walletAddress, prompt: 'Explain my available withdrawal.', answer: 'Immediate withdrawal liquidity is unavailable.' },
    ] });

    expect(markup.match(/data-testid="user-ai-turn"/g)).toHaveLength(2);
    expect(markup.indexOf('Explain my available withdrawal.')).toBeLessThan(markup.indexOf('id="user-ai-prompt"'));
    expect(markup).toContain('Immediate withdrawal liquidity is unavailable.');
  });

  it('keeps projection errors and the composer inside the same User AI window', () => {
    const markup = renderUserPanel({
      error: new Error('Wallet authentication is temporarily unavailable.'),
      userProjection: null,
    });
    const windowStart = markup.indexOf('class="vx-ai-panel"');
    const errorIndex = markup.indexOf('Your User AI data could not be loaded.');
    const composerIndex = markup.indexOf('class="vx-ai-form-block vx-ai-composer"');

    expect(markup.match(/class="vx-ai-panel"/g)).toHaveLength(1);
    expect(errorIndex).toBeGreaterThan(windowStart);
    expect(composerIndex).toBeGreaterThan(errorIndex);
  });

  it('gives the composer a full-width, multiline, minimum 150px typing area', () => {
    const markup = renderUserPanel();
    const css = readFileSync(new URL('../../treasury/treasury.css', import.meta.url), 'utf8');
    const textareaRules = css.match(/\.vx-ai-textarea\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(markup).toContain('<textarea');
    expect(markup).toContain('rows="5"');
    expect(textareaRules).toContain('width: 100%');
    expect(textareaRules).toContain('min-height: 156px');
    expect(textareaRules).toContain('resize: vertical');
  });

  it('keeps Admin projection cards, chat, and composer in separate responsive layout regions', () => {
    const css = readFileSync(new URL('../../treasury/treasury.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('./AiAssistantPage.tsx', import.meta.url), 'utf8');
    const adminPanelRules = css.match(/\.vx-ai-admin-panel\s*\{[^}]*\}/)?.[0] ?? '';
    const adminGridRules = css.match(/\.vx-ai-admin-panel \.vx-ai-summary-grid\s*\{[^}]*\}/)?.[0] ?? '';
    const adminChatRules = css.match(/\.vx-ai-admin-panel \.vx-ai-conversation\s*\{[^}]*\}/)?.[0] ?? '';

    expect(source).toContain('className="vx-ai-panel vx-ai-admin-panel"');
    expect(source).toContain('<AdminProjectionSummary projection={projection} />');
    expect(source).toContain('aria-label="Admin AI conversation"');
    expect(source).toContain('className="vx-ai-form-block vx-ai-composer"');
    expect(source).toContain('function AdminProjectionSummary');
    expect(adminPanelRules).toContain('max-height: none');
    expect(adminPanelRules).toContain('overflow: visible');
    expect(css).toContain('.vx-ai-admin-panel .vx-ai-projection-details');
    expect(adminGridRules).toContain('grid-template-columns: repeat(auto-fit');
    expect(adminChatRules).toContain('border-top: 1px solid');
    expect(adminChatRules).toContain('max-height: 50vh');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.vx-ai-admin-panel .vx-ai-summary-grid');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('shows Admin projection provenance and preserves unavailable strategy/exposure fields', () => {
    const unavailable = { source: 'API_DERIVED', availability: 'UNAVAILABLE', unit: 'USDC_BASE_UNITS', zeroMeaning: 'UNAVAILABLE', value: null };
    const projection = {
      scope: 'ADMIN',
      treasury: {
        totalUserLiabilities: { source: 'CORE', availability: 'AVAILABLE', value: '1000' },
        blockNumber: { source: 'CORE', availability: 'AVAILABLE', value: '42' },
      },
      approvals: { approvedProtocolCount: { source: 'CORE', availability: 'AVAILABLE', value: '0' } },
      riskPolicy: { minimumLiquidReserve: { source: 'CORE', availability: 'UNAVAILABLE', value: null } },
      bucketPolicy: { liquidOperationalReserveBps: { source: 'CORE', availability: 'AVAILABLE', value: '1500' } },
      strategy: { currentValue: unavailable },
      exposure: {
        source: 'CORE',
        availability: 'PARTIAL',
        reason: 'Complete registry unavailable.',
        data: { configuredStrategyRemainingAbsoluteCapacity: unavailable, relativeExposure: unavailable },
      },
      operationalStatus: { source: 'CORE', availability: 'AVAILABLE', data: { paused: { source: 'CORE', availability: 'AVAILABLE', value: false } } },
    };
    const markup = renderAdminPanel({ projection });

    expect(markup).toContain('Approved protocol count');
    expect(markup).toContain('Approvals and bucket policy');
    expect(markup).toContain('Configured strategy and exposure');
    expect(markup).toContain('API_DERIVED · UNAVAILABLE');
    expect(markup).toContain('Complete registry unavailable.');
    expect(markup).toContain('Complete strategy registry');
    expect(markup).toContain('Pending timelock operations');
    expect(markup).toContain('Historical yield and Treasury flows');
    expect(markup).not.toContain('Remaining absolute capacity (base units)</span><strong>0</strong>');
  });

  it('renders actual projection authentication/configuration errors inside the User window', () => {
    const userError = renderUserPanel({ error: new Error('projection failed'), userProjection: null });
    const unavailableAuth = renderUserPanel({ error: new Error('Wallet authentication is temporarily unavailable.'), userProjection: null });
    const requiredAuth = renderUserPanel({ error: new Error('Authentication required.'), userProjection: null });

    expect(userError).toContain('Your AI Assistant data could not be loaded. projection failed');
    expect(unavailableAuth).toContain('Wallet authentication is temporarily unavailable');
    expect(unavailableAuth).not.toContain('session is missing or expired');
    expect(requiredAuth).toContain('Authentication required');
    expect(userError).not.toContain('Your personal AI explanation');
  });

  it('keeps null financial values out of the chat UI instead of inventing display values', () => {
    const projectionWithUnavailableBalance = {
      ...userProjection,
      walletUSDC: 'DATA_UNAVAILABLE' as unknown as bigint,
      treasuryFinancialState: { ...userProjection.treasuryFinancialState!, currentValue: null },
    };
    const markup = renderUserPanel({ userProjection: projectionWithUnavailableBalance });

    expect(markup).toContain('AI Assistant');
    expect(markup).not.toContain('DATA_UNAVAILABLE');
    expect(markup).not.toContain('Current Value');
    expect(markup).not.toContain('>0</strong>');
  });

  it('renders AI API failures as visible errors', () => {
    const markup = renderUserPanel({ turns: [{
      id: 1,
      walletAddress,
      prompt: 'Explain my P/L',
      error: responseError(500, 'AI service failure'),
    }] });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('AI response unavailable.');
    expect(markup).not.toContain('recommendation was accepted');
    expect(markup).not.toContain('No recommendation was accepted');
    expect(markup).toContain('The server could not complete the request.');
    expect(markup.match(/class="vx-ai-panel"/g)).toHaveLength(1);
  });

  it('labels recommendations advisory-only and renders supported status/freshness fields', () => {
    const recommendation = {
        recommendationId: 'rec-42',
        createdAt: '2026-10-01T10:00:00.000Z',
        actor: 'AI',
        actionType: 'REBALANCE',
        target: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        requestedAmount: '250000',
        rationale: ['Maintain reserve above the configured minimum.'],
        evidenceReferences: ['treasury-state', 'risk-policy'],
        expectedEffect: 'Reduce concentration risk.',
        riskClassification: 'MEDIUM',
        requiredApproval: 'ADMIN',
        policyValidationStatus: 'NOT_VALIDATED',
        executionStatus: 'NOT_EXECUTABLE',
    };
    const markup = renderAdminPanel({ turns: [{ id: 1, walletAddress, prompt: 'Analyze current Treasury state', recommendation }] });

    expect(markup).toContain('AI recommendation only');
    expect(markup).toContain('Not approved · Not executable · No transaction completed');
    expect(markup).toContain('Admin decision:</strong> NOT_RECORDED');
    expect(markup).toContain('Blockchain execution:</strong> NOT_STARTED');
    expect(markup).toContain('Maintain reserve above the configured minimum.');
    expect(markup).toContain('NOT_VALIDATED');
    expect(markup).toContain('NOT_EXECUTABLE');
    expect(markup).not.toContain('confidence');
    expect(markup.indexOf('Analyze current Treasury state')).toBeLessThan(markup.indexOf('id="admin-ai-prompt"'));
    expect(markup.match(/class="vx-ai-panel vx-ai-admin-panel"/g)).toHaveLength(1);
    expect(markup).not.toContain('vx-ai-response');
    expect(markup).not.toContain('Execute</button>');
    expect(markup).not.toContain('Approve</button>');
    expect(markup).not.toMatch(/transaction hash|tx hash|sign button|broadcast button/i);
  });

  it('adds no wallet signing, transaction sending, or broadcast code to the AI UI module', () => {
    const source = readFileSync(new URL('./AiAssistantPage.tsx', import.meta.url), 'utf8');

    expect(source).not.toMatch(/writeContract|sendTransaction|eth_sendTransaction|wallet_sendCalls/i);
  });

  it('rejects mismatched or malformed AI response envelopes and categorizes provider failures safely', () => {
    expect(isUserAiResponse({ scope: 'USER', authenticatedWalletAddress: walletAddress, answer: 'Analysis.' }, walletAddress)).toBe(true);
    expect(isUserAiResponse({ scope: 'ADMIN', authenticatedWalletAddress: walletAddress, answer: 'Analysis.' }, walletAddress)).toBe(false);
    expect(isUserAiResponse({ scope: 'USER', authenticatedWalletAddress: '0x0000000000000000000000000000000000000000', answer: 'Analysis.' }, walletAddress)).toBe(false);
    expect(isAdminAiResponse({ scope: 'ADMIN', authenticatedWalletAddress: walletAddress, recommendation: { actor: 'AI', executionStatus: 'APPROVED' } }, walletAddress)).toBe(false);
    expect(responseError(503, 'Wallet authentication is temporarily unavailable.')).toContain('Wallet authentication is temporarily unavailable');
    expect(responseError(503, 'Internal provider diagnostic')).toContain('AI response unavailable');
    expect(responseError(503, 'Internal provider diagnostic')).toContain('provider is unavailable');
    expect(responseError(500, 'Database failure')).toBe('AI response unavailable. The server could not complete the request.');
    expect(responseError(401, 'Authentication required.')).toContain('Authentication required');
    expect(responseError(504, 'Gateway timeout')).toContain('timed out');
  });

  it('submits User and Admin prompts only to their existing routes', async () => {
    const userResponse = {
      scope: 'USER',
      authenticatedWalletAddress: walletAddress,
      answer: 'Your current value is available in the authenticated projection.',
    };
    const userFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => userResponse }) as Response);
    await requestAiAnalysis('user', 'Explain my current value', walletAddress, userFetch as typeof fetch);

    expect(userFetch).toHaveBeenCalledWith('/api/ai/user', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prompt: 'Explain my current value' }),
    }));
    expect(JSON.parse(userFetch.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty('account');

    const adminResponse = {
      scope: 'ADMIN',
      authenticatedWalletAddress: walletAddress,
      recommendation: {
        recommendationId: 'rec-1',
        createdAt: '2026-10-01T10:00:00.000Z',
        actor: 'AI',
        actionType: 'REBALANCE',
        target: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        requestedAmount: null,
        rationale: [],
        evidenceReferences: [],
        expectedEffect: 'Advisory only.',
        riskClassification: 'LOW',
        requiredApproval: 'ADMIN',
        policyValidationStatus: 'DATA_UNAVAILABLE',
        executionStatus: 'NOT_EXECUTABLE',
      },
    };
    const adminFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => adminResponse }) as Response);
    await requestAiAnalysis('admin', 'Explain current liquidity', walletAddress, adminFetch as typeof fetch);

    expect(adminFetch).toHaveBeenCalledWith('/api/ai/admin', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prompt: 'Explain current liquidity' }),
    }));
    expect(JSON.parse(adminFetch.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty('role');
  });
});
