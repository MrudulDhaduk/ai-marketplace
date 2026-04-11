import { useFadeUp } from '../hooks/useFadeup';

function CTA() {
  const ref = useFadeUp();

  return (
    <div className="cta-section fade-up" ref={ref}>
      <div className="cta-inner">
        <h2>
          Ready to build something<br />with AI?
        </h2>
        <p>Join thousands of businesses and developers already on the platform.</p>
        <div className="cta-buttons">
          <button className="btn-large primary">Post Your First Project</button>
          <button className="btn-large secondary">Join as Developer</button>
        </div>
      </div>
    </div>
  );
}

export default CTA;