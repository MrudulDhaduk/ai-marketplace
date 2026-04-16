import "./App.css";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";

import Navbar from "./components/NavBar";

import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Projects from "./components/Projects";
import Audience from "./components/Audience";
import Testimonials from "./components/Testimonials";
import CTA from "./components/Cta";
import Footer from "./components/Footer";

import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard/Dashboard";

import ProtectedRoute from "./components/ProtectedRoute";

import Profile from "./pages/Profile";

function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Projects />
      <Audience />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  );
}

// 🔥 This handles conditional navbar rendering
function AppContent() {
  const location = useLocation();

  const isDashboard =
    location.pathname.startsWith("/dashboard") ||
    location.pathname.startsWith("/profile");

  return (
    <>
      {/* ✅ Conditional Navbar */}
      {!isDashboard && <Navbar />}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
