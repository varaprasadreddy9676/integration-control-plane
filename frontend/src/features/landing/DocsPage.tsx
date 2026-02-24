import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThemeProvider } from '../../hooks/useTheme';
import { useTheme } from '../../hooks/useTheme';
import { Sun, Moon, ArrowLeft, Menu, X } from 'lucide-react';
import './landing.css';

// Import markdown files as raw strings via Vite
import outboundDelivery from './docs/outbound-delivery.md?raw';
import inboundProxy from './docs/inbound-proxy.md?raw';
import scheduledAutomation from './docs/scheduled-automation.md?raw';
import dataTransformation from './docs/data-transformation.md?raw';
import emailNotifications from './docs/email-notifications.md?raw';
import failureAlerts from './docs/failure-alerts.md?raw';
import rbac from './docs/rbac.md?raw';
import analyticsReports from './docs/analytics-reports.md?raw';
import deadLetterQueue from './docs/dead-letter-queue.md?raw';
import lookupTables from './docs/lookup-tables.md?raw';
import aiAssistant from './docs/ai-assistant.md?raw';
import webhookSecurity from './docs/webhook-security.md?raw';
import versioning from './docs/versioning.md?raw';
import eventSources from './docs/event-sources.md?raw';
import bulkOperations from './docs/bulk-operations.md?raw';
import alertCenter from './docs/alert-center.md?raw';

const docs = [
  { slug: 'outbound-delivery',   title: 'Outbound Event Delivery', content: outboundDelivery },
  { slug: 'inbound-proxy',       title: 'Inbound API Proxy',       content: inboundProxy },
  { slug: 'scheduled-automation',title: 'Scheduled Automation',    content: scheduledAutomation },
  { slug: 'data-transformation', title: 'Data Transformation',     content: dataTransformation },
  { slug: 'dead-letter-queue',   title: 'Dead Letter Queue',       content: deadLetterQueue },
  { slug: 'webhook-security',    title: 'Webhook Security',        content: webhookSecurity },
  { slug: 'lookup-tables',       title: 'Lookup Tables',           content: lookupTables },
  { slug: 'versioning',          title: 'Versioning & Templates',  content: versioning },
  { slug: 'ai-assistant',        title: 'AI Assistant',            content: aiAssistant },
  { slug: 'event-sources',       title: 'Event Sources',           content: eventSources },
  { slug: 'bulk-operations',     title: 'Bulk Operations',         content: bulkOperations },
  { slug: 'alert-center',        title: 'Alert Center',            content: alertCenter },
  { slug: 'email-notifications', title: 'Email Notifications',     content: emailNotifications },
  { slug: 'failure-alerts',      title: 'Failure Alerts',          content: failureAlerts },
  { slug: 'rbac',                title: 'Role-Based Access Control', content: rbac },
  { slug: 'analytics-reports',   title: 'Analytics & Reports',     content: analyticsReports },
];

function SidebarNav({
  currentSlug,
  navigate,
  handleNavClick,
}: {
  currentSlug: string;
  navigate: (path: string) => void;
  handleNavClick: () => void;
  onSelect?: () => void;
}) {
  return (
    <>
      <p
        className="px-5 pb-2 text-xs font-heading font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-secondary)' }}
      >
        Features
      </p>
      <nav>
        {docs.map((doc) => {
          const isActive = doc.slug === currentSlug;
          return (
            <button
              key={doc.slug}
              onClick={() => {
                navigate(`/docs/${doc.slug}`);
                handleNavClick();
              }}
              className="w-full text-left px-5 py-2 text-sm transition-colors"
              style={{
                color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'rgba(79, 110, 247, 0.08)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent-color)' : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              {doc.title}
            </button>
          );
        })}
      </nav>
    </>
  );
}

function DocsPageContent() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentDoc = docs.find((d) => d.slug === slug) ?? docs[0];

  // Scroll to top on doc change
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentDoc.slug]);

  // Close mobile sidebar when a link is clicked
  const handleNavClick = () => {
    setSidebarOpen(false);
  };

  const idx = docs.findIndex((d) => d.slug === currentDoc.slug);
  const prev = docs[idx - 1];
  const next = docs[idx + 1];

  // Sidebar content shared between desktop + mobile
  const sidebarContent = (
    <SidebarNav
      currentSlug={currentDoc.slug}
      navigate={navigate}
      handleNavClick={handleNavClick}
    />
  );

  return (
    // landing-page gives us CSS vars + fonts. We override overflow-x so
    // position:fixed sidebar is never clipped by the ancestor.
    <div className="landing-page" style={{ minHeight: '100vh', overflowX: 'visible' }}>

      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <header
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          height: '3.5rem',
          zIndex: 50,
          borderBottom: '1px solid var(--card-border)',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4vw',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            to="/"
            className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <span style={{ color: 'var(--card-border)' }}>|</span>
          <span className="font-heading font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
            Documentation
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
          <button
            className="lg:hidden theme-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* ── Desktop sidebar — truly fixed, always visible ─────────────────── */}
      <aside
        className="hidden lg:block overflow-y-auto"
        style={{
          position: 'fixed',
          top: '3.5rem',
          left: 0,
          width: 240,
          height: 'calc(100vh - 3.5rem)',
          zIndex: 40,
          borderRight: '1px solid var(--card-border)',
          backgroundColor: 'var(--bg-primary)',
          padding: '1.25rem 0',
        }}
      >
        {sidebarContent}
      </aside>

      {/* ── Mobile: backdrop ──────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Mobile: sliding sidebar ───────────────────────────────────────── */}
      <aside
        className={`lg:hidden overflow-y-auto transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          position: 'fixed',
          top: '3.5rem',
          left: 0,
          width: 240,
          height: 'calc(100vh - 3.5rem)',
          zIndex: 50,
          borderRight: '1px solid var(--card-border)',
          backgroundColor: 'var(--bg-primary)',
          padding: '1.25rem 0',
        }}
      >
        {sidebarContent}
      </aside>

      {/* ── Main content — offset right so it's never under the sidebar ───── */}
      <main
        style={{
          paddingTop: '3.5rem',       /* clear fixed header */
          paddingLeft: 'max(2rem, calc(240px + 3vw))',   /* clear fixed sidebar on desktop */
          paddingRight: '4vw',
          maxWidth: 'calc(240px + 820px)',
        }}
        className="lg:pl-[calc(240px+3vw)] py-10"
      >
        <div style={{ maxWidth: 780 }}>
          <div className="docs-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentDoc.content}</ReactMarkdown>
          </div>

          {/* Prev / Next */}
          <div
            className="flex items-center justify-between mt-16 pt-6"
            style={{ borderTop: '1px solid var(--card-border)' }}
          >
            {prev ? (
              <button
                onClick={() => navigate(`/docs/${prev.slug}`)}
                className="flex items-center gap-2 text-sm transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                <ArrowLeft className="w-4 h-4" />
                {prev.title}
              </button>
            ) : <span />}
            {next ? (
              <button
                onClick={() => navigate(`/docs/${next.slug}`)}
                className="flex items-center gap-2 text-sm transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                {next.title}
                <ArrowLeft className="w-4 h-4 rotate-180" />
              </button>
            ) : <span />}
          </div>
        </div>
      </main>
    </div>
  );
}

export function DocsPage() {
  return (
    <ThemeProvider>
      <DocsPageContent />
    </ThemeProvider>
  );
}
