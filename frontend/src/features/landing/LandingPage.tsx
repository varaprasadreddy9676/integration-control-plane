import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ThemeProvider } from '../../hooks/useTheme';
import Navigation from './sections/Navigation';
import HeroSection from './sections/HeroSection';
import { LoginModal } from './LoginModal';
import FeaturesSection from './sections/FeaturesSection';
import ObservabilitySection from './sections/ObservabilitySection';
import PerformanceSection from './sections/PerformanceSection';
import MultiTenantSection from './sections/MultiTenantSection';
import AIAssistantSection from './sections/AIAssistantSection';
import OpenSourceSection from './sections/OpenSourceSection';
import FooterSection from './sections/FooterSection';
import './landing.css';
import { useState } from 'react';

gsap.registerPlugin(ScrollTrigger);

function LandingPageContent() {
  const [loginOpen, setLoginOpen] = useState(false);
  const lenisRef = useRef<Lenis | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track mouse for ambient glow effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Calculate position relative to the container
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        containerRef.current.style.setProperty('--mouse-x', `${x}px`);
        containerRef.current.style.setProperty('--mouse-y', `${y}px`);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Initialize Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 0.8,
      syncTouch: true,
      touchMultiplier: 1.5,
    });

    lenisRef.current = lenis;

    // Connect Lenis to GSAP ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });

    gsap.ticker.lagSmoothing(0);

    return () => {
      lenisRef.current = null;
      lenis.destroy();
    };
  }, []);

  // Handle URL hash on initial load and hash changes
  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash && lenisRef.current) {
        const target = document.querySelector(window.location.hash) as HTMLElement;
        if (target) {
          // Add a small delay for DOM layout before scrolling
          setTimeout(() => {
            lenisRef.current?.scrollTo(target, {
              offset: 0,
              immediate: true,
              onComplete: () => {
                ScrollTrigger.refresh(true);
              }
            });
          }, 100);
        }
      } else {
        // Even if no hash, force a refresh once rendering is complete
        setTimeout(() => ScrollTrigger.refresh(true), 100);
      }
    };

    handleHash();

    // Attempt refresh after images load
    window.addEventListener('load', () => ScrollTrigger.refresh(true));
    window.addEventListener('hashchange', handleHash);

    return () => {
      window.removeEventListener('load', () => ScrollTrigger.refresh(true));
      window.removeEventListener('hashchange', handleHash);
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
    <div ref={containerRef} className="landing-page relative">
      {/* Dynamic mouse glow overlay */}
      <div className="mouse-glow pointer-events-none fixed inset-0 z-0 transition-opacity duration-300" />

      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* Navigation */}
      <Navigation onLoginClick={() => setLoginOpen(true)} />

      {/* Main content */}
      <main className="relative">
        <HeroSection onLoginClick={() => setLoginOpen(true)} />
        <FeaturesSection />
        <ObservabilitySection />
        <PerformanceSection />
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
