import { useState } from 'react';
import { Form, Input, Button, Typography, Alert, Divider } from 'antd';
import {
  LockOutlined, MailOutlined, GithubOutlined,
  ThunderboltFilled, ApiOutlined, ClockCircleOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';

const { Text } = Typography;

// ─── Data ─────────────────────────────────────────────────────────────────────

const PILLARS = [
  {
    icon: <ThunderboltFilled style={{ fontSize: 15, color: '#60a5fa' }} />,
    label: 'Event-Driven Delivery Engine',
    sub: 'Guaranteed outbound webhook delivery with dead-letter queue, retries, and circuit-breaker.'
  },
  {
    icon: <ApiOutlined style={{ fontSize: 15, color: '#60a5fa' }} />,
    label: 'Real-Time API Proxy',
    sub: 'Per-tenant routing, auth, payload transformation, and rate limiting for inbound requests.'
  },
  {
    icon: <ClockCircleOutlined style={{ fontSize: 15, color: '#60a5fa' }} />,
    label: 'Scheduled Automation',
    sub: 'CRON and interval jobs that query any data source and deliver to any endpoint.'
  }
];

const CHIPS = ['Multi-tenant', 'DLQ + Retries', 'Rate Limits', 'Execution Traces', 'OAuth2 / HMAC'];

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
/* ── Root ── */
.ig-root {
  display: flex;
  min-height: 100vh;
  background: #09090b;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
}

/* ── Left panel ── */
.ig-left {
  width: 58%;
  min-height: 100vh;
  background: #09090b;
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  padding: 44px 60px;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

/* Subtle grid overlay */
.ig-left::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
  background-size: 36px 36px;
  pointer-events: none;
  z-index: 0;
}

/* Radial vignette over the grid (edges darken) */
.ig-left::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 50%, transparent 40%, #09090b 100%);
  pointer-events: none;
  z-index: 0;
}

.ig-left-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
}

/* ── Logo ── */
.ig-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ig-logo-icon {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.ig-logo-name {
  color: #fafafa !important;
  font-weight: 600 !important;
  font-size: 15px !important;
  letter-spacing: -0.1px;
}

.ig-version {
  font-size: 11px;
  font-weight: 500;
  color: #52525b;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 4px;
  padding: 1px 7px;
  margin-left: 2px;
  line-height: 1.8;
}

/* ── Hero ── */
.ig-hero {
  max-width: 520px;
}

.ig-headline {
  color: #fafafa;
  font-weight: 700;
  font-size: 34px;
  line-height: 1.18;
  margin: 0 0 14px;
  letter-spacing: -0.7px;
}

.ig-subhead {
  color: #71717a;
  font-size: 15px;
  line-height: 1.65;
  margin: 0 0 26px;
}

/* ── Chips ── */
.ig-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 40px;
}

.ig-chip {
  font-size: 11px;
  font-weight: 500;
  color: #a1a1aa;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  padding: 3px 9px;
  letter-spacing: 0.15px;
  white-space: nowrap;
}

