import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import "../auth.css";
import { useNavigate } from "react-router-dom";

const FIELDS = [
  {
    name: "firstName",
    label: "First Name",
    type: "text",
    placeholder: "Ada",
    half: true,
  },
  {
    name: "lastName",
    label: "Last Name",
    type: "text",
    placeholder: "Lovelace",
    half: true,
  },
  {
    name: "username",
    label: "Username",
    type: "text",
    placeholder: "ada_lovelace",
    half: false,
  },
  {
    name: "email",
    label: "Email Address",
    type: "email",
    placeholder: "ada@example.com",
    half: false,
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    placeholder: "••••••••••••",
    half: false,
  },
];

const ROLES = [
  {
    value: "client",
    label: "Client",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="8"
          r="4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M4 20c0-4 3.582-7 8-7s8 3 8 7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
    description: "Post AI projects & hire experts",
  },
  {
    value: "developer",
    label: "Developer",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <polyline
          points="16 18 22 12 16 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="8 6 2 12 8 18"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    description: "Bid on projects & get hired",
  },
];

/* ─── RoleSelector ───────────────────────────────────────── */
function RoleSelector({ selected, onChange }) {
  return (
    <div className="auth-field">
      <label className="auth-label">I am joining as</label>
      <div className="role-selector">
        {ROLES.map((role) => {
          const active = selected === role.value;
          return (
            <button
              key={role.value}
              type="button"
              onClick={() => onChange(role.value)}
              className={`role-option${active ? " role-option--active" : ""}`}
              aria-pressed={active}
            >
              <span className="role-option__icon">{role.icon}</span>
              <span className="role-option__body">
                <span className="role-option__label">{role.label}</span>
                <span className="role-option__desc">{role.description}</span>
              </span>
              {/* active check mark */}
              <span
                className={`role-option__check${active ? " role-option__check--visible" : ""}`}
                aria-hidden="true"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="6.5" fill="url(#rc)" />
                  <path
                    d="M3.5 6.5L5.5 8.5L9.5 4.5"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <defs>
                    <linearGradient
                      id="rc"
                      x1="0"
                      y1="0"
                      x2="13"
                      y2="13"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#4f8ef7" />
                      <stop offset="1" stopColor="#7c5cfc" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── AuthInput ─────────────────────────────────────────── */
function AuthInput({
  field,
  value,
  focused,
  onChange,
  onFocus,
  onBlur,
  errors = {},
}) {
  const hasError = !!errors[field.name];
  const isValid = !hasError && value.length > 0;

  const inputClass = [
    "auth-input",
    focused === field.name ? "auth-input--focused" : "",
    hasError ? "auth-input--error" : "",
    isValid ? "auth-input--valid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`auth-field${hasError ? " auth-field--error" : ""}`}>
      <label className="auth-label" htmlFor={field.name}>
        {field.label}
      </label>
      <div className="auth-input-wrapper">
        <input
          id={field.name}
          name={field.name}
          type={field.type}
          placeholder={field.placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => onFocus(field.name)}
          onBlur={onBlur}
          className={inputClass}
          autoComplete={field.name === "password" ? "new-password" : "off"}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${field.name}-error` : undefined}
        />

        {hasError && (
          <span
            className="auth-input-icon auth-input-icon--error"
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="#f87171"
                strokeWidth="1.4"
              />
              <path
                d="M7 4.5V7.5"
                stroke="#f87171"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle cx="7" cy="9.5" r="0.75" fill="#f87171" />
            </svg>
          </span>
        )}
      </div>
      {hasError && (
        <p className="auth-error" id={`${field.name}-error`} role="alert">
          {errors[field.name]}
        </p>
      )}
    </div>
  );
}

/* ─── Signup ─────────────────────────────────────────────── */
function Signup() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
    email: "",
    password: "",
    role: "client",
  });
  const [focused, setFocused] = useState("");
  const [errors, setErrors] = useState({});
  const [shaking, setShaking] = useState(false);
  const formRef = useRef(null);
  const navigate = useNavigate();

  const validate = () => {
    const newErrors = {};
    if (!form.firstName.trim()) newErrors.firstName = "First name is required";
    if (!form.lastName.trim()) newErrors.lastName = "Last name is required";
    if (!form.username.trim()) {
      newErrors.username = "Username is required";
    } else if (form.username.length < 3) {
      newErrors.username = "Username must be at least 3 characters";
    }
    if (!form.email) {
      newErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(form.email)) {
      newErrors.email = "Invalid email format";
    }
    if (!form.password) {
      newErrors.password = "Password is required";
    } else if (form.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    } else if (!/(?=.*[A-Z])(?=.*[0-9])/.test(form.password)) {
      newErrors.password = "Password must contain uppercase and number";
    }
    return newErrors;
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });
  const handleRoleChange = (role) => setForm({ ...form, role });

  const triggerShake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 420);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      triggerShake();
      return;
    }
    setErrors({});
    try {
      const res = await fetch("http://localhost:5000/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        if (data.field) {
          setErrors({ [data.field]: data.message });
          triggerShake();
        } else {
          setErrors({ general: data.message || "Something went wrong" });
        }
        return;
      }
      const data = await res.json();

      // store auth data
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data));

      console.log(data);
      // redirect
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
    }
  };

  const halfFields = FIELDS.filter((f) => f.half);
  const fullFields = FIELDS.filter((f) => !f.half);

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb--1" />
        <div className="auth-orb auth-orb--2" />
        <div className="auth-grid" />
      </div>

      {/* ── Left Panel ── */}
      <div className="auth-left">
        <Link to="/" className="auth-back-logo">
          NeuralForge
        </Link>
        <div className="auth-left-content">
          <div className="auth-badge">
            <span className="badge-dot" />
            Trusted by 120+ verified developers
          </div>
          <h1 className="auth-headline">
            The AI marketplace
            <br />
            built for{" "}
            <span className="auth-headline-gradient">serious builders</span>
          </h1>
          <p className="auth-subtext">
            Post projects, receive expert bids, and ship AI solutions faster
            than ever. Join a platform where quality meets execution.
          </p>
          <div className="auth-social-proof">
            <div className="auth-avatars">
              {["AO", "TK", "PM", "DY"].map((i) => (
                <div className="auth-avatar" key={i}>
                  {i}
                </div>
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

          <div className="auth-divider">
            <span>OR</span>
          </div>

          {errors.general && (
            <div className="auth-error--banner" role="alert">
              {errors.general}
            </div>
          )}

          <form
            ref={formRef}
            className={`auth-form${shaking ? " auth-form--shake" : ""}`}
            onSubmit={handleSubmit}
          >
            {/* Role selector — first field */}
            <RoleSelector selected={form.role} onChange={handleRoleChange} />

            {/* Name row */}
            <div className="auth-row">
              {halfFields.map((f) => (
                <AuthInput
                  key={f.name}
                  field={f}
                  value={form[f.name]}
                  focused={focused}
                  onChange={handleChange}
                  onFocus={setFocused}
                  onBlur={() => setFocused("")}
                  errors={errors}
                />
              ))}
            </div>

            {/* Full-width fields */}
            {fullFields.map((f) => (
              <AuthInput
                key={f.name}
                field={f}
                value={form[f.name]}
                focused={focused}
                onChange={handleChange}
                onFocus={setFocused}
                onBlur={() => setFocused("")}
                errors={errors}
              />
            ))}

            <button type="submit" className="auth-submit-btn">
              Create Account →
            </button>
          </form>

          <p className="auth-redirect">
            Already have an account?{" "}
            <Link to="/login" className="auth-link">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M43.6 20.5H24v7.5h11.1c-1 5-5.3 8.5-11.1 8.5-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.7 2.9l5.6-5.6C33.9 7 29.2 5 24 5 12.9 5 4 13.9 4 25s8.9 20 20 20c11 0 19.4-7.8 19.4-20 0-1.3-.1-2.3-.3-3.4-.1-.4-.1-.8-.1-1.1z"
        fill="#4285F4"
      />
      <path
        d="M6.3 14.7l6.6 4.8C14.5 15.8 18.9 13 24 13c3 0 5.7 1.1 7.7 2.9l5.6-5.6C33.9 7 29.2 5 24 5c-7.7 0-14.4 4.4-17.7 9.7z"
        fill="#EA4335"
      />
      <path
        d="M24 45c5.1 0 9.8-1.7 13.4-4.7l-6.2-5.1C29.5 36.6 26.9 37.5 24 37.5c-5.7 0-10.5-3.8-12.2-9L5.5 33.8C8.9 40.3 15.9 45 24 45z"
        fill="#34A853"
      />
      <path
        d="M43.6 20.5H24v7.5h11.1c-.5 2.5-2 4.6-4.1 6L37.4 39c3.8-3.5 6-8.7 6-14.5 0-1-.1-1.7-.3-2.5-.1-.4-.1-.8-.1-1.1z"
        fill="#FBBC05"
      />
    </svg>
  );
}

export default Signup;
