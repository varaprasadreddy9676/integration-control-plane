import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Send, Shield, Clock, Mail, Bell, Code2, Users, BarChart2 } from 'lucide-react';

const features = [
  {
    icon: Send,
    title: 'Outbound Event Delivery',
    bullets: [
      'Reliable delivery to any destination',
      'Automatic retries with dead-letter queue',
      'Full execution trace per event',
    ],
  },
  {
    icon: Shield,
    title: 'Inbound API Proxy',
    bullets: [
      'One endpoint for all inbound traffic',
      'Auth, validation, and transforms',
      'Rate limits and routing rules',
    ],
  },
  {
    icon: Clock,
    title: 'Scheduled Automation',
    bullets: [
      'CRON or interval-based jobs',
      'Query databases, call APIs, pull files',
      'Observable, retryable, repeatable',
    ],
  },
  {
    icon: Code2,
    title: 'Data Transformation',
    bullets: [
      'Field mapping with dot notation',
      'Custom JS in a secure sandbox VM',
      'Lookup tables for data enrichment',
    ],
  },
  {
    icon: Mail,
    title: 'Email Notifications',
    bullets: [
      'SMTP-based email delivery built in',
      'HTML email templates for reports',
      'Scheduled failure summary emails',
    ],
  },
  {
    icon: Bell,
    title: 'Failure Alerts',
    bullets: [
      'Auto-notify on delivery or job failure',
      'Alert via email or Slack webhook',
      'Configurable threshold per org',
    ],
  },
  {
    icon: Users,
    title: 'Role-Based Access Control',
    bullets: [
      'Super Admin, Org Admin, Org User roles',
      'Granular per-feature permissions',
      'User activity and audit logging',
    ],
  },
  {
    icon: BarChart2,
    title: 'Analytics & Reports',
    bullets: [
      'p50 / p95 / p99 response time metrics',
      'Success and failure rate breakdowns',
      'Daily email reports, auto-scheduled',
    ],
  },
];

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadRef = useRef<HTMLParagraphElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

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

      // ENTRANCE
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

      cardsRef.current.forEach((card, i) => {
        if (card) {
          scrollTl.fromTo(
            card,
            { y: '20vh', opacity: 0 },
            { y: 0, opacity: 1, ease: 'power4.out' },
            0.06 + i * 0.025
          );
        }
      });

      // EXIT — staggered so cards leave in sequence
      cardsRef.current.forEach((card, i) => {
        if (card) {
          scrollTl.fromTo(
            card,
            { y: 0, opacity: 1 },
            { y: '-6vh', opacity: 0, ease: 'power3.in' },
            0.68 + i * 0.015
          );
        }
      });

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
      id="features"
      ref={sectionRef}
      className="section-pinned grid-bg flex flex-col items-center justify-center z-20"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      <h2
        ref={headlineRef}
        className="font-heading font-bold text-2xl sm:text-3xl lg:text-4xl text-center mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Everything your integrations need.
      </h2>

      <p
        ref={subheadRef}
        className="text-sm lg:text-base text-center mb-5"
        style={{ color: 'var(--text-secondary)' }}
      >
        One platform. Every integration. Zero missed events.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-[4vw] w-full">
        {features.map((feature, index) => (
          <div
            key={feature.title}
            ref={(el) => { cardsRef.current[index] = el; }}
            className="glass-card p-5 flex flex-col"
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center mb-3 flex-shrink-0"
              style={{ backgroundColor: 'rgba(79, 110, 247, 0.15)' }}
            >
              <feature.icon className="w-4 h-4" style={{ color: 'var(--accent-color)' }} />
            </div>

            <h3
              className="font-heading font-bold text-sm mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              {feature.title}
            </h3>

            <ul className="space-y-1.5">
              {feature.bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="text-xs flex items-start gap-1.5"
                  style={{ color: 'var(--text-primary)', opacity: 0.7 }}
                >
                  <span
                    className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: 'var(--accent-color)' }}
                  />
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
