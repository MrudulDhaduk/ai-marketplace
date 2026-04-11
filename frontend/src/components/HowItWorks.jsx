import { useFadeUp } from '../hooks/useFadeup';

const steps = [
  {
    num: '01',
    icon: '📝',
    title: 'Post Your Requirement',
    desc: 'Describe what you need in plain language. Our structured form helps you define scope, budget, and timeline clearly.',
  },
  {
    num: '02',
    icon: '💼',
    title: 'Receive Expert Bids',
    desc: 'Vetted AI developers review your project and send tailored proposals with pricing, timeline, and approach.',
  },
  {
    num: '03',
    icon: '🚀',
    title: 'Get It Built',
    desc: 'Choose the best fit, fund escrow securely, and get your AI solution delivered — with quality guaranteed.',
  },
];

function HowItWorks() {
  const ref = useFadeUp();

  return (
    <>
      <div className="section-divider" />
      <section id="how-it-works" className="section fade-up" ref={ref}>
        <div className="center">
          <div className="section-label">Process</div>
          <h2 className="section-heading">From idea to AI in three steps</h2>
          <p className="section-sub">
            We've streamlined the process so you can focus on building, not managing.
          </p>
        </div>

        <div className="steps-grid">
          {steps.map((step) => (
            <div className="step-card" key={step.num}>
              <div className="step-num">{step.num}</div>
              <div className="step-icon">{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default HowItWorks;