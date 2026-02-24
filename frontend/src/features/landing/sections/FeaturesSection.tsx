import { useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Send, Shield, Clock, Mail, Bell, Code2, Users, BarChart2, Inbox, Lock, GitBranch, Database, ArrowUpRight } from 'lucide-react';

const features = [
  {
    icon: Send,
    title: 'Outbound Event Delivery',
    docSlug: 'outbound-delivery',
    bullets: [
      'Reliable delivery to any destination',
      'Multi-action workflows with configurable delay',
      'HMAC-SHA256 signing with secret rotation',
    ],
  },
  {
    icon: Shield,
    title: 'Inbound API Proxy',
    docSlug: 'inbound-proxy',
    bullets: [
      'One endpoint for all inbound traffic',
      'Bi-directional request & response transforms',
      'Rate limits, auth validation, streaming',
    ],
  },
  {
    icon: Clock,
    title: 'Scheduled Automation',
    docSlug: 'scheduled-automation',
    bullets: [
      'CRON or interval-based jobs with visual builder',
      'Query MySQL, MongoDB, or HTTP APIs as source',
      'Full execution trace per job run',
    ],
  },
  {
    icon: Code2,
    title: 'Data Transformation',
    docSlug: 'data-transformation',
    bullets: [
      'Visual field mapping with dot notation',
      'Custom JS in a secure sandbox VM',
      'Lookup tables for value enrichment',
    ],
  },
  {
    icon: Inbox,
    title: 'Dead Letter Queue',
    docSlug: 'dead-letter-queue',
    bullets: [
      'Auto-retry with exponential backoff',
      'Bulk retry or individual requeue from UI',
      'Error categorization and root cause hints',
    ],
  },
  {
    icon: Lock,
    title: 'Security & Audit',
    docSlug: 'webhook-security',
    bullets: [
      'SSRF protection on all webhook targets',
      'Full audit trail for every config change',
      'OAuth2 token caching with auto-refresh',
    ],
  },
  {
    icon: Users,
    title: 'Role-Based Access Control',
    docSlug: 'rbac',
    bullets: [
      '7 built-in roles, 80+ granular permissions',
      'Feature-level access per org',
      'User activity tracking and audit logging',
    ],
  },
  {
    icon: BarChart2,
    title: 'Analytics & Reports',
    docSlug: 'analytics-reports',
    bullets: [
      'p50 / p95 / p99 response time metrics',
      'Success and failure rate breakdowns',
      'Daily email reports, auto-scheduled',
    ],
  },
  {
    icon: Mail,
    title: 'Email & Slack Notifications',
    docSlug: 'email-notifications',
    bullets: [
      'SMTP, Gmail OAuth, Outlook OAuth support',
      'HTML email templates for failure reports',
      'Slack webhook alerts per org',
    ],
  },
  {
    icon: Bell,
    title: 'Alert Center',
    docSlug: 'alert-center',
    bullets: [
      'Categorized alerts with trend statistics',
      'Configurable failure thresholds per org',
      'Separate from delivery logs — ops-focused',
    ],
  },
  {
    icon: GitBranch,
    title: 'Versioning & Templates',
    docSlug: 'versioning',
    bullets: [
      'Full version history for every integration',
      'Semantic versioning with diff view',
      'Reusable templates with one-click deploy',
    ],
  },
  {
    icon: Database,
    title: 'Event Sources',
    docSlug: 'event-sources',
    bullets: [
      'Per-org MySQL or Kafka as event trigger',
      'Checkpoint-based processing — no duplicates',
      'HTTP Push adapter for inbound webhooks',
    ],
  },
];

export default function FeaturesSection() {
  const navigate = useNavigate();
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
          end: '+=260%',
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
        className="text-sm lg:text-base text-center mb-3"
        style={{ color: 'var(--text-secondary)' }}
      >
        One platform. Every integration. Zero missed events.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-[4vw] w-full">
        {features.map((feature, index) => (
          <div
            key={feature.title}
            ref={(el) => { cardsRef.current[index] = el; }}
            className="glass-card p-3.5 flex flex-col cursor-pointer group"
            onClick={() => navigate(`/docs/${feature.docSlug}`)}
            title={`Read ${feature.title} docs`}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center mb-2 flex-shrink-0"
              style={{ backgroundColor: 'rgba(79, 110, 247, 0.15)' }}
            >
              <feature.icon className="w-3.5 h-3.5" style={{ color: 'var(--accent-color)' }} />
            </div>

            <div className="flex items-start justify-between mb-1.5">
              <h3
                className="font-heading font-bold text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                {feature.title}
              </h3>
              <ArrowUpRight
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity"
                style={{ color: 'var(--accent-color)' }}
              />
            </div>

            <ul className="space-y-1">
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
