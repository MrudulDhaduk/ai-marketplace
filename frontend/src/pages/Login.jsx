import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../auth.css';

function Login() {
  const [form, setForm]       = useState({ username: '', password: '' });
  const [focused, setFocused] = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const handleSubmit = (e) => { e.preventDefault(); console.log(form); };

  const fields = [
    { name: 'username', label: 'Username', type: 'text',     placeholder: 'ada_lovelace' },
    { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••••••' },
  ];

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb--1" />
        <div className="auth-orb auth-orb--2" />
        <div className="auth-grid" />
      </div>

      {/* ── Left Panel ── */}
      <div className="auth-left">
        <Link to="/" className="auth-back-logo">NeuralForge</Link>

        <div className="auth-left-content">
          <div className="auth-badge">
            <span className="badge-dot" />
            98% client satisfaction rate
          </div>

          <h1 className="auth-headline">
            Welcome back to<br />
            <span className="auth-headline-gradient">NeuralForge</span>
          </h1>

          <p className="auth-subtext">
            Your next AI project is waiting. Log in to manage your projects,
            review bids, and collaborate with expert developers.
          </p>

          {/* Stat strip */}
          <div className="auth-stats">
            <div className="auth-stat">
              <div className="auth-stat-num">340+</div>
              <div className="auth-stat-label">Projects Built</div>
            </div>
            <div className="auth-stat">
              <div className="auth-stat-num">120+</div>
              <div className="auth-stat-label">Developers</div>
            </div>
            <div className="auth-stat">
              <div className="auth-stat-num">98%</div>
              <div className="auth-stat-label">Satisfaction</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="auth-right">
        <div className="auth-card">
          <div className="auth-card-header">
            <h2>Welcome back</h2>
            <p>Sign in to your NeuralForge account</p>
          </div>

          <button className="auth-google-btn" type="button">
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="auth-divider"><span>OR</span></div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {fields.map((field) => (
              <div className="auth-field" key={field.name}>
                <div className="auth-label-row">
                  <label className="auth-label" htmlFor={field.name}>
                    {field.label}
                  </label>
                  {field.name === 'password' && (
                    <a href="#" className="auth-forgot">Forgot password?</a>
                  )}
                </div>
                <input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={form[field.name]}
                  onChange={handleChange}
                  onFocus={() => setFocused(field.name)}
                  onBlur={() => setFocused('')}
                  className={`auth-input${focused === field.name ? ' auth-input--focused' : ''}`}
                  autoComplete={field.name === 'password' ? 'current-password' : 'username'}
                />
              </div>
            ))}

            <button type="submit" className="auth-submit-btn">
              Sign In →
            </button>
          </form>

          <p className="auth-redirect">
            Don't have an account?{' '}
            <Link to="/signup" className="auth-link">Sign up free</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M43.6 20.5H24v7.5h11.1c-1 5-5.3 8.5-11.1 8.5-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.7 2.9l5.6-5.6C33.9 7 29.2 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20c11 0 19.4-7.8 19.4-20 0-1.3-.1-2.3-.3-3.4-.1-.4-.1-.8-.1-1.1z" fill="#4285F4"/>
      <path d="M6.3 14.7l6.6 4.8C14.5 15.8 18.9 13 24 13c3 0 5.7 1.1 7.7 2.9l5.6-5.6C33.9 7 29.2 5 24 5c-7.7 0-14.4 4.4-17.7 9.7z" fill="#EA4335"/>
      <path d="M24 45c5.1 0 9.8-1.7 13.4-4.7l-6.2-5.1C29.5 36.6 26.9 37.5 24 37.5c-5.7 0-10.5-3.8-12.2-9L5.5 33.8C8.9 40.3 15.9 45 24 45z" fill="#34A853"/>
      <path d="M43.6 20.5H24v7.5h11.1c-.5 2.5-2 4.6-4.1 6L37.4 39c3.8-3.5 6-8.7 6-14.5 0-1-.1-1.7-.3-2.5-.1-.4-.1-.8-.1-1.1z" fill="#FBBC05"/>
    </svg>
  );
}

export default Login;