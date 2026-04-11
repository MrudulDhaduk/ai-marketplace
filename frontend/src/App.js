import './App.css';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from './components/NavBar';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import Projects from './components/Projects';
import Audience from './components/Audience';
import Testimonials from './components/Testimonials';
import CTA from './components/Cta';
import Footer from './components/Footer';
import Signup from './pages/Signup';
import Login from './pages/Login';

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

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </Router>
  );
}


export default App;