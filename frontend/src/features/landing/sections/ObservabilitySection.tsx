import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';
import { MediaAsset } from '../MediaAsset';

const MEDIA_FILE = 'trace_execution_ui.png';

export default function ObservabilitySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

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

      // ENTRANCE (0%–30%): slide in from sides — tight distances
      scrollTl.fromTo(
        textRef.current,
        { x: '-10vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power4.out' },
        0
      );

      scrollTl.fromTo(
        imageRef.current,
        { x: '12vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power4.out' },
        0.06
      );

      // SETTLE (30%–68%): hold

      // EXIT (68%–100%): gentle drift out
      scrollTl.fromTo(
        textRef.current,
        { x: 0, opacity: 1 },
        { x: '-7vw', opacity: 0, ease: 'power3.in' },
        0.68
      );

      scrollTl.fromTo(
        imageRef.current,
        { x: 0, opacity: 1 },
        { x: '7vw', opacity: 0, ease: 'power3.in' },
        0.68
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="section-pinned grid-bg flex items-center z-30"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="w-full px-[6vw]">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
          {/* Left text block */}
          <div ref={textRef} className="w-full lg:w-[40vw]">
            <h2
              className="font-heading font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Know exactly what happened, when, and why.
            </h2>
            <p
              className="text-base lg:text-lg leading-relaxed mb-8"
              style={{ color: 'var(--text-secondary)' }}
            >
              Every event carries a full execution trace—payload, response, timing,
              and error details. No more digging through logs to find out why a
              delivery failed.
            </p>
            <a href="#delivery-log" className="link-arrow">
              Explore the delivery log
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Right image */}
          <div
            ref={imageRef}
            className="w-full lg:w-[46vw] lg:h-[72vh] relative"
          >
            <div className="dashboard-shadow rounded-2xl overflow-hidden border border-[var(--card-border)]">
              <MediaAsset
                src={`${import.meta.env.BASE_URL}images/${theme}/${MEDIA_FILE}`}
                alt="Execution Trace Dashboard"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
