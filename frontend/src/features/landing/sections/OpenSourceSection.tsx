import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export default function OpenSourceSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const leftCardRef = useRef<HTMLDivElement>(null);
  const rightCardRef = useRef<HTMLDivElement>(null);

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

      // ENTRANCE: text rises, cards slide in from sides
      scrollTl.fromTo(
        headlineRef.current,
        { y: '-5vh', opacity: 0 },
        { y: 0, opacity: 1, ease: 'power4.out' },
        0
      );

      scrollTl.fromTo(
        bodyRef.current,
        { y: '-4vh', opacity: 0 },
        { y: 0, opacity: 1, ease: 'power4.out' },
        0.04
      );

      // Cards slide in with subtle rotation — keep the polish
      scrollTl.fromTo(
        leftCardRef.current,
        { x: '-12vw', opacity: 0, rotate: -0.5 },
        { x: 0, opacity: 1, rotate: 0, ease: 'power4.out' },
        0.08
      );

      scrollTl.fromTo(
        rightCardRef.current,
        { x: '12vw', opacity: 0, rotate: 0.5 },
        { x: 0, opacity: 1, rotate: 0, ease: 'power4.out' },
        0.10
      );

      // SETTLE (30%–68%): hold

      // EXIT: cards drift down, text fades up
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
        0.70
      );

      scrollTl.fromTo(
        headlineRef.current,
        { opacity: 1, y: 0 },
        { opacity: 0, y: '-3vh', ease: 'power3.in' },
        0.70
      );

      scrollTl.fromTo(
        bodyRef.current,
        { opacity: 1, y: 0 },
        { opacity: 0, y: '-3vh', ease: 'power3.in' },
        0.72
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="section-pinned grid-bg flex flex-col items-center justify-center z-[60]"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <h2
        ref={headlineRef}
        className="font-heading font-bold text-3xl sm:text-4xl lg:text-5xl text-center mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        Own your infrastructure. No vendor lock-in.
      </h2>

      <p
        ref={bodyRef}
        className="text-base lg:text-lg text-center max-w-[52vw] mb-12"
        style={{ color: 'var(--text-secondary)' }}
      >
        Self-host on your own servers. Audit the code. Fork it. MIT licensed—no
        hidden clauses, no usage caps.
      </p>

      <div className="flex flex-col lg:flex-row gap-6 px-[6vw]">
        {/* Self-hosted card */}
        <div
          ref={leftCardRef}
          className="glass-card w-full lg:w-[42vw] lg:h-[38vh] p-6"
        >
          <h3
            className="font-heading font-bold text-lg mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Self-hosted
          </h3>
          <div className="code-block">
            <span style={{ color: 'var(--accent-color)' }}>docker</span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>run</span>{' '}
            <span className="string">-p 8080:8080</span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>\\</span>
            <br />
            <span className="string">
              -e GATEWAY_API_KEY=$KEY
            </span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>\\</span>
            <br />
            <span style={{ color: 'var(--text-secondary)' }}>integraft/gateway:latest</span>
          </div>
        </div>

        {/* MIT Licensed card */}
        <div
          ref={rightCardRef}
          className="glass-card w-full lg:w-[42vw] lg:h-[38vh] p-6"
        >
          <h3
            className="font-heading font-bold text-lg mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            MIT Licensed
          </h3>
          <div className="code-block text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Copyright (c) Integration Gateway Contributors</span>
            <br />
            <br />
            <span style={{ color: 'var(--text-primary)' }}>
              Permission is hereby granted, free of charge, to any person
              obtaining a copy of this software and associated documentation
              files (the "Software"), to deal in the Software without
              restriction...
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