/* ── Pillars ── */
.ig-pillars {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.ig-pillar {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.ig-pillar-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: rgba(59,130,246,0.07);
  border: 1px solid rgba(59,130,246,0.14);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.ig-pillar-title {
  color: #e4e4e7;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
}

.ig-pillar-sub {
  color: #52525b;
  font-size: 13px;
  margin: 3px 0 0;
  line-height: 1.45;
}

/* ── Proof line ── */
.ig-proof {
  font-size: 12px;
  color: #3f3f46;
  margin-top: 28px;
  letter-spacing: 0.1px;
}

/* ── Footer ── */
.ig-footer {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ig-footer a {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #52525b;
  font-size: 12px;
  text-decoration: none;
  transition: color 0.15s;
}

.ig-footer a:hover { color: #a1a1aa; }

.ig-footer-sep {
  color: #27272a;
  font-size: 12px;
  line-height: 1;
}

/* ── Right panel ── */
.ig-right {
  flex: 1;
  min-height: 100vh;
  background: #f4f4f5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

/* ── Login card ── */
.ig-card {
  width: 100%;
  max-width: 320px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.06);
}

.ig-card-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.ig-card-brand-icon {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  display: grid;
  place-items: center;
}

.ig-card-brand-name {
  font-weight: 600 !important;
  font-size: 13px !important;
  color: #18181b !important;
}

.ig-card-head {
  margin-bottom: 20px;
}

.ig-card-title {
  color: #18181b;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -0.3px;
  margin: 0 0 3px;
}

.ig-card-sub {
  color: #52525b !important;
  font-size: 13px !important;
}

/* Ant input overrides */
.ig-input .ant-input,
.ig-input .ant-input-affix-wrapper {
  height: 40px !important;
  border-radius: 8px !important;
  font-size: 14px !important;
  border-color: #e5e7eb !important;
  background: #fafafa !important;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.ig-input .ant-input-affix-wrapper:hover {
  border-color: #a1a1aa !important;
}

.ig-input .ant-input-affix-wrapper-focused,
.ig-input .ant-input-affix-wrapper:focus-within {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.12) !important;
  background: #fff !important;
}

/* Submit button */
.ig-btn.ant-btn {
  height: 40px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  background: #18181b;
  border-color: #18181b;
  box-shadow: none;
  letter-spacing: 0.1px;
  transition: background 0.15s, box-shadow 0.15s;
}

.ig-btn.ant-btn:hover {
  background: #27272a !important;
  border-color: #27272a !important;
}

.ig-btn.ant-btn:focus-visible {
  box-shadow: 0 0 0 3px rgba(59,130,246,0.4) !important;
  outline: none;
}

/* Form label */
.ig-form-label {
  font-size: 12px;
  font-weight: 600;
  color: #3f3f46;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

/* Mobile brand block shown above card on small screens */
.ig-mobile-brand {
  display: none;
}

/* Error alert */
.ig-alert.ant-alert {
  border-radius: 8px;
  font-size: 13px;
  padding: 8px 12px;
  margin-bottom: 18px;
}

/* ── Responsive ── */
@media (max-width: 860px) {
  .ig-left { display: none !important; }
  .ig-mobile-brand { display: flex !important; }
}
`;

// ─── Left Panel ───────────────────────────────────────────────────────────────

const LeftPanel = () => (
  <div className="ig-left">
    <div className="ig-left-inner">

      {/* Logo */}
      <div className="ig-logo">
        <div className="ig-logo-icon">
          <ThunderboltFilled style={{ fontSize: 15, color: '#fff' }} />
        </div>
        <Text className="ig-logo-name">Integration Gateway</Text>
        <span className="ig-version">v2</span>
      </div>

      {/* Hero */}
      <div className="ig-hero">
        <h1 className="ig-headline">
          Enterprise-ready<br />
          Integration Control Plane
        </h1>
        <p className="ig-subhead">
          Event-driven delivery, real-time proxying, and scheduled automation
          for multi-tenant systems — with built-in reliability and observability.
        </p>

        {/* Trust signal chips */}
        <div className="ig-chips">
          {CHIPS.map(c => (
            <span key={c} className="ig-chip">{c}</span>
          ))}
        </div>

        {/* 3 Pillars */}
        <div className="ig-pillars">
          {PILLARS.map(p => (
            <div key={p.label} className="ig-pillar">
              <div className="ig-pillar-icon">{p.icon}</div>
              <div>
                <p className="ig-pillar-title">{p.label}</p>
                <p className="ig-pillar-sub">{p.sub}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="ig-proof">
          DLQ, retries, rate limits, execution traces — all first-class.
        </p>
      </div>

      {/* Footer */}
      <div className="ig-footer">
        <a href="https://github.com/your-org/integration-gateway" target="_blank" rel="noreferrer">
          <GithubOutlined style={{ fontSize: 13 }} />
          GitHub
        </a>
        <span className="ig-footer-sep">·</span>
        <a href="#" target="_blank" rel="noreferrer">Docs</a>
        <span className="ig-footer-sep">·</span>
        <span style={{ fontSize: 12, color: '#3f3f46' }}>MIT License</span>
      </div>
    </div>
  </div>
);

// ─── Login Route ──────────────────────────────────────────────────────────────

export const LoginRoute = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: { email: string; password: string }) => {
    setError(null);
    setLoading(true);
    try {
      localStorage.removeItem('integration_gateway_entity_rid');
      sessionStorage.removeItem('integration_gateway_entity_rid');
      await login(values.email, values.password);
      const redirect = sessionStorage.getItem('auth_redirect') || '/dashboard';
      sessionStorage.removeItem('auth_redirect');
      navigate(redirect, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ig-root">
      <style>{CSS}</style>

      <LeftPanel />

      {/* Right — login */}
      <div className="ig-right">
        <div className="ig-card">

          {/* Mobile-only brand row */}
          <div className="ig-mobile-brand" style={{ alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <div className="ig-card-brand-icon">
              <ThunderboltFilled style={{ fontSize: 12, color: '#fff' }} />
            </div>
            <Text className="ig-card-brand-name">Integration Gateway</Text>
          </div>

          {/* Card heading */}
          <div className="ig-card-head">
            <h2 className="ig-card-title">Sign in</h2>
            <Text className="ig-card-sub">Sign in to your organization's workspace</Text>
          </div>

          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              className="ig-alert"
            />
          )}

          <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
            <Form.Item
              label={<span className="ig-form-label">Email</span>}
              name="email"
              style={{ marginBottom: 12 }}
              rules={[
                { required: true, message: 'Email is required' },
                { type: 'email', message: 'Enter a valid email' }
              ]}
            >
              <Input
                className="ig-input"
                prefix={<MailOutlined style={{ color: '#a1a1aa', fontSize: 13 }} />}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              label={<span className="ig-form-label">Password</span>}
              name="password"
              style={{ marginBottom: 18 }}
              rules={[{ required: true, message: 'Password is required' }]}
            >
              <Input.Password
                className="ig-input"
                prefix={<LockOutlined style={{ color: '#a1a1aa', fontSize: 13 }} />}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              className="ig-btn"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </Form>

          <Divider style={{ margin: '18px 0 14px', borderColor: '#f4f4f5' }} />

          <Text style={{ display: 'block', textAlign: 'center', fontSize: 12, color: '#a1a1aa' }}>
            Need access? Contact your system administrator.
          </Text>
        </div>
      </div>
    </div>
  );
};
