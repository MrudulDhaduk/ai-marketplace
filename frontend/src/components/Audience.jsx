import { useFadeUp } from '../hooks/useFadeup';

const clientFeatures = [
  'Custom AI solutions tailored to your workflow',
  'Compare proposals side-by-side before committing',
  'Milestone-based escrow keeps your funds safe',
  'Automate operations and save 10× on development',
];

const devFeatures = [
  'Access a pipeline of vetted AI projects',
  'Earn competitive rates on skills you have mastered',
  'Showcase work with a built-in portfolio',
  'Build long-term client relationships globally',
];

function Audience() {
  const ref = useFadeUp();

  return (
    <>
      <div className="section-divider" />
      <section id="audience" className="section fade-up" ref={ref}>
        <div className="center">
          <div className="section-label">Who It's For</div>
          <h2 className="section-heading">Built for both sides</h2>
          <p className="section-sub">
            Whether you're building AI or hiring for it, NeuralForge has you covered.
          </p>
        </div>

        <div className="audience-grid">
          {/* Clients */}
          <div className="audience-card">
            <div className="audience-icon">👤</div>
            <h3>For Clients</h3>
            <p className="tagline">Bring your AI vision to life without the hiring hassle.</p>
            <ul className="feature-list">
              {clientFeatures.map((item) => (
                <li key={item}>
                  <span className="check blue">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Developers */}
          <div className="audience-card dev">
            <div className="audience-icon">👨‍💻</div>
            <h3>For Developers</h3>
            <p className="tagline">Find real AI work, earn well, and grow your portfolio.</p>
            <ul className="feature-list">
              {devFeatures.map((item) => (
                <li key={item}>
                  <span className="check purple">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

export default Audience;