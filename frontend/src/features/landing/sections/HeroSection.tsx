import { useEffect, useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../../hooks/useTheme';
import { MediaAsset } from '../MediaAsset';

const MEDIA_FILE = 'dashboard_integrations.png';

interface HeroSectionProps {
  onLoginClick: () => void;
}

export default function HeroSection({ onLoginClick }: HeroSectionProps) {
  const { theme } = useTheme();
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const microLabelRef = useRef<HTMLDivElement>(null);

  // Auto-play entrance animation on load
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });

      tl.fromTo(
        microLabelRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.6 },
        0.1
      );

      if (headlineRef.current) {
        const words = headlineRef.current.querySelectorAll('.word');
        tl.fromTo(
          words,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.7, stagger: 0.03 },
          0.2
        );
      }

      tl.fromTo(
        subheadRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.6 },
        0.5
      );

      tl.fromTo(
        ctaRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.5 },
        0.62
      );

      tl.fromTo(
        pillsRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5 },
        0.72
      );

      // Image: fade + subtle drift from right
      tl.fromTo(
        imageRef.current,
        { opacity: 0, x: 40 },
        { opacity: 1, x: 0, duration: 1.0, ease: 'power3.out' },
        0.3
      );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  // Scroll-driven exit animation
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=200%',
          pin: true,
          scrub: 1.0,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onLeaveBack: () => {
            gsap.set(
              [headlineRef.current, subheadRef.current, ctaRef.current, pillsRef.current, microLabelRef.current],
              { opacity: 1, x: 0, y: 0 }
            );
            gsap.set(imageRef.current, { opacity: 1, x: 0 });
          },
        },
      });

      // SETTLE (0%–65%): hold

      // EXIT (65%–100%): subtle, deliberate drift
      scrollTl.fromTo(
        microLabelRef.current,
        { x: 0, opacity: 1 },
        { x: '-5vw', opacity: 0, ease: 'power3.in' },
        0.65
      );

      scrollTl.fromTo(
        headlineRef.current,
        { x: 0, opacity: 1 },
        { x: '-7vw', opacity: 0, ease: 'power3.in' },
        0.67
      );

      scrollTl.fromTo(
        subheadRef.current,
        { x: 0, opacity: 1 },
        { x: '-6vw', opacity: 0, ease: 'power3.in' },
        0.69
      );

      scrollTl.fromTo(
        ctaRef.current,
        { y: 0, opacity: 1 },
        { y: '5vh', opacity: 0, ease: 'power3.in' },
        0.71
      );

      scrollTl.fromTo(
        pillsRef.current,
        { y: 0, opacity: 1 },
        { y: '5vh', opacity: 0, ease: 'power3.in' },
        0.73
      );

      scrollTl.fromTo(
        imageRef.current,
        { x: 0, opacity: 1 },
        { x: '8vw', opacity: 0, ease: 'power3.in' },
        0.67
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="section-pinned grid-bg flex items-center z-10"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="w-full px-[6vw] pt-20">
        <div className="flex flex-col lg:flex-row items-start justify-between gap-8">
          {/* Left content */}
          <div className="w-full lg:w-[46vw] flex flex-col">
            <div ref={microLabelRef} className="micro-label mb-4 flex items-center gap-2">
              INTEGRATION GATEWAY v2.1
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: 'var(--accent-color)',
                border: '1px solid var(--accent-color)',
                borderRadius: 4,
                padding: '1px 6px',
                opacity: 0.85
              }}>
                BETA
              </span>
            </div>

            <h1
              ref={headlineRef}
              className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl xl:text-7xl leading-[0.95] tracking-[-0.02em] mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="word inline-block">The</span>{' '}
              <span className="word inline-block">control</span>{' '}
              <span className="word inline-block">plane</span>{' '}
              <span className="word inline-block">for</span>{' '}
              <span className="word inline-block">your</span>{' '}
              <span className="word inline-block">integrations.</span>
            </h1>

            <p
              ref={subheadRef}
              className="text-base lg:text-lg leading-relaxed max-w-[38ch] mb-8"
              style={{ color: 'var(--text-secondary)' }}
            >
              Outbound delivery, inbound API proxy, and scheduled automation—with
              execution traces, dead-letter queues, and AI-assisted configuration
              built in.
            </p>

            <div ref={ctaRef} className="flex items-center gap-4 mb-8">
              <button className="btn-primary flex items-center gap-2" onClick={onLoginClick}>
                Get started
                <ArrowRight className="w-4 h-4" />
              </button>
              <Link
                to="/docs"
                className="btn-secondary flex items-center gap-2"
                style={{ textDecoration: 'none' }}
              >
                <BookOpen className="w-4 h-4" />
                Read docs
              </Link>
            </div>

            <div ref={pillsRef} className="flex flex-wrap gap-3">
              <span className="trust-pill">Public Beta</span>
              <span className="trust-pill">Open source</span>
              <span className="trust-pill">AGPL v3</span>
              <span className="trust-pill">Self-hosted</span>
              <span className="trust-pill">Multi-tenant</span>
            </div>
          </div>

          {/* Right — Dashboard image */}
          <div
            ref={imageRef}
            className="w-full lg:w-[44vw] lg:h-[72vh] relative"
          >
            <div className="dashboard-shadow rounded-2xl overflow-hidden border border-[var(--card-border)]">
              <MediaAsset
                src={`${import.meta.env.BASE_URL}images/${theme}/${MEDIA_FILE}`}
                alt="Integration Gateway Dashboard"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
