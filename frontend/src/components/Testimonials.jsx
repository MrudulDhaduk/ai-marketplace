import { useFadeUp } from '../hooks/useFadeup';

const testimonials = [
  {
    quote:
      'We launched our AI customer support bot in 3 weeks. The developer we hired through NeuralForge understood the brief immediately and delivered beyond expectations.',
    name: 'Priya Mehta',
    role: 'Head of CX, RetailFlow',
    initials: 'PM',
  },
  {
    quote:
      "As a freelance ML engineer, this platform has been a game-changer. I've closed 8 contracts in 4 months, all on projects that actually match my skills.",
    name: 'Tomas Kowalski',
    role: 'ML Engineer, Independent',
    initials: 'TK',
  },
  {
    quote:
      "The escrow system gave me confidence. I knew my money was safe until the milestone was hit. Will absolutely use NeuralForge for our next AI build.",
    name: 'Aisha Okafor',
    role: 'CTO, FinStep Labs',
    initials: 'AO',
  },
  {
    quote:
      'The quality of developers here is much higher than generic freelance platforms. These people actually know LLMs, embeddings, and production deployment.',
    name: 'Derek Yuen',
    role: 'Founder, ScaleOps',
    initials: 'DY',
  },
  {
    quote:
      'Posted a complex RAG system requirement and had 6 detailed proposals within 24 hours. Chose one, shipped in 5 weeks. The process was seamless.',
    name: 'Lena Fischer',
    role: 'Product Lead, DocuAI',
    initials: 'LF',
  },
  {
    quote:
      "I've doubled my freelance income by focusing purely on AI projects through this platform. The clients are serious and the briefs are well-structured.",
    name: 'Raj Patel',
    role: 'AI Developer, Independent',
    initials: 'RP',
  },
];

function Testimonials() {
  const ref = useFadeUp();

  return (
    <>
      <div className="section-divider" />
      <section className="section fade-up" ref={ref}>
        <div className="center">
          <div className="section-label">Social Proof</div>
          <h2 className="section-heading">Loved by builders</h2>
          <p className="section-sub">
            Don't take our word for it — hear from the people using NeuralForge every day.
          </p>
        </div>

        <div className="testimonials-grid">
          {testimonials.map((t) => (
            <div className="testimonial-card" key={t.name}>
              <div className="stars">★★★★★</div>
              <blockquote>"{t.quote}"</blockquote>
              <div className="testimonial-author">
                <div className="avatar">{t.initials}</div>
                <div>
                  <div className="author-name">{t.name}</div>
                  <div className="author-role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default Testimonials;