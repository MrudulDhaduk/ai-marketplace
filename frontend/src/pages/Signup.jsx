import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../auth.css';

const FIELDS = [
  { name: 'firstName', label: 'First Name',     type: 'text',     placeholder: 'Ada',            half: true  },
  { name: 'lastName',  label: 'Last Name',      type: 'text',     placeholder: 'Lovelace',       half: true  },
  { name: 'username',  label: 'Username',       type: 'text',     placeholder: 'ada_lovelace',   half: false },
  { name: 'email',     label: 'Email Address',  type: 'email',    placeholder: 'ada@example.com',half: false },
  { name: 'password',  label: 'Password',       type: 'password', placeholder: '••••••••••••',   half: false },
];

function AuthInput({ field, value, focused, onChange, onFocus, onBlur }) {
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={field.name}>{field.label}</label>
      <input
        id={field.name}
        name={field.name}
        type={field.type}
        placeholder={field.placeholder}
        value={value}
        onChange={onChange}
        onFocus={() => onFocus(field.name)}
        onBlur={onBlur}
        className={`auth-input${focused === field.name ? ' auth-input--focused' : ''}`}
        autoComplete={field.name === 'password' ? 'new-password' : 'off'}
      />
    </div>
  );
}

function Signup() {
  const [form, setForm]       = useState({ firstName: '', lastName: '', username: '', email: '', password: '' });
  const [focused, setFocused] = useState('');

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const handleSubmit = (e) => { e.preventDefault(); console.log(form); };

  const halfFields = FIELDS.filter(f => f.half);
  const fullFields = FIELDS.filter(f => !f.half);

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
            Trusted by 120+ verified developers
          </div>

          <h1 className="auth-headline">
            The AI marketplace<br />
            built for{' '}
            <span className="auth-headline-gradient">serious builders</span>
          </h1>

          <p className="auth-subtext">
            Post projects, receive expert bids, and ship AI solutions faster than ever.
            Join a platform where quality meets execution.
          </p>

          <div className="auth-social-proof">
            <div className="auth-avatars">
              {['AO', 'TK', 'PM', 'DY'].map((i) => (
                <div className="auth-avatar" key={i}>{i}</div>
              ))}
            </div>
            <span>340+ AI projects built and counting</span>
          </div>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="auth-right">
        <div className="auth-card">
          <div className="auth-card-header">
            <h2>Create your account</h2>
            <p>Start building with AI experts today</p>
          </div>

          <button className="auth-google-btn" type="button">
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="auth-divider"><span>OR</span></div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {/* Half-width row */}
            <div className="auth-row">
              {halfFields.map((f) => (
                <AuthInput key={f.name} field={f} value={form[f.name]}
                  focused={focused} onChange={handleChange}
                  onFocus={setFocused} onBlur={() => setFocused('')} />
              ))}
            </div>

            {/* Full-width fields */}
            {fullFields.map((f) => (
              <AuthInput key={f.name} field={f} value={form[f.name]}
                focused={focused} onChange={handleChange}
                onFocus={setFocused} onBlur={() => setFocused('')} />
            ))}

            <button type="submit" className="auth-submit-btn">
              Create Account →
            </button>
          </form>

          <p className="auth-redirect">
            Already have an account?{' '}
            <Link to="/login" className="auth-link">Log in</Link>
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

export default Signup;