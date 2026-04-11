function Hero() {
  return (
    <section className="hero">
      <div className="hero-bg">
        <div className="grid-lines" />
        <div className="orb1" />
        <div className="orb2" />
      </div>

      <div className="hero-content fade-up visible">
        <div className="hero-badge">
          <span className="badge-dot" />
          Now live — 100+ AI projects posted this week
        </div>

        <h1>
          Build Custom AI<br />
          <span>Solutions</span> with<br />
          Expert Developers
        </h1>

        <p>
          Post your AI requirements and receive competitive bids from vetted
          developers. From LLM integrations to computer vision — built exactly
          to your spec.
        </p>

        <div className="hero-cta">
          <button className="btn-large primary">Post a Project</button>
          <button className="btn-large secondary">Browse Projects →</button>
        </div>

        <div className="hero-stats">
          <div className="stat-item">
            <div className="num">340+</div>
            <div className="label">AI Projects Built</div>
          </div>
          <div className="stat-item">
            <div className="num">120+</div>
            <div className="label">Verified Developers</div>
          </div>
          <div className="stat-item">
            <div className="num">98%</div>
            <div className="label">Client Satisfaction</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;