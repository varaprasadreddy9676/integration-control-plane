import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ThemeProvider } from '../../hooks/useTheme';
import Navigation from './sections/Navigation';
import HeroSection from './sections/HeroSection';
import { LoginModal } from './LoginModal';
import FeaturesSection from './sections/FeaturesSection';
import ObservabilitySection from './sections/ObservabilitySection';
import MultiTenantSection from './sections/MultiTenantSection';
import AIAssistantSection from './sections/AIAssistantSection';
import OpenSourceSection from './sections/OpenSourceSection';
import FooterSection from './sections/FooterSection';
import './landing.css';
import { useState } from 'react';

gsap.registerPlugin(ScrollTrigger);

function LandingPageContent() {
  const [loginOpen, setLoginOpen] = useState(false);

  // Initialize Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 2.0,
    });

    // Connect Lenis to GSAP ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.destroy();
    };
  }, []);

  // Cleanup all ScrollTriggers on unmount
  useEffect(() => {
    return () => {
      ScrollTrigger.getAll().forEach((st) => st.kill());
    };
  }, []);

  return (
    // .landing-page scopes all Tailwind utilities and CSS variables
    <div className="landing-page relative">
      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* Navigation */}
      <Navigation onLoginClick={() => setLoginOpen(true)} />

      {/* Main content */}
      <main className="relative">
        <HeroSection onLoginClick={() => setLoginOpen(true)} />
        <FeaturesSection />
        <ObservabilitySection />
        <MultiTenantSection />
        <AIAssistantSection />
        <OpenSourceSection />
        <FooterSection onLoginClick={() => setLoginOpen(true)} />
      </main>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

export function LandingPage() {
  return (
    <ThemeProvider>
      <LandingPageContent />
    </ThemeProvider>
  );
}
