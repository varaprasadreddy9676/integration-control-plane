import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Link } from 'react-router-dom';
import { ArrowRight, Github, Twitter, MessageCircle } from 'lucide-react';
import { LANDING_PUBLIC_MODE, GITHUB_URL } from '../landing-config';

interface FooterSectionProps {
  onLoginClick: () => void;
}

const footerLinks = {
  product: [
    { label: 'Features', href: '#features' },
    { label: 'Documentation', href: '/docs' },
    // Roadmap: hidden until page exists
    // API Reference: hidden until API docs exist
  ],
  docs: [
    { label: 'Outbound Event Delivery', href: '/docs/outbound-delivery' },
    { label: 'Inbound API Proxy',        href: '/docs/inbound-proxy' },
    { label: 'Scheduled Automation',     href: '/docs/scheduled-automation' },
    { label: 'Data Transformation',      href: '/docs/data-transformation' },
    { label: 'Email Notifications',      href: '/docs/email-notifications' },
    { label: 'Failure Alerts',           href: '/docs/failure-alerts' },
    { label: 'Role-Based Access Control',href: '/docs/rbac' },
    { label: 'Analytics & Reports',      href: '/docs/analytics-reports' },
  ],
};

export default function FooterSection({ onLoginClick }: FooterSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ctaRef.current,
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: 'power4.out',
          scrollTrigger: {
            trigger: ctaRef.current,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        }
      );

      if (LANDING_PUBLIC_MODE && linksRef.current) {
        const columns = linksRef.current.querySelectorAll('.footer-column');
        gsap.fromTo(
          columns,
          { y: 24, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            stagger: 0.08,
            ease: 'power4.out',
            scrollTrigger: {
              trigger: linksRef.current,
              start: 'top 88%',
              toggleActions: 'play none none reverse',
            },
          }
        );
      }
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="grid-bg relative z-[70]"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* CTA Block */}
      <div ref={ctaRef} className="py-20 px-[6vw] text-center">
        <h2
          className="font-heading font-bold text-3xl sm:text-4xl lg:text-5xl mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Get started in minutes.
        </h2>
        <p
          className="text-base lg:text-lg max-w-xl mx-auto mb-8"
          style={{ color: 'var(--text-secondary)' }}
        >
          Deploy the gateway, create your first route, and start delivering
          events with full observability.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            className="btn-primary flex items-center gap-2"
            onClick={onLoginClick}
          >
            Get started
            <ArrowRight className="w-4 h-4" />
          </button>
          {LANDING_PUBLIC_MODE && (
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex items-center gap-2"
            >
              <Github className="w-4 h-4" />
              View on GitHub
            </a>
          )}
        </div>
      </div>

      {/* Public mode: full footer with link columns */}
      {LANDING_PUBLIC_MODE && (
        <div
          ref={linksRef}
          className="border-t py-12 px-[6vw]"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-12">
              {/* Logo column */}
              <div className="footer-column col-span-2 md:col-span-1">
                <div
                  className="font-heading font-bold text-lg mb-4"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Integration Gateway
                </div>
                <p
                  className="text-sm mb-4"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  The control plane for your integrations.
                </p>
                <div className="flex items-center gap-3">
                  {[
                    { href: GITHUB_URL, icon: <Github className="w-4 h-4" />, label: 'GitHub' },
                    { href: 'https://twitter.com', icon: <Twitter className="w-4 h-4" />, label: 'Twitter' },
                    { href: '#discord', icon: <MessageCircle className="w-4 h-4" />, label: 'Discord' },
                  ].map(({ href, label, icon }) => (
                    <a
                      key={label}
                      aria-label={label}
                      href={href}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                      style={{ backgroundColor: 'rgba(128,128,128,0.1)', color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--text-primary)';
                        e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-secondary)';
                        e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)';
                      }}
                    >
                      {icon}
                    </a>
                  ))}
                </div>
              </div>

              {/* Product column */}
              <div className="footer-column">
                <h4
                  className="font-heading font-semibold text-sm mb-4"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Product
                </h4>
                <ul className="space-y-2">
                  {footerLinks.product.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith('/') ? (
                        <Link
                          to={link.href}
                          className="text-sm transition-colors"
                          style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          className="text-sm transition-colors"
                          style={{ color: 'var(--text-secondary)' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Docs / Features column */}
              <div className="footer-column col-span-2 md:col-span-1">
                <h4
                  className="font-heading font-semibold text-sm mb-4"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Docs
                </h4>
                <ul className="space-y-2">
                  {footerLinks.docs.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.href}
                        className="text-sm transition-colors"
                        style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div
              className="pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4"
              style={{ borderColor: 'var(--card-border)' }}
            >
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                © {new Date().getFullYear()} Integration Gateway — AGPL v3, open source.
              </p>
              <div className="flex items-center gap-6">
                {['Privacy Policy', 'Terms of Service'].map((label) => (
                  <a
                    key={label}
                    href={`#${label.toLowerCase().replace(' ', '-')}`}
                    className="text-xs transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Internal mode: simple bottom bar */}
      {!LANDING_PUBLIC_MODE && (
        <div
          className="border-t py-6 px-[6vw]"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p
              className="font-heading font-bold text-sm"
              style={{ color: 'var(--text-primary)' }}
            >
              Integration Gateway
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              © {new Date().getFullYear()} — Built for teams who ship.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
