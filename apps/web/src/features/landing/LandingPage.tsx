import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Swap',
    description: 'Move between supported assets easily.',
    action: 'Explore Swap',
    to: '/swap',
    icon: '⇄',
    tone: 'cyan',
  },
  {
    title: 'Earn',
    description: 'Explore ways your USDC can work for you.',
    action: 'Explore Earn',
    to: '/earn',
    icon: '↗',
    tone: 'green',
  },
  {
    title: 'Transactions',
    description: 'See your Treasury activity clearly.',
    action: 'View Transactions',
    to: '/transactions',
    icon: '↕',
    tone: 'blue',
  },
  {
    title: 'AI Assistant',
    description: 'Get helpful guidance while you manage your Treasury.',
    action: 'Open AI Assistant',
    to: '/ai-assistant',
    icon: '✳',
    tone: 'violet',
  },
] as const;

const destinations = [
  {
    title: 'Ready',
    description: 'Available when needed',
    icon: 'available',
    tone: 'mint',
  },
  {
    title: 'Grow',
    description: 'Selected earning options',
    icon: 'growth',
    tone: 'green',
  },
  {
    title: 'Stay Ready',
    description: 'Liquidity within reach',
    icon: 'liquidity',
    tone: 'blue',
  },
  {
    title: 'Smart Guidance',
    description: 'Helpful guidance & planning',
    icon: 'guidance',
    tone: 'violet',
  },
] as const;

const purposes = [
  {
    title: 'Liquid Operational Reserve',
    description: 'USDC liquidity for operational needs and user withdrawals, subject to available liquidity and existing controls.',
    icon: 'today',
    tone: 'mint',
  },
  {
    title: 'Yield Strategy',
    description: 'Explore approved yield opportunities when strategy eligibility and existing controls permit.',
    icon: 'work',
    tone: 'green',
  },
  {
    title: 'Liquidity Availability',
    description: 'Keep liquidity accessible when needed; this is not a separate swap balance.',
    icon: 'reach',
    tone: 'blue',
  },
  {
    title: 'Automation & AI Guidance',
    description: 'Use planning and recommendations for approved operations; AI guidance does not move funds or bypass existing controls.',
    icon: 'prepared',
    tone: 'violet',
  },
] as const;

type LandingIconName =
  | 'wallet'
  | (typeof destinations)[number]['icon']
  | (typeof purposes)[number]['icon'];

function LandingIcon({ name }: { name: LandingIconName }) {
  const iconPaths: Record<LandingIconName, React.ReactNode> = {
    wallet: <><path d="M5 5.5h13.5A2.5 2.5 0 0 1 21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2.5 2.5 0 0 1 2-2.5Z" /><path d="M3.2 9H21v6h-5a3 3 0 0 1 0-6h5" /><circle cx="16" cy="12" r=".65" fill="currentColor" stroke="none" /></>,
    available: <><circle cx="12" cy="12" r="8.5" /><path d="M15 8.5c-.7-.6-1.6-.9-2.7-.9-1.5 0-2.5.7-2.5 1.8 0 2.8 5.4 1.1 5.4 4.2 0 1.2-1.1 2-2.8 2-1.2 0-2.3-.4-3.1-1.1M12 6v12" /></>,
    growth: <><path d="M4 19.5h16M5.5 16l4-4 3 2 6-7" /><path d="M14.5 7H19v4.5" /></>,
    liquidity: <><path d="M12 3.5 19 7v5c0 4.2-2.9 7.3-7 8.5C7.9 19.3 5 16.2 5 12V7l7-3.5Z" /><path d="M8.5 12h7m-3-3 3 3-3 3" /></>,
    guidance: <><path d="M12 3.5v3m0 11v3M3.5 12h3m11 0h3M6 6l2.1 2.1m7.8 7.8L18 18m0-12-2.1 2.1m-7.8 7.8L6 18" /><circle cx="12" cy="12" r="4" /><path d="m10.5 12 1 1 2-2" /></>,
    today: <><rect x="4" y="5.5" width="16" height="15" rx="2" /><path d="M8 3.5v4m8-4v4M4 10h16m-11 4h2m3 0h2m-7 3h2" /></>,
    work: <><path d="M4 19.5h16M5.5 16l4-4 3 2 6-7" /><path d="M14.5 7H19v4.5" /></>,
    reach: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4.5v4h4m4-1v5l3.5 2" /></>,
    prepared: <><path d="m12 3 1.6 5.1L19 10l-5.4 1.9L12 17l-1.6-5.1L5 10l5.4-1.9L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {iconPaths[name]}
    </svg>
  );
}

