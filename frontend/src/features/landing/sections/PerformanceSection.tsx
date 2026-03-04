import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Gauge, ClipboardList, Scale } from 'lucide-react';

export default function PerformanceSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadRef = useRef<HTMLParagraphElement>(null);
  const leftCardRef = useRef<HTMLDivElement>(null);
  const rightCardRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=220%',
          pin: true,
          scrub: 1.0,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      scrollTl.fromTo(
        headlineRef.current,
        { y: '-5vh', opacity: 0 },
        { y: 0, opacity: 1, ease: 'power4.out' },
        0
      );

      scrollTl.fromTo(
        subheadRef.current,
        { y: '-4vh', opacity: 0 },
        { y: 0, opacity: 1, ease: 'power4.out' },
        0.04
      );

      scrollTl.fromTo(
        leftCardRef.current,
        { x: '-12vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power4.out' },
        0.08
      );

      scrollTl.fromTo(
        rightCardRef.current,
        { x: '12vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power4.out' },
        0.1
      );

      scrollTl.fromTo(
        footerRef.current,
        { y: '4vh', opacity: 0 },
        { y: 0, opacity: 1, ease: 'power4.out' },
        0.14
      );

      scrollTl.fromTo(
        leftCardRef.current,
        { y: 0, opacity: 1 },
        { y: '7vh', opacity: 0, ease: 'power3.in' },
        0.68
      );

      scrollTl.fromTo(
        rightCardRef.current,
        { y: 0, opacity: 1 },
        { y: '7vh', opacity: 0, ease: 'power3.in' },
        0.7
      );

      scrollTl.fromTo(
        footerRef.current,
        { y: 0, opacity: 1 },
        { y: '6vh', opacity: 0, ease: 'power3.in' },
        0.7
      );

      scrollTl.fromTo(
        headlineRef.current,
        { opacity: 1, y: 0 },
        { opacity: 0, y: '-3vh', ease: 'power3.in' },
        0.72
      );

      scrollTl.fromTo(
        subheadRef.current,
        { opacity: 1, y: 0 },
        { opacity: 0, y: '-3vh', ease: 'power3.in' },
        0.74
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="section-pinned grid-bg flex flex-col items-center justify-center z-[35]"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      <h2
        ref={headlineRef}
        className="font-heading font-bold text-3xl sm:text-4xl lg:text-5xl text-center mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        Proven throughput, in plain numbers.
      </h2>

      <p
        ref={subheadRef}
        className="text-sm sm:text-base lg:text-lg text-center max-w-[92vw] lg:max-w-[62vw] mb-6 lg:mb-8"
        style={{ color: 'var(--text-secondary)' }}
      >
        In our baseline test, one backend instance handled about 110–130 requests/second with full audit logs,
        and 1,300+ requests/second in minimal-logging performance mode.
      </p>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 px-[6vw] w-full mb-4 lg:mb-5">
        <div ref={leftCardRef} className="glass-card w-full lg:w-1/2 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4" style={{ color: 'var(--accent-color)' }} />
            <span className="micro-label">Full Audit Logging</span>
          </div>
          <p className="font-heading font-bold text-2xl mb-2" style={{ color: 'var(--text-primary)' }}>
            ~113–130 TPS
          </p>
          <ul className="text-xs sm:text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <li>Best when every request needs full trace details.</li>
            <li>Plan about 100 TPS per instance, then keep 30–40% headroom.</li>
          </ul>
        </div>

        <div ref={rightCardRef} className="glass-card w-full lg:w-1/2 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="w-4 h-4" style={{ color: 'var(--accent-color)' }} />
            <span className="micro-label">Performance Logging</span>
          </div>
          <p className="font-heading font-bold text-2xl mb-2" style={{ color: 'var(--text-primary)' }}>
            ~1,305–1,398 TPS
          </p>
          <ul className="text-xs sm:text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <li>Best when throughput is the top priority.</li>
            <li>Plan about 1,200 TPS per instance, then keep 30–40% headroom.</li>
          </ul>
        </div>
      </div>

      <div ref={footerRef} className="glass-card w-[92vw] lg:w-[88vw] px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <ClipboardList className="w-4 h-4" style={{ color: 'var(--accent-color)' }} />
          <span className="micro-label">How We Measured This</span>
        </div>
        <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
          Benchmark setup
          <br />
          Single backend + single MongoDB
          <br />
          20s sustained run, up to 100 concurrent clients
          <br />
          Millions/day requires horizontal scaling (not single-instance full-audit mode)
        </p>
      </div>
    </section>
  );
}
