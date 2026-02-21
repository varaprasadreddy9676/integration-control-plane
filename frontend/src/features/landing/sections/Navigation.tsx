import { Link } from 'react-router-dom';
import { Github, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';
import { LANDING_PUBLIC_MODE, GITHUB_URL } from '../landing-config';

interface NavigationProps {
  onLoginClick: () => void;
}

export default function Navigation({ onLoginClick }: NavigationProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--card-border)] transition-colors duration-300">
      <div className="flex items-center justify-between px-[4vw] py-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="font-heading font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
            Integration Gateway
          </span>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            color: 'var(--accent-color)',
            border: '1px solid var(--accent-color)',
            borderRadius: 4,
            padding: '1px 6px',
            opacity: 0.85
          }}>
            BETA
          </span>
        </div>

        {/* Nav Links */}
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6">
            <a
              href="#features"
              className="text-sm transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              Features
            </a>
            <Link
              to="/docs"
              className="text-sm transition-colors"
              style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              Docs
            </Link>
            {LANDING_PUBLIC_MODE && (
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <Github className="w-4 h-4" />
                GitHub
              </a>
            )}
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </button>

          <button
            className="btn-primary text-sm py-2 px-4"
            onClick={onLoginClick}
          >
            Sign in
          </button>
        </div>
      </div>
    </nav>
  );
}