export function LandingPage() {
  return (
    <div className="vx-landing">
      <section className="vx-landing-hero" aria-labelledby="landing-title">
        <div className="vx-landing-copy">
          <span className="vx-landing-kicker">VELOX TREASURY</span>
          <h1 id="landing-title">Manage your USDC. Simply.</h1>
          <p>Keep, grow and manage your USDC from one place, with clear tools and helpful guidance whenever you need it.</p>
          <div className="vx-landing-actions">
            <Link className="vx-btn vx-btn-primary vx-landing-primary" to="/treasury">
              Enter Velox Treasury <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="vx-landing-features" id="features" aria-labelledby="features-title">
        <div className="vx-landing-section-heading">
          <div>
            <span className="vx-landing-overline">Explore Velox</span>
            <h2 id="features-title">Everything in one place</h2>
          </div>
        </div>
        <div className="vx-landing-feature-grid">
          {features.map((feature) => (
            <article className={`vx-landing-feature vx-landing-feature-${feature.tone}`} key={feature.title}>
              <div className="vx-landing-feature-top">
                <span className="vx-landing-feature-icon" aria-hidden="true">{feature.icon}</span>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <Link className="vx-landing-feature-link" to={feature.to}>
                {feature.action}<span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="vx-landing-workflow" aria-labelledby="landing-workflow-title">
        <div className="vx-landing-workflow-heading">
          <div>
            <span className="vx-landing-overline">A clearer way to manage</span>
            <h2 id="landing-workflow-title">Your USDC, working with purpose.</h2>
          </div>
        </div>
        <div className="vx-landing-story">
          <div className="vx-landing-story-source">
            <span className="vx-landing-story-avatar vx-landing-visual-mint" aria-hidden="true">
              <LandingIcon name="wallet" />
            </span>
            <span>Your USDC</span>
          </div>
          <div className="vx-landing-story-center">
            <span className="vx-landing-story-core" aria-hidden="true">
              <span className="vx-landing-story-core-mark">V</span>
              <span className="vx-landing-story-orbit vx-landing-story-orbit-one" />
              <span className="vx-landing-story-orbit vx-landing-story-orbit-two" />
            </span>
            <strong>Velox</strong>
            <span className="vx-landing-story-center-caption">Your Treasury, in one place.</span>
          </div>
          <div className="vx-landing-story-destinations">
            <span className="vx-landing-energy-pulse vx-landing-energy-pulse-ready" aria-hidden="true" />
            <span className="vx-landing-energy-pulse vx-landing-energy-pulse-grow" aria-hidden="true" />
            <span className="vx-landing-energy-pulse vx-landing-energy-pulse-stay" aria-hidden="true" />
            <span className="vx-landing-energy-pulse vx-landing-energy-pulse-guidance" aria-hidden="true" />
            {destinations.map((destination) => (
              <article className={`vx-landing-story-destination vx-landing-visual-${destination.tone}`} key={destination.title}>
                <span className="vx-landing-destination-icon" aria-hidden="true">
                  <LandingIcon name={destination.icon} />
                </span>
                <h3>{destination.title}</h3>
                <p>{destination.description}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="vx-landing-purpose-support">
          <span className="vx-landing-overline">How Velox manages your USDC</span>
          <h3>One Treasury. Four ways to support your goals.</h3>
          <p className="vx-landing-purpose-intro">
            These are product concepts, not separate on-chain balances or a claim that funds have been allocated among them.
          </p>
          <div className="vx-landing-purpose-grid">
            {purposes.map((purpose) => (
              <article className={`vx-landing-purpose-item vx-landing-visual-${purpose.tone}`} key={purpose.title}>
                <span className="vx-landing-purpose-icon" aria-hidden="true">
                  <LandingIcon name={purpose.icon} />
                </span>
                <span className="vx-landing-purpose-copy">
                  <strong>{purpose.title}</strong>
                  <span>{purpose.description}</span>
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="vx-landing-final-cta" aria-labelledby="landing-cta-title">
        <div>
          <span className="vx-landing-overline">A simpler way forward</span>
          <h2 id="landing-cta-title">Ready to manage your USDC?</h2>
        </div>
        <Link className="vx-landing-cta-link" to="/treasury">
          Enter Velox Treasury <span aria-hidden="true">→</span>
        </Link>
      </section>
    </div>
  );
}
