import { Link } from "react-router-dom";
function Navbar() {
  return (
    <nav className="navbar">
      <div className="nav-logo">NeuralForge</div>

      <ul className="nav-links">
        <li><a href="#how-it-works">How It Works</a></li>
        <li><a href="#projects">Projects</a></li>
        <li><a href="#audience">Developers</a></li>
        <li><a href="#pricing">Pricing</a></li>
      </ul>

      <div className="nav-right">
        <Link to="/login" className="btn-ghost">Log in</Link>
        <Link to="/signup" className="btn-primary">Get Started →</Link>
      </div>
    </nav>
  );
}

export default Navbar;