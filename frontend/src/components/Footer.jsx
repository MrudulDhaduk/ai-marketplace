const footerLinks = {
  Platform: ['Browse Projects', 'Post a Project', 'Find Developers', 'Pricing'],
  Company: ['About', 'Blog', 'Careers', 'Press'],
  Legal: ['Privacy', 'Terms', 'Security', 'Cookies'],
};

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <div className="logo">NeuralForge</div>
          <p>The marketplace where AI ambition meets expert execution.</p>
          <div className="social-links">
            <a className="social-btn" href="#" aria-label="X / Twitter">𝕏</a>
            <a className="social-btn" href="#" aria-label="LinkedIn">in</a>
            <a className="social-btn" href="#" aria-label="GitHub">gh</a>
          </div>
        </div>

        {Object.entries(footerLinks).map(([heading, links]) => (
          <div className="footer-col" key={heading}>
            <h4>{heading}</h4>
            <ul>
              {links.map((link) => (
                <li key={link}>
                  <a href="#">{link}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="footer-bottom">
        <span>© 2025 NeuralForge, Inc. All rights reserved.</span>
        <span>Made for the AI generation</span>
      </div>
    </footer>
  );
}

export default Footer;